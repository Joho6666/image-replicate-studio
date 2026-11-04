import fs from 'node:fs';
import path from 'node:path';
import { loadKeys } from './config.mjs';
import { createQueue, withRetry } from './queue.mjs';
import { download, imageExt } from './net.mjs';
import { RelayError, asyncAvailable, originOf, runAsyncJob } from './async-relay.mjs';

export { RelayError };

export const MODELS = [
  { id: 'gpt-image-2.5-flare', label: 'GPT 2.5 flare（推荐）', group: 'gpt', refs: true },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT 2.5 sunburst（略锐）', group: 'gpt', refs: true },
  { id: 'gpt-image-1.5', label: 'GPT 1.5（偏美颜）', group: 'gpt', refs: true },
  { id: 'grok-imagine-image', label: 'grok（快，有水印，不用参考图）', group: 'grok', refs: false },
];

export const SIZES = { '3:4': '1024x1536', '2:3': '1024x1536', '9:16': '1024x1536', '1:1': '1024x1024', '4:3': '1536x1024', '16:9': '1536x1024' };


const queue = createQueue(3);

// Connection health seen by real generation calls (GET /models can be fine while long requests get cut).
export const connStats = { lastOkAt: null, lastCutAt: null, cuts: 0, lastError: null, mode: null };

// A socket error well before a normal generation time (~40 s) means something on the path
// (typically a local proxy in TUN mode) is killing long connections.
export const isEarlyCut = err => err?.name === 'TypeError' && (err.elapsed ?? Infinity) < 20000 &&
  /SOCKET|ECONNRESET|other side closed|ERR_SSL|terminated/i.test((err.cause?.code || '') + ' ' + (err.cause?.message || '') + ' ' + err.message);
export const queueState = () => ({ active: queue.active, pending: queue.pending });

function modelInfo(id) {
  return MODELS.find(m => m.id === id) || { id, group: id.startsWith('grok') ? 'grok' : 'gpt', refs: !id.startsWith('grok') };
}

async function callRelay({ model, prompt, size, refs, quality }) {
  const info = modelInfo(model);
  const keys = loadKeys();
  const auth = { Authorization: 'Bearer ' + keys[info.group] };
  const body = { model, prompt, n: 1 };
  if (size && info.group === 'gpt') body.size = size;
  if (quality && info.group === 'gpt') body.quality = quality;
  const useRefs = refs.length && info.refs;
  const buildForm = () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) fd.append(k, String(v));
    for (const f of refs) {
      const buf = fs.readFileSync(f);
      const ext = imageExt(buf);
      fd.append('image[]', new Blob([buf], { type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }), path.basename(f));
    }
    return fd;
  };
  // Prefer the relay's async endpoints when present: short requests survive proxies that cut long ones.
  const origin = originOf(keys.base);
  if (await asyncAvailable(origin)) {
    connStats.mode = 'async';
    return runAsyncJob({ origin, auth, kind: useRefs ? 'edits' : 'generations', json: body, form: useRefs ? buildForm() : null });
  }
  connStats.mode = 'sync';
  let res;
  const t0 = Date.now();
  try {
  if (useRefs) {
    res = await fetch(keys.base + '/images/edits', { method: 'POST', headers: auth, body: buildForm() });
  } else {
    res = await fetch(keys.base + '/images/generations', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  } catch (err) {
    err.elapsed = Date.now() - t0;
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  const item = json?.data?.[0];
  if (!res.ok || !item) {
    const err = json.error || json;
    throw new RelayError(err.message || JSON.stringify(err).slice(0, 300), res.status, err.code);
  }
  return item;
}

// Generate one image and save it as `${outBase}.<ext>`; returns the saved path.
export function generateImage({ model, prompt, size, refs = [], outBase, quality }) {
  return queue.run(() => withRetry(async () => {
    const item = await callRelay({ model, prompt, size, refs, quality });
    let buf;
    if (item.buffer) buf = item.buffer;
    else if (item.b64_json) buf = Buffer.from(item.b64_json, 'base64');
    else {
      const tmp = outBase + '.tmp';
      await download(item.url, tmp);
      buf = fs.readFileSync(tmp);
      fs.unlinkSync(tmp);
    }
    const file = `${outBase}.${imageExt(buf)}`;
    fs.writeFileSync(file, buf);
    connStats.lastOkAt = new Date().toISOString();
    connStats.cuts = 0;
    return file;
  }, { onError: err => {
    connStats.lastError = explainError(err);
    if (isEarlyCut(err)) { connStats.lastCutAt = new Date().toISOString(); connStats.cuts++; }
  }, retryIf: e => e.status === 429 || e.status >= 500 ||
    // Stop hammering once the proxy has cut us repeatedly: every further try fails the same way.
    (e.name === 'TypeError' && !(isEarlyCut(e) && connStats.cuts >= 3)) }));
}

// Turn a relay error into a message the user can act on.
export function explainError(err) {
  if (err?.code === 'moderation_blocked' || /safety system/.test(err?.message || '')) {
    const kind = (err.message.match(/safety_violations=\[([^\]]*)\]/) || [])[1] || '';
    return `被安全审核拦截${kind ? '（' + kind + '）' : ''}：把姿势、服装、表情写得更保守（例如去掉吊带、飞吻、低领）后重试。`;
  }
  if (err?.status === 429) return '中转站并发已满，重试多次仍失败，稍后再试。';
  if (isEarlyCut(err)) return `连接在 ${Math.round(err.elapsed / 1000)} 秒就被掐断（正常出图要 40 秒左右）：多半是本机代理（FlClash/Clash 的 TUN 模式）切断了长连接。把 duckdns.org 设为 DIRECT 直连、换节点或关掉 TUN 后重试。`;
  if (err?.name === 'TypeError') return `网络连接失败（${err.cause?.code || err.message}）：检查代理/网络后重试`;
  return err?.message || String(err);
}
