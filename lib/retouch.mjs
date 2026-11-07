import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FFMPEG, ROOT } from './config.mjs';
import { POST_PRESETS } from './post.mjs';

const exec = promisify(execFile);
const ff = args => exec(FFMPEG, ['-loglevel', 'error', '-y', ...args]);

// 修图卡 (workbench retouch card): a recipe = a base look (one of the post presets, or none) blended in at `strength`,
// plus five small adjustments. Everything runs locally in ffmpeg: free and about a second per image.
export const ADJUST = {
  bright: { label: '亮度', min: -50, max: 50 },
  contrast: { label: '对比', min: -50, max: 50 },
  sat: { label: '饱和', min: -50, max: 50 },
  temp: { label: '色温', min: -50, max: 50 },
  grain: { label: '颗粒', min: 0, max: 50 },
};
const BUILTIN = [
  { id: 'none', name: '不套滤镜（只微调）', recipe: { base: 'none', strength: 100, adj: {} } },
  ...Object.entries(POST_PRESETS).map(([k, v]) => ({ id: k, name: v.label, recipe: { base: k, strength: 100, adj: {} } })),
];

const RECIPES = path.join(ROOT, 'data', 'recipes.json');
const readUser = () => { try { return JSON.parse(fs.readFileSync(RECIPES, 'utf8')); } catch { return []; } };
export const listRecipes = () => [...BUILTIN.map(r => ({ ...r, builtin: true })), ...readUser()];
export function saveRecipe(name, recipe) {
  const list = readUser();
  const r = { id: 'r' + Date.now().toString(36), name: String(name || '').trim().slice(0, 30) || '我的配方', recipe: cleanRecipe(recipe) };
  list.push(r);
  fs.mkdirSync(path.dirname(RECIPES), { recursive: true });
  fs.writeFileSync(RECIPES, JSON.stringify(list, null, 2));
  return r;
}
export function deleteRecipe(id) {
  fs.writeFileSync(RECIPES, JSON.stringify(readUser().filter(r => r.id !== id), null, 2));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
export function cleanRecipe(r = {}) {
  const adj = {};
  for (const [k, s] of Object.entries(ADJUST)) { const v = Math.round(clamp(r.adj?.[k], s.min, s.max)); if (v) adj[k] = v; }
  return { base: POST_PRESETS[r.base] ? r.base : 'none', strength: Math.round(clamp(r.strength ?? 100, 0, 100)), adj };
}

// Preset chains end in a fixed 1080 px resize; the card scales once up front instead, so the blend inputs match.
const presetChain = key => POST_PRESETS[key].vf.replace(/,?scale=[^,]*$/, '');
function adjustChain(adj) {
  const f = [];
  const b = adj.bright || 0, c = adj.contrast || 0, s = adj.sat || 0, t = adj.temp || 0, g = adj.grain || 0;
  if (b || c || s) f.push(`eq=brightness=${(b * 0.003).toFixed(3)}:contrast=${(1 + c * 0.008).toFixed(3)}:saturation=${(1 + s * 0.012).toFixed(3)}`);
  if (t) f.push(`colorbalance=rs=${(t * 0.002).toFixed(3)}:rm=${(t * 0.0025).toFixed(4)}:bs=${(-t * 0.002).toFixed(3)}:bm=${(-t * 0.0025).toFixed(4)}`);
  if (g) f.push(`noise=c0s=${Math.round(g * 0.35)}:c1s=${Math.round(g * 0.2)}:c2s=${Math.round(g * 0.2)}:allf=t`);
  return f;
}

// Per-channel mean / spread of an image, read from a 64 px thumbnail.
async function channelStats(file) {
  const { stdout } = await exec(FFMPEG, ['-loglevel', 'error', '-i', file, '-vf', 'scale=64:-2', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 22 });
  const out = [0, 1, 2].map(c => {
    let sum = 0, sq = 0, n = 0;
    for (let i = c; i < stdout.length; i += 3) { sum += stdout[i]; sq += stdout[i] * stdout[i]; n++; }
    const mean = sum / n;
    return { mean, sd: Math.sqrt(Math.max(1, sq / n - mean * mean)) };
  });
  return out;
}
// 按场景图配色: move each channel part of the way toward the scene image (mean and spread), with limits, so a
// replaced person and the kept background read as one photo. Partial on purpose: the content of the two differs.
export async function colorMatchFilter(src, ref, amount = 0.6) {
  const [a, b] = await Promise.all([channelStats(src), channelStats(ref)]);
  const parts = a.map((s, i) => {
    const gain = 1 + (clamp(b[i].sd / s.sd, 0.8, 1.25) - 1) * amount;
    // the mean lands `amount` of the way from its own value to the scene's
    const off = clamp(s.mean + (b[i].mean - s.mean) * amount - s.mean * gain, -30, 30);
    return `clip(val*${gain.toFixed(4)}+${off.toFixed(2)}\\,0\\,255)`;
  });
  return `lutrgb=r='${parts[0]}':g='${parts[1]}':b='${parts[2]}'`;
}

// Build the filter graph for one image. size: 1080 (social, default) or 'full' (keep the original width).
export async function retouchGraph(src, recipe, { ref = null, size = 1080 } = {}) {
  const r = cleanRecipe(recipe);
  const head = [size === 'full' ? null : `scale='min(${size},iw)':-2:flags=bicubic`, 'format=rgb24'].filter(Boolean);
  if (ref) head.push(await colorMatchFilter(src, ref));
  const tail = adjustChain(r.adj);
  if (r.base === 'none' || r.strength === 0) return `[0]${[...head, ...tail].join(',')}`;
  const look = `${presetChain(r.base)},format=rgb24`;
  if (r.strength === 100) return `[0]${[...head, look, ...tail].join(',')}`;
  // blend the look over the untouched image at `strength`
  return `[0]${head.join(',')},split[o][l];[l]${look}[p];[p][o]blend=all_mode=normal:all_opacity=${(r.strength / 100).toFixed(2)}${tail.length ? ',' + tail.join(',') : ''}`;
}

export async function retouch(src, dst, recipe, opts = {}) {
  const graph = await retouchGraph(src, recipe, opts);
  await ff(['-i', src, '-filter_complex', graph, '-frames:v', '1', '-q:v', '3', dst]);
  return dst;
}
