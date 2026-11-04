import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PORT, ROOT, loadKeys, loadTikhub } from './lib/config.mjs';
import { listProjects, createProject, getProject, saveProject, projectDir, resolveIn, relTo, newId } from './lib/store.mjs';
import { fetchCase } from './lib/douyin.mjs';
import { MODELS, SIZES, generateImage, explainError, queueState, connStats } from './lib/relay.mjs';
import { buildPrompt, composePrompt, swapPrompt, extractAuthorPrompt, SHOTS, FLASH, FRAMING, PRESETS, DEFAULT_FACE } from './lib/prompt.mjs';
import { listStyles, getStyle, saveStyle, deleteStyle, styleDir } from './lib/styles.mjs';
import { postProcess, cropImage, grid, removeGrokWatermark, addAiLabel, POST_PRESETS, DEFAULT_POST } from './lib/post.mjs';
import { imageExt } from './lib/net.mjs';

const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.json': 'application/json' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const need = (cond, msg, status = 400) => { if (!cond) throw new HttpError(status, msg); };

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; need(size < 80e6, '请求太大'); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: '文件不存在' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function saveDataUrl(p, dataUrl, subdir) {
  const m = /^data:image\/[\w+.-]+;base64,(.+)$/.exec(dataUrl || '');
  need(m, '只支持图片');
  const buf = Buffer.from(m[1], 'base64');
  const abs = path.join(projectDir(p.id), subdir, `${newId()}.${imageExt(buf)}`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return abs;
}

// Post preset key for a job; false/'none' turns post-processing off, legacy true means the default.
const postKey = v => (v === false || v === 'none') ? null : (POST_PRESETS[v] ? v : DEFAULT_POST);

const findFace = (p, id) => p.faces.find(f => f.id === id);
const allOutputs = p => p.jobs.flatMap(j => j.outputs);

// ---- jobs -------------------------------------------------------------------

async function runJob(p, job) {
  job.status = 'running';
  saveProject(p);
  const dir = projectDir(p.id);
  const refs = job.refs.map(r => resolveIn(p, r));
  const results = await Promise.allSettled(Array.from({ length: job.count }, async (_, i) => {
    const raw = await generateImage({ model: job.model, prompt: job.finalPrompt, size: job.size, refs, outBase: path.join(dir, 'outputs', `${job.id}_${i + 1}`) });
    if (job.model.startsWith('grok')) {
      // Keep the untouched original next to the cleaned file in case the patch looks wrong.
      const marked = raw.replace(/(\.\w+)$/, '_wm$1');
      fs.renameSync(raw, marked);
      try { await removeGrokWatermark(marked, raw); }
      catch (e) { fs.renameSync(marked, raw); job.errors.push('去水印失败：' + e.message); }
    }
    let final = null;
    if (job.post) {
      final = raw.replace(/\.\w+$/, '_final.jpg');
      try { await postProcess(raw, final, job.post); } catch (e) { final = null; job.errors.push('后期失败：' + e.message); }
    }
    job.outputs.push({ file: relTo(p, raw), final: final && relTo(p, final), post: final ? job.post : null, star: 0 });
    saveProject(p);
  }));
  job.errors.push(...results.filter(r => r.status === 'rejected').map(r => explainError(r.reason)));
  job.status = job.outputs.length === job.count ? 'done' : job.outputs.length ? 'partial' : 'failed';
  job.finishedAt = new Date().toISOString();
  saveProject(p);
}

function startJob(p, fields) {
  const job = { id: newId('j'), status: 'queued', createdAt: new Date().toISOString(), outputs: [], errors: [], ...fields };
  p.jobs.push(job);
  saveProject(p);
  runJob(p, job).catch(e => { job.status = 'failed'; job.errors.push(explainError(e)); saveProject(p); });
  return job;
}

// ---- routes -----------------------------------------------------------------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('GET', '/api/meta', () => ({
  models: MODELS, sizes: Object.keys(SIZES), defaultFace: DEFAULT_FACE, queue: queueState(),
  shots: Object.fromEntries(Object.entries(SHOTS).map(([k, v]) => [k, v.label])),
  flashes: Object.fromEntries(Object.entries(FLASH).map(([k, v]) => [k, v.label])),
  framings: Object.fromEntries(Object.entries(FRAMING).map(([k, v]) => [k, v.label])),
  presets: PRESETS,
  postPresets: Object.fromEntries(Object.entries(POST_PRESETS).map(([k, v]) => [k, v.label])), defaultPost: DEFAULT_POST,
}));

route('GET', '/api/projects', () => listProjects());
route('POST', '/api/projects', async req => createProject((await readJson(req)).name));

route('GET', '/api/projects/:id', (req, { p }) => {
  let changed = false;
  for (const c of p.cases) if (c.authorPrompt === undefined && c.type !== 'upload') { c.authorPrompt = extractAuthorPrompt(c.desc); changed = true; }
  if (changed) saveProject(p);
  return { ...p, queue: queueState() };
});

route('PATCH', '/api/projects/:id', async (req, { p }) => {
  const body = await readJson(req);
  if (typeof body.name === 'string') p.name = body.name.trim() || p.name;
  if (Array.isArray(body.moodboard)) {
    for (const r of body.moodboard) resolveIn(p, r);
    p.moodboard = body.moodboard.slice(0, 3);
  }
  if (body.draft) p.draft = body.draft;
  saveProject(p);
  return p;
});

route('POST', '/api/projects/:id/case', async (req, { p }) => {
  const { url } = await readJson(req);
  need(url?.trim(), '请粘贴抖音分享链接');
  const c = await fetchCase(url, projectDir(p.id));
  c.authorPrompt = extractAuthorPrompt(c.desc);
  p.cases = p.cases.filter(x => x.awemeId !== c.awemeId);
  p.cases.unshift(c);
  saveProject(p);
  return c;
});

route('POST', '/api/projects/:id/upload', async (req, { p }) => {
  const { dataUrl } = await readJson(req);
  const abs = saveDataUrl(p, dataUrl, 'refs/upload');
  let up = p.cases.find(c => c.awemeId === 'upload');
  if (!up) { up = { awemeId: 'upload', type: 'upload', desc: '我上传的参考图', author: '', images: [] }; p.cases.push(up); }
  up.images.push(relTo(p, abs));
  saveProject(p);
  return { file: relTo(p, abs) };
});

route('POST', '/api/projects/:id/faces', async (req, { p }) => {
  const { source, dataUrl, crop, name, desc } = await readJson(req);
  const src = dataUrl ? saveDataUrl(p, dataUrl, 'faces/src') : resolveIn(p, source);
  const id = newId('f');
  let file;
  if (crop && crop.w > 10 && crop.h > 10) {
    file = path.join(projectDir(p.id), 'faces', `${id}.png`);
    await cropImage(src, file, crop);
  } else {
    file = path.join(projectDir(p.id), 'faces', id + path.extname(src));
    fs.copyFileSync(src, file);
  }
  const face = { id, name: name?.trim() || `模特 ${p.faces.length + 1}`, desc: desc || '', file: relTo(p, file), createdAt: new Date().toISOString() };
  p.faces.push(face);
  saveProject(p);
  return face;
});

route('DELETE', '/api/projects/:id/faces/:faceId', (req, { p, faceId }) => {
  p.faces = p.faces.filter(f => f.id !== faceId);
  saveProject(p);
  return { ok: true };
});

route('POST', '/api/prompt', async req => ({ prompt: buildPrompt(await readJson(req)) }));

function startGenJob(p, b) {
  need(b.prompt?.trim(), '提示词为空');
  const model = MODELS.find(m => m.id === b.model) || MODELS[0];
  const count = Math.min(Math.max(Number(b.count) || 1, 1), 4);
  const face = b.faceId ? findFace(p, b.faceId) : null;
  need(!b.faceId || face, '模特不存在');
  const moodboard = (Array.isArray(b.moodboard) ? b.moodboard : p.moodboard).slice(0, 3);
  moodboard.forEach(r => resolveIn(p, r));
  const refs = model.refs ? [...(face ? [face.file] : []), ...moodboard] : [];
  const finalPrompt = model.refs ? composePrompt(b.prompt, { hasFace: !!face, moodboard: moodboard.length }) : b.prompt;
  return startJob(p, {
    type: 'gen', model: model.id, aspect: b.aspect || '3:4', size: SIZES[b.aspect] || SIZES['3:4'], count,
    post: postKey(b.post), faceId: face?.id || null, refs, prompt: b.prompt, finalPrompt, fields: b.fields || null,
    styleId: b.styleId || null,
  });
}

route('POST', '/api/projects/:id/generate', async (req, { p }) => startGenJob(p, await readJson(req)));

// One click, many scenes: each preset becomes its own job (the relay queue keeps it at 3 at a time).
route('POST', '/api/projects/:id/batch', async (req, { p }) => {
  const b = await readJson(req);
  need(Array.isArray(b.presets) && b.presets.length, '先勾选要出的场景');
  return b.presets.map(key => {
    const preset = PRESETS[key];
    need(preset, '没有这个场景预设：' + key);
    const { label, ...fields } = preset;
    const f = { ...fields, aspect: b.aspect || '3:4', face: b.face || '', extra: b.extra || '' };
    return startGenJob(p, { ...b, prompt: buildPrompt(f), fields: f });
  });
});

// Same job again; count defaults to the original, use the missing count to retry a partial failure.
route('POST', '/api/projects/:id/jobs/:jobId/rerun', async (req, { p, jobId }) => {
  const j = p.jobs.find(x => x.id === jobId);
  need(j, '任务不存在', 404);
  const b = await readJson(req);
  const { id, status, createdAt, finishedAt, outputs, errors, ...fields } = j;
  const count = Math.min(Math.max(Number(b.count) || j.count, 1), 4);
  return startJob(p, { ...fields, count, rerunOf: j.id });
});

route('POST', '/api/projects/:id/swap', async (req, { p }) => {
  const b = await readJson(req);
  const face = findFace(p, b.faceId);
  need(face, '先选一个模特');
  resolveIn(p, b.source);
  const model = MODELS.find(m => m.id === b.model && m.refs) || MODELS[0];
  const prompt = swapPrompt(face.desc);
  return startJob(p, {
    type: 'swap', model: model.id, size: SIZES[b.aspect] || SIZES['3:4'], count: Math.min(Math.max(Number(b.count) || 1, 1), 4),
    post: postKey(b.post), faceId: face.id, source: b.source, refs: [b.source, face.file], prompt, finalPrompt: prompt,
  });
});

route('POST', '/api/projects/:id/star', async (req, { p }) => {
  const { file, star } = await readJson(req);
  const o = allOutputs(p).find(x => x.file === file);
  need(o, '找不到这张图', 404);
  o.star = Math.min(Math.max(Number(star) || 0, 0), 5);
  saveProject(p);
  return o;
});

// Re-run post-processing on an existing output without regenerating it.
route('POST', '/api/projects/:id/repost', async (req, { p }) => {
  const { file, preset } = await readJson(req);
  const o = allOutputs(p).find(x => x.file === file);
  need(o, '找不到这张图', 404);
  const key = postKey(preset);
  if (!key) { o.final = null; o.post = null; saveProject(p); return o; }
  const raw = resolveIn(p, o.file);
  const final = raw.replace(/\.\w+$/, `_${key}.jpg`);
  await postProcess(raw, final, key);
  o.final = relTo(p, final);
  o.post = key;
  saveProject(p);
  return o;
});

route('POST', '/api/projects/:id/export', async (req, { p }) => {
  const { files, cols, aiLabel = true } = await readJson(req);
  need(Array.isArray(files) && files.length, '先勾选要导出的图');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const outDir = path.join(projectDir(p.id), 'exports', stamp);
  fs.mkdirSync(outDir, { recursive: true });
  const copied = files.map((r, i) => {
    const src = resolveIn(p, r);
    const dst = path.join(outDir, `${String(i + 1).padStart(2, '0')}${path.extname(src)}`);
    fs.copyFileSync(src, dst);
    return dst;
  });
  const c = Number(cols) || (copied.length <= 4 ? copied.length : 3);
  const gridFile = path.join(outDir, `拼图_${copied.length}张.jpg`);
  await grid(copied, gridFile, { cols: c });
  if (aiLabel) {
    const tmp = gridFile.replace(/\.jpg$/, '_tmp.jpg');
    await addAiLabel(gridFile, tmp);
    fs.renameSync(tmp, gridFile);
  }
  fs.writeFileSync(path.join(outDir, '发布前必读.txt'), [
    '这些图片由 AI 生成。',
    '抖音、小红书等平台要求发布 AI 生成内容时主动声明：发布页勾选「内容由 AI 生成」或在文案里写明。',
    aiLabel ? '拼图右下角已加「AI 生成」标识；单张原图未加。' : '本次导出没有加「AI 生成」角标。',
    '用真人照片做模特/换脸的图，发布前需要本人同意。',
  ].join('\r\n'), 'utf8');
  openFolder(outDir);
  return { dir: relTo(p, outDir) };
});

route('POST', '/api/projects/:id/open', async (req, { p }) => {
  const { rel } = await readJson(req);
  const abs = resolveIn(p, rel || '.');
  openFolder(fs.existsSync(abs) && fs.statSync(abs).isFile() ? path.dirname(abs) : abs);
  return { ok: true };
});

// ---- health ------------------------------------------------------------------

async function ping(url, headers = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    return { ok: r.status < 500, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.cause?.code || e.name, ms: Date.now() - t0 };
  }
}

// Quick reachability plus what real generations have seen; ?long=1 also holds a 15 s request open,
// which is what a local proxy that kills long connections breaks.
route('GET', '/api/health', async req => {
  const k = loadKeys();
  const th = await loadTikhub().catch(() => null);
  const [relay, tikhub] = await Promise.all([ping(k.base + '/models', { Authorization: 'Bearer ' + k.gpt }), th ? ping(th.base + '/') : { ok: false, error: '未配置' }]);
  const out = { relay, tikhub, gen: connStats, queue: queueState() };
  if (new URL(req.url, 'http://x').searchParams.get('long')) {
    const t0 = Date.now();
    try {
      const r = await fetch('https://postman-echo.com/delay/15', { signal: AbortSignal.timeout(30000) });
      out.long = { ok: r.ok, status: r.status, sec: Math.round((Date.now() - t0) / 1000) };
    } catch (e) {
      out.long = { ok: false, error: e.cause?.code || e.name, sec: Math.round((Date.now() - t0) / 1000) };
    }
  }
  return out;
});

// ---- style cards -------------------------------------------------------------

route('GET', '/api/styles', () => listStyles());

// Save the project's current moodboard + form + its 4-5 star outputs as a reusable style card.
route('POST', '/api/projects/:id/styles', async (req, { p }) => {
  const b = await readJson(req);
  const refs = p.moodboard.map(r => resolveIn(p, r));
  const best = allOutputs(p).filter(o => o.star >= 4).sort((x, y) => y.star - x.star).slice(0, 6)
    .map(o => resolveIn(p, o.final || o.file));
  need(refs.length || best.length, '先勾 moodboard 或给满意的图打 4 星以上');
  return saveStyle({ id: b.updateId || null, name: b.name, notes: b.notes, fields: b.fields, post: b.post, model: b.model, refs, best, sourceProject: p.id });
});

// Copy a style card's images into the project as a case, set its refs as moodboard, return form settings.
route('POST', '/api/projects/:id/styles/:styleId/apply', (req, { p, styleId }) => {
  const st = getStyle(styleId);
  need(st, '风格卡不存在', 404);
  const relDir = 'refs/style_' + st.id;
  const dir = resolveIn(p, relDir);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const copy = (sub, name) => { fs.copyFileSync(path.join(styleDir(st.id), sub, name), path.join(dir, sub + '_' + name)); return relDir + '/' + sub + '_' + name; };
  const refs = st.refs.map(n => copy('refs', n));
  const best = st.best.map(n => copy('best', n));
  p.cases = p.cases.filter(c => c.awemeId !== 'style_' + st.id);
  p.cases.unshift({ awemeId: 'style_' + st.id, type: 'style', author: st.name, desc: st.notes, images: [...refs, ...best], authorPrompt: '' });
  p.moodboard = (refs.length ? refs : best).slice(0, 3);
  saveProject(p);
  return { style: st, moodboard: p.moodboard };
});

route('DELETE', '/api/styles/:styleId', (req, { styleId }) => { deleteStyle(styleId); return { ok: true }; });

function openFolder(dir) {
  spawn('explorer.exe', [dir.replace(/\//g, '\\')], { detached: true, stdio: 'ignore' }).unref();
}

// ---- server -----------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith('/styles/')) {
      const [, , sid, ...rest] = pathname.split('/');
      need(getStyle(sid), '风格卡不存在', 404);
      const base = styleDir(sid);
      const abs = path.resolve(base, rest.join('/'));
      need(abs.startsWith(base + path.sep), '非法路径', 403);
      return serveFile(res, abs);
    }
    if (pathname.startsWith('/files/')) {
      const [, , id, ...rest] = pathname.split('/');
      const p = getProject(id);
      need(p, '项目不存在', 404);
      return serveFile(res, resolveIn(p, rest.join('/')));
    }
    if (pathname.startsWith('/api/')) {
      for (const r of routes) {
        const m = r.method === req.method && r.re.exec(pathname);
        if (!m) continue;
        const params = { ...m.groups };
        if (params.id) { params.p = getProject(params.id); need(params.p, '项目不存在', 404); }
        return send(res, 200, await r.handler(req, params));
      }
      return send(res, 404, { error: '没有这个接口' });
    }
    const file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
    need(file.startsWith(PUBLIC), '非法路径', 403);
    return serveFile(res, file);
  } catch (err) {
    send(res, err.status || 500, { error: err.status ? err.message : explainError(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`图片复刻 Studio: http://localhost:${PORT}`));
