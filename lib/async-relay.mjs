// Async image protocol served next to the relay (see docs/server-async-prompt.md):
// POST /async/v1/images/{generations|edits} -> {id}; GET /async/v1/jobs/{id} until succeeded/failed;
// GET the image URL from the job. Every request is short, so a local proxy that kills long
// connections (FlClash TUN cutting at ~6 s) no longer breaks generation.

export class RelayError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export const originOf = base => base.replace(/\/v1\/?$/, '');

const detected = new Map(); // origin -> { ok, at }
const DETECT_TTL = 5 * 60 * 1000;

// True when the relay host answers /async/health with JSON {ok:true}. A web UI fallback page (HTML) is a no.
export async function asyncAvailable(origin, { force = false } = {}) {
  const hit = detected.get(origin);
  if (!force && hit && Date.now() - hit.at < DETECT_TTL) return hit.ok;
  let ok = false;
  // A flaky first request must not decide "no async" (and fall back to the sync path that long-connection
  // cuts break): retry network errors, and only cache a definite answer from the server.
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(origin + '/async/health', { signal: AbortSignal.timeout(8000) });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) ok = (await r.json()).ok === true;
      detected.set(origin, { ok, at: Date.now() });
      return ok;
    } catch { await sleep(1500); }
  }
  return false;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pollMs = () => Number(process.env.IRS_ASYNC_POLL_MS || 4000);

function failedToError(err = {}) {
  let body = err.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
  const inner = (body && typeof body === 'object' && (body.error || body)) || {};
  const message = inner.message || (typeof body === 'string' ? body : JSON.stringify(body ?? err)).slice(0, 300);
  return new RelayError(message, err.status || 502, inner.code);
}

// Submit, poll and download one image. Returns { buffer, jobId }.
export async function runAsyncJob({ origin, auth, kind, json, form, timeoutMs = 6 * 60 * 1000 }) {
  const sub = await fetch(`${origin}/async/v1/images/${kind}`, {
    method: 'POST',
    headers: form ? auth : { ...auth, 'Content-Type': 'application/json' },
    body: form || JSON.stringify(json),
    signal: AbortSignal.timeout(60000),
  });
  const s = await sub.json().catch(() => ({}));
  if (!sub.ok || !s.id) {
    const e = s.error || s;
    throw new RelayError(e.message || `异步提交失败（HTTP ${sub.status}）`, sub.status, e.code);
  }

  const deadline = Date.now() + timeoutMs;
  let netErrors = 0;
  while (Date.now() < deadline) {
    await sleep(pollMs());
    let job;
    try {
      const r = await fetch(`${origin}/async/v1/jobs/${s.id}`, { headers: auth, signal: AbortSignal.timeout(15000) });
      if (r.status === 404) throw new RelayError('异步任务查不到了（服务器重启或 key 不匹配）', 404);
      job = await r.json();
      netErrors = 0;
    } catch (e) {
      if (e instanceof RelayError) throw e;
      if (++netErrors >= 8) throw e; // a few flaky polls are fine; a dead connection is not
      continue;
    }
    if (job.status === 'failed') throw failedToError(job.error);
    if (job.status !== 'succeeded') continue;
    const img = job.images?.[0];
    if (!img?.url) throw new RelayError('异步任务成功了但没有返回图片', 502);
    const url = img.url.startsWith('http') ? img.url : origin + img.url;
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(url, { headers: auth, signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new RelayError(`下载图片失败（HTTP ${r.status}）`, r.status);
        return { buffer: Buffer.from(await r.arrayBuffer()), jobId: s.id };
      } catch (e) {
        if (i >= 2) throw e;
        await sleep(2000);
      }
    }
  }
  throw new RelayError('异步任务超时（6 分钟没出结果）', 504);
}
