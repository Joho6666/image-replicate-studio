import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FFMPEG } from './config.mjs';

const exec = promisify(execFile);
const ff = args => exec(FFMPEG, ['-loglevel', 'error', '-y', ...args]);

// Post-processing presets. `phone` imitates an iPhone pipeline (2026-11-04 test, D:/research/realism/crops2.png):
// faint sensor noise -> noise-reduction smear -> light sharpening -> Smart-HDR-flat tone curve -> slight vignette,
// then 1080 px wide at JPEG q4 like a camera-roll/social upload. Keep it subtle: stronger noise reads as film grain.
export const POST_PRESETS = {
  phone: {
    label: '手机原图感（推荐）',
    vf: "colorbalance=rs=0.01:bs=-0.012,noise=c0s=3:c1s=3:c2s=3:allf=t,hqdn3d=3:2.5:0:0,unsharp=3:3:0.55:3:3:0,curves=all='0/0.03 0.5/0.51 1/0.975',vignette=angle=PI/7,scale=1080:-2:flags=bicubic",
    q: 4,
  },
  // 2026-11-05: phone + the manual finishing steps from public tutorials (more grain, deeper shadows, a little less
  // saturation, about 10% less clarity). Experimental: A/B against 'phone' before using it for clients.
  phone_plus: {
    label: '手机原图感 +（实验：更深阴影、更软）',
    vf: "colorbalance=rs=0.01:bs=-0.012,eq=saturation=0.94,noise=c0s=7:c1s=5:c2s=5:allf=t,hqdn3d=3:2.5:0:0,gblur=sigma=0.45,unsharp=3:3:0.4:3:3:0,curves=all='0/0.03 0.2/0.17 0.5/0.50 1/0.97',vignette=angle=PI/6,scale=1080:-2:flags=bicubic",
    q: 4,
  },
  soft: {
    label: '柔和暖调（旧版）',
    vf: 'eq=contrast=0.95:saturation=0.93:gamma=1.02,colorbalance=rs=0.02:bs=-0.02:rm=0.015:bm=-0.015,noise=alls=5:allf=t',
    q: 2,
  },
  ccd: {
    label: 'CCD 数码感',
    vf: "curves=all='0/0.06 0.5/0.53 1/0.94',colorbalance=rs=0.03:gs=0.01:bs=-0.03,eq=saturation=1.06,gblur=sigma=0.7,noise=c0s=7:c1s=5:c2s=5:allf=t,unsharp=3:3:0.35:3:3:0,scale=1080:-2:flags=bicubic",
    q: 5,
  },
};
export const DEFAULT_POST = 'phone';

export async function postProcess(src, dst, preset = DEFAULT_POST) {
  const p = POST_PRESETS[preset] || POST_PRESETS[DEFAULT_POST];
  await ff(['-i', src, '-vf', p.vf, '-q:v', String(p.q), dst]);
  return dst;
}

export async function cropImage(src, dst, { x, y, w, h }) {
  const r = v => Math.max(0, Math.round(v));
  await ff(['-i', src, '-vf', `crop=${r(w)}:${r(h)}:${r(x)}:${r(y)}`, dst]);
  return dst;
}

export async function extractFrames(video, pattern, everySec = 6) {
  await ff(['-i', video, '-vf', `fps=1/${everySec}`, '-q:v', '2', pattern]);
}

// Tile images into a grid of w x h cells (cover-cropped), `cols` per row.
export async function grid(files, dst, { cols = 3, w = 720, h = 960 } = {}) {
  const cell = i => `[${i}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[v${i}]`;
  if (files.length === 1) {
    await ff(['-i', files[0], '-vf', cell(0).replace(/^\[0\]|\[v0\]$/g, ''), '-q:v', '2', dst]);
    return dst;
  }
  const layout = files.map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * h}`).join('|');
  const graph = files.map((_, i) => cell(i)).join(';') + ';' +
    files.map((_, i) => `[v${i}]`).join('') + `xstack=inputs=${files.length}:layout=${layout}:fill=white`;
  await ff([...files.flatMap(f => ['-i', f]), '-filter_complex', graph, '-frames:v', '1', '-q:v', '2', dst]);
  return dst;
}

export const hasFfmpeg = () => FFMPEG === 'ffmpeg' || fs.existsSync(FFMPEG);

// grok-imagine-image stamps a small "Grok" mark in the bottom-right corner. Cover it with a feathered patch
// copied from just above it (cropping would cut off feet/shoes). Tested 2026-11-04 on knit and asphalt:
// a patch from the left showed a visible square on knit; the feathered patch from above blends on both.
// Ratios are of image size, measured on 864x1152 output; the patch is larger than the mark so the
// soft 10 px edge falls outside it.
export const GROK_MARK = { x: 0.865, y: 0.947, w: 0.13, h: 0.05, srcY: 0.90 };
// Commas inside the alpha expression are escaped so the filtergraph parser does not split on them.
const FEATHER = "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*min(1\\,min(min(X\\,W-1-X)\\,min(Y\\,H-1-Y))/10)'";
export async function removeGrokWatermark(src, dst) {
  const m = GROK_MARK;
  const graph = `[0]split[a][b];[b]crop=w=iw*${m.w}:h=ih*${m.h}:x=iw*${m.x}:y=ih*${m.srcY},${FEATHER}[p];[a][p]overlay=x=main_w*${m.x}:y=main_h*${m.y}`;
  await ff(['-i', src, '-filter_complex', graph, '-q:v', '2', dst]);
  return dst;
}

// Optional "AI 生成" corner label for exported grids (platform rules require AI content to be declared).
const FONT = ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf'].find(f => fs.existsSync(f));
export async function addAiLabel(src, dst, text = 'AI 生成') {
  // ffmpeg filter syntax needs the drive colon escaped: C\:/Windows/...
  const font = FONT ? `fontfile='${FONT.replace(':', '\\:')}':` : '';
  const vf = `drawtext=${font}text='${text}':fontsize=h*0.022:fontcolor=white@0.9:box=1:boxcolor=black@0.45:boxborderw=12:x=w-tw-28:y=h-th-28`;
  await ff(['-i', src, '-vf', vf, '-q:v', '2', dst]);
  return dst;
}
