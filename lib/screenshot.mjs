// Find the photo area inside a phone screenshot of a social-media post (status bar and nav on top, caption and nav
// at the bottom) and crop it out. Pure heuristic on a tiny grayscale copy: the photo's top and bottom edges are the
// strongest horizontal brightness steps inside two plausible windows. If nothing convincing is found it falls
// back to the default Douyin layout. The GUI always shows the result and lets the user adjust the two numbers.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FFMPEG } from './config.mjs';

const run = promisify(execFile);

export const DEFAULT_BAND = { top: 0.146, bottom: 0.759 };

async function grayRows(file, w = 64) {
  const { stdout } = await run(FFMPEG, ['-loglevel', 'error', '-i', file, '-vf', `scale=${w}:-2:flags=area,format=gray`, '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1 << 26 });
  const h = Math.floor(stdout.length / w);
  return { w, h, data: stdout };
}

export async function imageSize(file) {
  const { stderr } = await run(FFMPEG, ['-hide_banner', '-i', file]).catch(e => e);
  const m = /(\d{2,5})x(\d{2,5})/.exec(stderr || '');
  if (!m) throw new Error('读不出图片尺寸');
  return { width: Number(m[1]), height: Number(m[2]) };
}

export async function detectPhotoBand(file) {
  const { w, h, data } = await grayRows(file);
  if (h < 40) return { ...DEFAULT_BAND, auto: false };
  // d[y]: mean absolute brightness step between row y and y+1, over all columns
  const d = new Float64Array(h - 1);
  for (let y = 0; y < h - 1; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += Math.abs(data[(y + 1) * w + x] - data[y * w + x]);
    d[y] = s / w;
  }
  const best = (a, b) => { let bi = -1, bv = 0; for (let y = Math.floor(a * h); y < Math.floor(b * h); y++) if (d[y] > bv) { bv = d[y]; bi = y; } return { y: bi + 1, v: bv }; };
  const t = best(0.05, 0.25);
  // bottom: posts show the photo at its own aspect ratio, so only test the common ones (1:1, 4:5, 3:4, 2:3, 9:16) below the top
  // edge and keep the one whose bottom edge is the strongest brightness step (within +-3 rows). Free-form search picked
  // internal photo edges or the nav bar on most real screenshots.
  let bt = { y: -1, v: 0 };
  for (const ar of [1, 1.25, 4 / 3, 1.5, 16 / 9]) {
    const yc = Math.round(t.y + ar * w);
    if (yc + 3 >= h) continue;
    for (let y = Math.max(0, yc - 3); y <= yc + 3; y++) if (d[y] > bt.v) bt = { y: y + 1, v: d[y] };
  }
  const ok = t.v >= 6 && bt.v >= 6 && (bt.y - t.y) / h >= 0.45;
  if (!ok) return { ...DEFAULT_BAND, auto: false };
  return { top: +(t.y / h).toFixed(4), bottom: +(bt.y / h).toFixed(4), auto: true };
}

export async function cropBand(src, dst, { top, bottom }) {
  const { width, height } = await imageSize(src);
  const y0 = Math.max(0, Math.round(top * height)), y1 = Math.min(height, Math.round(bottom * height));
  if (y1 - y0 < 100) throw new Error('裁剪范围太小');
  await run(FFMPEG, ['-loglevel', 'error', '-y', '-i', src, '-vf', `crop=${width}:${y1 - y0}:0:${y0}`, '-q:v', '2', dst]);
  return dst;
}
