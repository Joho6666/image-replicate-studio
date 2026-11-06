import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PORT, ROOT, loadKeys, loadTikhub } from './lib/config.mjs';
import { listProjects, createProject, getProject, saveProject, deleteProject, projectDir, resolveIn, relTo, newId } from './lib/store.mjs';
import { listClients, getClient, createClient, updateClient, requireConsent, addPhoto, removePhoto, markOrder, markDelivered, deleteClient, clientDir, TYPES } from './lib/clients.mjs';
import { fetchCase } from './lib/douyin.mjs';
import { MODELS, SIZES, generateImage, explainError, queueState, connStats } from './lib/relay.mjs';
import { asyncAvailable, originOf } from './lib/async-relay.mjs';
import { LIGHTS, STRENGTH, relightPrompt, withSmartLight } from './lib/relight.mjs';
import { makeLive, makeLiveGif, LIVE_PRESETS, GIF_PROMPTS, LIVE_MODEL } from './lib/live.mjs';
import { REALISM, withRealism } from './lib/realism.mjs';
import { detectPhotoBand, cropBand, DEFAULT_BAND } from './lib/screenshot.mjs';
import { buildReplicaPrompt } from './lib/replica.mjs';
import { jobSheet, normalizeQa, QA_CHECKS } from './lib/qa.mjs';
import { visionQa, visionConfig } from './lib/vision.mjs';
import { POSES, poseClause } from './lib/poses.mjs';
import { buildPrompt, composePrompt, swapPrompt, extractAuthorPrompt, SHOTS, FLASH, FRAMING, PRESETS, DEFAULT_FACE } from './lib/prompt.mjs';
import { listStyles, getStyle, saveStyle, deleteStyle, styleDir } from './lib/styles.mjs';
import { postProcess, cropImage, grid, removeGrokWatermark, addAiLabel, POST_PRESETS, DEFAULT_POST } from './lib/post.mjs';
import { imageExt } from './lib/net.mjs';

const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.json': 'application/json', '.gif': 'image/gif' };

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

// 实况图 job: each output is {file: mp4, poster, webp, gif, live: true}; the poster is what the gallery shows until the clip plays.
async function runLiveJob(p, job) {
  job.status = 'running';
  saveProject(p);
  const dir = projectDir(p.id);
  const src = resolveIn(p, job.source);
  const results = await Promise.allSettled(Array.from({ length: job.count }, async (_, i) => {
    const outBase = path.join(dir, 'outputs', `${job.id}_${i + 1}`);
    const out = job.mode === 'gif'
      ? await makeLiveGif({ imageFile: src, prompt: job.prompt, frames: job.frames, frameMs: job.frameMs, outBase, model: job.model })
      : await makeLive({ imageFile: src, prompt: job.prompt, seconds: job.seconds, outBase, model: job.model });
    job.outputs.push({ file: relTo(p, out.mp4), poster: relTo(p, out.poster), webp: relTo(p, out.webp), gif: relTo(p, out.gif), live: true, star: 0 });
    saveProject(p);
  }));
  job.errors.push(...results.filter(r => r.status === 'rejected').map(r => explainError(r.reason)));
  job.status = job.outputs.length === job.count ? 'done' : job.outputs.length ? 'partial' : 'failed';
  job.finishedAt = new Date().toISOString();
  saveProject(p);
}

// Smart light: after a generation finishes, relight each output once (default: match the scene's own light).
// The relight results are separate jobs (autoOf), the untouched generation stays in the gallery.
function chainAutoLight(p, job) {
  if (!job.autoLight || !LIGHTS[job.autoLight] || !job.outputs.length) return;
  const prompt = relightPrompt(job.autoLight, { strength: 'normal' });
  for (const o of job.outputs) {
    startJob(p, { type: 'relight', light: job.autoLight, autoOf: job.id, model: job.model, size: job.size, count: 1, post: job.post, source: o.file, refs: [o.file], prompt, finalPrompt: prompt });
  }
}

function startJob(p, fields) {
  const job = { id: newId('j'), status: 'queued', createdAt: new Date().toISOString(), outputs: [], errors: [], ...fields };
  p.jobs.push(job);
  saveProject(p);
  (job.type === 'live' ? runLiveJob(p, job) : runJob(p, job))
    .then(() => chainAutoLight(p, job))
    .catch(e => { job.status = 'failed'; job.errors.push(explainError(e)); saveProject(p); });
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
  qaChecks: QA_CHECKS,
  poses: Object.fromEntries(Object.entries(POSES).map(([k, v]) => [k, { label: v.label, framing: v.framing }])),
  realisms: Object.fromEntries(Object.entries(REALISM).map(([k, v]) => [k, v.label])),
  livePresets: Object.fromEntries(Object.entries(LIVE_PRESETS).map(([k, v]) => [k, { label: v.label, prompt: v.prompt, gifPrompt: GIF_PROMPTS[k] }])),
  lights: Object.fromEntries(Object.entries(LIGHTS).map(([k, v]) => [k, v.label])), strengths: STRENGTH,
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
  need(!b.model || MODELS.some(m => m.id === b.model), '服务不认识这个模型：' + b.model + '（新加的模型要重启服务）');
  const model = MODELS.find(m => m.id === b.model) || MODELS[0];
  const count = Math.min(Math.max(Number(b.count) || 1, 1), 4);
  const face = b.faceId ? findFace(p, b.faceId) : null;
  need(!b.faceId || face, '模特不存在');
  const moodboard = (Array.isArray(b.moodboard) ? b.moodboard : p.moodboard).slice(0, 3);
  moodboard.forEach(r => resolveIn(p, r));
  const faceFiles = face ? [face.file, ...(face.extra || [])] : [];
  const bodyFiles = face && b.includeBody !== false ? (p.bodyRefs || []).slice(0, 2) : [];
  const refs = model.refs ? [...faceFiles, ...bodyFiles, ...moodboard] : [];
  const styled = withRealism(`${b.prompt} ${poseClause(b.pose)}`.trim(), b.realism);
  const lit = b.smartLight === false ? styled : withSmartLight(styled);
  const finalPrompt = model.refs ? composePrompt(lit, { hasFace: !!face, faceCount: faceFiles.length, bodyCount: bodyFiles.length, moodboard: moodboard.length }) : lit;
  const autoLight = b.autoLight === true ? 'scene_match' : (LIGHTS[b.autoLight] ? b.autoLight : null);
  return startJob(p, {
    type: 'gen', model: model.id, aspect: b.aspect || '3:4', size: SIZES[b.aspect] || SIZES['3:4'], count,
    post: postKey(b.post), faceId: face?.id || null, refs, prompt: b.prompt, finalPrompt, fields: b.fields || null,
    styleId: b.styleId || null, autoLight: model.refs ? autoLight : null, pose: POSES[b.pose] ? b.pose : null, replica: b.replica || null, realism: REALISM[b.realism] ? b.realism : 'off',
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

route('POST', '/api/projects/:id/live', async (req, { p }) => {
  const b = await readJson(req);
  resolveIn(p, b.source);
  const preset = LIVE_PRESETS[b.preset] || LIVE_PRESETS.breeze;
  const mode = b.mode === 'video' ? 'video' : 'gif';
  const prompt = (b.prompt && b.prompt.trim()) || (mode === 'gif' ? GIF_PROMPTS[b.preset] || GIF_PROMPTS.breeze : preset.prompt);
  const seconds = Math.min(Math.max(Number(b.seconds) || 3, 2), 5);
  return startJob(p, {
    type: 'live', mode, model: mode === 'gif' ? 'gpt-image-2.6-flare' : LIVE_MODEL, frames: Math.min(Math.max(Number(b.frames) || 6, 2), 16), frameMs: Math.min(Math.max(Number(b.frameMs) || 120, 60), 400), count: Math.min(Math.max(Number(b.count) || 2, 1), 4), seconds,
    post: null, source: b.source, refs: [b.source], prompt, finalPrompt: prompt,
  });
});

// ---- 复刻换人: upload a reference (usually a phone screenshot), crop the UI away, swap in the model ----------------------
function addUploadRef(p, abs) {
  let up = p.cases.find(c => c.awemeId === 'upload');
  if (!up) { up = { awemeId: 'upload', type: 'upload', desc: '我上传的参考图', author: '', images: [] }; p.cases.push(up); }
  up.images.push(relTo(p, abs));
  saveProject(p);
}

route('POST', '/api/projects/:id/replica-ref', async (req, { p }) => {
  const { dataUrl, crop = true } = await readJson(req);
  const orig = saveDataUrl(p, dataUrl, 'refs/shots');
  const band = crop ? await detectPhotoBand(orig) : { top: 0, bottom: 1, auto: false };
  const cropped = path.join(projectDir(p.id), 'refs', 'upload', `${newId()}.jpg`);
  fs.mkdirSync(path.dirname(cropped), { recursive: true });
  await cropBand(orig, cropped, band);
  addUploadRef(p, cropped);
  return { original: relTo(p, orig), file: relTo(p, cropped), top: band.top, bottom: band.bottom, auto: band.auto };
});

route('POST', '/api/projects/:id/replica-recrop', async (req, { p }) => {
  const b = await readJson(req);
  const orig = resolveIn(p, b.original);
  const top = Math.min(Math.max(Number(b.top), 0), 0.9), bottom = Math.min(Math.max(Number(b.bottom), top + 0.1), 1);
  const cropped = path.join(projectDir(p.id), 'refs', 'upload', `${newId()}.jpg`);
  await cropBand(orig, cropped, { top, bottom });
  addUploadRef(p, cropped);
  return { original: b.original, file: relTo(p, cropped), top, bottom, auto: false };
});

route('POST', '/api/projects/:id/replica', async (req, { p }) => {
  const b = await readJson(req);
  resolveIn(p, b.source);
  need(b.faceId && findFace(p, b.faceId), '先选一个模特');
  need(b.outfitMode !== 'change' || (b.outfit || '').trim(), '选了「换成指定衣服」要写衣服');
  const prompt = buildReplicaPrompt({ outfitMode: b.outfitMode, outfit: b.outfit, identity: b.identity, hair: b.hair, removeUi: b.removeUi !== false, keepExpression: !!b.keepExpression });
  return startGenJob(p, { ...b, prompt, moodboard: [b.source], aspect: '3:4', count: b.count || 2, includeBody: b.includeBody !== false && !!(p.bodyRefs || []).length, fields: null, replica: { source: b.source, outfitMode: b.outfitMode || 'keep' } });
});

// ---- QA for an agent that can see images ------------------------------------------------------------------------
// The agent opens the sheet with its own image-reading tool, judges the checks in QA_CHECKS and posts the verdict back.
route('POST', '/api/projects/:id/jobs/:jobId/qa-sheet', async (req, { p, jobId }) => {
  const job = p.jobs.find(x => x.id === jobId);
  need(job, '任务不存在', 404);
  const { file, layout } = await jobSheet(p, job, { resolveIn, projectDir });
  return { file: relTo(p, file), abs: file, layout, outputs: job.outputs.filter(o => !o.live).map(o => o.file), checks: QA_CHECKS };
});

// Automatic first pass by a vision model (relay chat model by default). Writes the same QA record the agent would.
route('POST', '/api/projects/:id/jobs/:jobId/auto-qa', async (req, { p, jobId }) => {
  const job = p.jobs.find(x => x.id === jobId);
  need(job, '任务不存在', 404);
  const sheet = await jobSheet(p, job, { resolveIn, projectDir });
  const stills = job.outputs.filter(o => !o.live);
  const out = await visionQa(sheet.file, { referenceFirst: /^reference scene/.test(sheet.layout.row2), results: stills.length });
  const applied = [];
  for (const r of out.results) {
    const o = stills[(Number(r.index) || 0) - 1];
    if (!o) continue;
    o.qa = normalizeQa({ checks: r.checks, note: r.note, by: out.model });
    applied.push({ file: o.file, verdict: o.qa.verdict });
  }
  need(applied.length, '看图模型没有给出可用的结果，可以重试');
  saveProject(p);
  return { model: out.model, applied };
});

route('GET', '/api/vision', () => { const c = visionConfig(); return { model: c.model, base: c.base ? new URL(c.base).host : '', hasKey: !!c.key }; });

route('POST', '/api/projects/:id/qa', async (req, { p }) => {
  const b = await readJson(req);
  const o = allOutputs(p).find(x => x.file === b.file);
  need(o, '找不到这张图', 404);
  o.qa = normalizeQa(b);
  saveProject(p);
  return o.qa;
});

// One click, one pose each: the same prompt/model/face with a different pose per job (same person and outfit across the set).
route('POST', '/api/projects/:id/pose-set', async (req, { p }) => {
  const b = await readJson(req);
  need(Array.isArray(b.poseIds) && b.poseIds.length, '先勾选姿势');
  need(b.poseIds.every(id => POSES[id]), '有不认识的姿势');
  return b.poseIds.slice(0, 12).map(pose => startGenJob(p, { ...b, pose, count: b.count || 1 }));
});

route('POST', '/api/projects/:id/swap', async (req, { p }) => {
  const b = await readJson(req);
  const face = findFace(p, b.faceId);
  need(face, '先选一个模特');
  resolveIn(p, b.source);
  need(!b.model || MODELS.some(m => m.id === b.model), '服务不认识这个模型：' + b.model + '（新加的模型要重启服务）');
  const model = MODELS.find(m => m.id === b.model && m.refs) || MODELS[0];
  const prompt = swapPrompt(face.desc);
  return startJob(p, {
    type: 'swap', model: model.id, size: SIZES[b.aspect] || SIZES['3:4'], count: Math.min(Math.max(Number(b.count) || 1, 1), 4),
    post: postKey(b.post), faceId: face.id, source: b.source, refs: [b.source, face.file], prompt, finalPrompt: prompt,
  });
});

// Re-light an existing output (edit pass on the source image; pose, outfit and background stay).
route('POST', '/api/projects/:id/relight', async (req, { p }) => {
  const b = await readJson(req);
  resolveIn(p, b.source);
  need(LIGHTS[b.light], '没有这种灯型');
  need(!b.model || MODELS.some(m => m.id === b.model), '服务不认识这个模型：' + b.model + '（新加的模型要重启服务）');
  const model = MODELS.find(m => m.id === b.model && m.refs) || MODELS[0];
  const prompt = relightPrompt(b.light, { strength: b.strength, extra: b.extra || '' });
  return startJob(p, {
    type: 'relight', light: b.light, model: model.id, size: SIZES[b.aspect] || SIZES['3:4'], count: Math.min(Math.max(Number(b.count) || 1, 1), 4),
    post: postKey(b.post), source: b.source, refs: [b.source], prompt, finalPrompt: prompt,
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
  const { files, cols, aiLabel = true, checked } = await readJson(req);
  // Customer work only leaves the app after the quality checklist is confirmed.
  need(!p.clientId || checked === true, '客户订单要先在导出弹窗里勾完质检清单');
  need(Array.isArray(files) && files.length, '先勾选要导出的图');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const outDir = path.join(projectDir(p.id), 'exports', stamp);
  fs.mkdirSync(outDir, { recursive: true });
  const live = allOutputs(p).filter(o => o.live && files.includes(o.file));
  const stills = files.filter(r => !live.some(o => o.file === r));
  need(stills.length || live.length, '先勾选要导出的图');
  for (const o of live) for (const key of ['file', 'webp', 'gif']) {
    const src = resolveIn(p, o[key]);
    fs.copyFileSync(src, path.join(outDir, `实况_${path.basename(src)}`));
  }
  const copied = stills.map((r, i) => {
    const src = resolveIn(p, r);
    const dst = path.join(outDir, `${String(i + 1).padStart(2, '0')}${path.extname(src)}`);
    fs.copyFileSync(src, dst);
    return dst;
  });
  const c = Number(cols) || (copied.length <= 4 ? copied.length : 3);
  const gridFile = path.join(outDir, `拼图_${copied.length}张.jpg`);
  if (copied.length) await grid(copied, gridFile, { cols: c });
  if (aiLabel && copied.length) {
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

// ---- clients ------------------------------------------------------------------

route('GET', '/api/clients', () => ({ types: TYPES, clients: listClients() }));
route('POST', '/api/clients', async req => createClient(await readJson(req)));

// Client dossier: the client card, headline numbers and one entry per order (project) with a few result thumbnails.
route('GET', '/api/clients/:cid/dossier', (req, { cid }) => {
  const c = getClient(cid);
  need(c, '客户不存在', 404);
  const full = listClients().find(x => x.id === cid) || c;
  const ids = [...new Set([...(c.orders || []), ...listProjects().filter(p => p.clientId === cid).map(p => p.id)])];
  const orders = ids.map(id => getProject(id)).filter(Boolean).map(p => {
    const outs = p.jobs.flatMap(j => j.outputs.map(o => ({ ...o, job: j }))).filter(o => !o.live);
    const live = p.jobs.flatMap(j => j.outputs).filter(o => o.live).length;
    const pick = [...outs].sort((a, b) => (b.star || 0) - (a.star || 0) || (b.job.createdAt || '').localeCompare(a.job.createdAt || '')).slice(0, 4);
    return {
      projectId: p.id, name: p.name, createdAt: p.createdAt, jobs: p.jobs.length, images: outs.length, live,
      starred: outs.filter(o => o.star >= 4).length, qaPass: outs.filter(o => o.qa?.verdict === 'pass').length, qaChecked: outs.filter(o => o.qa).length,
      thumbs: pick.map(o => o.final || o.file),
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sum = k => orders.reduce((n, o) => n + o[k], 0);
  return {
    client: full,
    stats: { orders: orders.length, images: sum('images'), starred: sum('starred'), qaPass: sum('qaPass'), live: sum('live'), photos: c.faces.length + c.bodies.length, daysLeft: full.daysLeft, expired: !!full.expired },
    orders,
  };
});
route('GET', '/api/clients/:cid', (req, { cid }) => { const c = getClient(cid); need(c, '客户不存在', 404); return c; });
route('PATCH', '/api/clients/:cid', async (req, { cid }) => updateClient(cid, await readJson(req)));

route('POST', '/api/clients/:cid/photos', async (req, { cid }) => {
  const { kind, dataUrl } = await readJson(req);
  const m = /^data:image\/[\w+.-]+;base64,(.+)$/.exec(dataUrl || '');
  need(m, '只支持图片');
  const buf = Buffer.from(m[1], 'base64');
  return addPhoto(cid, kind, buf, imageExt(buf));
});
route('DELETE', '/api/clients/:cid/photos', async (req, { cid }) => { const { kind, file } = await readJson(req); return removePhoto(cid, kind, file); });
route('POST', '/api/clients/:cid/delivered', (req, { cid }) => markDelivered(cid));

// New order = a project linked to the client: faces become one face pack, body photos become reference photos.
route('POST', '/api/clients/:cid/orders', async (req, { cid }) => {
  const { name } = await readJson(req);
  const c = getClient(cid);
  need(c, '客户不存在', 404);
  try { requireConsent(c); } catch (e) { throw new HttpError(400, e.message); }
  need(c.faces.length, '先上传至少 1 张脸部照片');
  const p = createProject(name || `${c.name} · ${new Date().toISOString().slice(0, 10)}`, { clientId: c.id, bodyRefs: [] });
  const copy = (rel, sub, tag) => {
    const dst = path.join(projectDir(p.id), sub, `${tag}_${path.basename(rel)}`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(clientDir(c.id), rel), dst);
    return relTo(p, dst);
  };
  const files = c.faces.map(r => copy(r, 'faces', 'client'));
  p.faces.push({ id: newId('f'), name: c.name, desc: '', file: files[0], extra: files.slice(1, 3), createdAt: new Date().toISOString() });
  p.bodyRefs = c.bodies.slice(0, 2).map(r => copy(r, 'refs/body', 'body'));
  saveProject(p);
  markOrder(c.id, p.id);
  return p;
});

// Remove the customer's photos, record and (optionally) every order they produced.
route('DELETE', '/api/clients/:cid', async (req, { cid }) => {
  const c = getClient(cid);
  need(c, '客户不存在', 404);
  const { purgeProjects } = await readJson(req);
  if (purgeProjects) for (const pid of c.orders) deleteProject(pid);
  else for (const pid of c.orders) { const p = getProject(pid); if (p) { p.faces = []; p.bodyRefs = []; fs.rmSync(path.join(projectDir(pid), 'faces'), { recursive: true, force: true }); fs.rmSync(path.join(projectDir(pid), 'refs', 'body'), { recursive: true, force: true }); saveProject(p); } }
  deleteClient(cid);
  return { ok: true, purged: !!purgeProjects };
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
  const out = { relay, tikhub, async: await asyncAvailable(originOf(k.base), { force: true }), gen: connStats, queue: queueState() };
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
  const best = allOutputs(p).filter(o => o.star >= 4 && !o.live).sort((x, y) => y.star - x.star).slice(0, 6)
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
    if (pathname.startsWith('/cfiles/')) {
      const [, , cid, ...rest] = pathname.split('/');
      need(getClient(cid), '客户不存在', 404);
      const base = clientDir(cid);
      const abs = path.resolve(base, rest.join('/'));
      need(abs.startsWith(base + path.sep), '非法路径', 403);
      return serveFile(res, abs);
    }
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
