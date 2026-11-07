// Quality-check support for an agent that can look at images (Claude Code reading the sheet with its Read tool).
// The app does not judge the pictures: it builds one contact sheet per job (the model's face photos, the reference scene,
// the results) and stores the agent's verdict on each output so the gallery can show it.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FFMPEG } from './config.mjs';

const run = promisify(execFile);

export const QA_CHECKS = {
  likeness: '像不像本人（脸型、五官、痣的位置、发型）',
  overlay: '没有截屏残留（按钮、头像、文字、页码）',
  anatomy: '手指和肢体、头身比正常',
  outfit: '衣服符合要求（保留原衣服 / 与描述一致、完全遮盖）',
  background: '背景和参考图一致，没有多出或缺失的大件',
  boundary: '没有触碰我们不做的内容（情色倾向、校服、突出腿脚等）',
};
export const QA_VERDICTS = ['pass', 'retry', 'fail', 'unsure'];

const CELL_H = 640;

// rows: arrays of absolute image paths; every row is scaled to CELL_H high and padded to the widest row.
export async function buildSheet(rows, dst) {
  const inputs = [], filters = [], rowLabels = [];
  let n = 0;
  for (const row of rows) {
    const labels = [];
    for (const f of row) { inputs.push('-i', f); filters.push(`[${n}]scale=-2:${CELL_H}[c${n}]`); labels.push(`[c${n}]`); n++; }
    rowLabels.push(labels);
  }
  const W = 2400;
  // hstack needs at least 2 inputs; a row with a single picture (e.g. a model with one face photo) is padded directly
  const rowOut = rowLabels.map((labels, i) => `${labels.join('')}${labels.length > 1 ? `hstack=${labels.length},` : ''}pad=${W}:${CELL_H}:0:0:white[r${i}]`);
  const graph = [...filters, ...rowOut, `${rowLabels.map((_, i) => `[r${i}]`).join('')}vstack=${rowLabels.length}[out]`].join(';');
  await run(FFMPEG, ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-q:v', '3', dst]);
  return dst;
}

// Sheet layout: row 1 = the model's face photos, row 2 = reference scene (if any) then the results (final jpg when present).
export async function jobSheet(p, job, { resolveIn, projectDir }) {
  const face = p.faces.find(f => f.id === job.faceId);
  const faces = face ? [face.file, ...(face.extra || [])].map(f => resolveIn(p, f)).filter(f => fs.existsSync(f)) : [];
  // reference scene: explicit source, else the moodboard image (last reference) when the job used more refs than the model's photos
  const faceN = face ? 1 + (face.extra || []).length : 0;
  const ref = job.replica?.source || job.source || (job.refs && job.refs.length > faceN ? job.refs[job.refs.length - 1] : null);
  const outs = job.outputs.filter(o => !o.live).map(o => resolveIn(p, o.final || o.file));
  if (!outs.length) throw new Error('这个任务还没有可检查的图');
  const row2 = [...(ref ? [resolveIn(p, ref)] : []), ...outs];
  // row 3: upper half of each result at full resolution, so the face (mole, eyes, hair) can actually be judged
  const zoomDir = path.join(projectDir(p.id), 'exports', `_qa_zoom_${job.id}`);
  fs.mkdirSync(zoomDir, { recursive: true });
  const zooms = [];
  for (const [i, f] of outs.entries()) {
    const z = path.join(zoomDir, `${i + 1}.jpg`);
    await run(FFMPEG, ['-loglevel', 'error', '-y', '-i', f, '-vf', 'crop=iw:ih*0.5:0:0', '-q:v', '2', z]);
    zooms.push(z);
  }
  const rows = [faces.slice(0, 4), row2, zooms].filter(r => r.length);
  const dst = path.join(projectDir(p.id), 'exports', `qa_${job.id}.jpg`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  await buildSheet(rows, dst);
  return { file: dst, layout: { row1: 'model face photos (' + faces.slice(0, 4).length + ')', row2: (ref ? 'reference scene, then ' : '') + outs.length + ' result(s)', row3: 'upper half of each result, zoomed' } };
}

// Normalise an agent verdict: only known checks, ok boolean, short note.
export function normalizeQa(input = {}) {
  const checks = {};
  for (const k of Object.keys(QA_CHECKS)) {
    const c = input.checks?.[k];
    if (c) checks[k] = { ok: c.ok === null || c.ok === undefined ? null : !!c.ok, note: String(c.note || '').slice(0, 200) };
  }
  const vals = Object.values(checks);
  // ok:null = could not tell. Any failed check -> retry; otherwise any unknown -> unsure; never a pass on guesses.
  const derived = !vals.length ? 'retry' : vals.some(c => c.ok === false) ? 'retry' : vals.some(c => c.ok === null) ? 'unsure' : 'pass';
  const verdict = QA_VERDICTS.includes(input.verdict) ? (input.verdict === 'pass' && derived !== 'pass' ? derived : input.verdict) : derived;
  return { verdict, checks, note: String(input.note || '').slice(0, 300), by: String(input.by || 'agent').slice(0, 40), at: new Date().toISOString() };
}
