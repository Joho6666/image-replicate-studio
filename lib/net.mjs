import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PROXY } from './config.mjs';

const exec = promisify(execFile);

export function imageExt(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return 'jpg';
}

// Node fetch ignores the system proxy, and CDN links (douyin, imgen.x.ai) are sometimes blocked
// directly, so download with curl: direct first, then through the local proxy.
export async function download(url, file, { referer } = {}) {
  for (const proxy of [null, PROXY]) {
    try {
      await exec('curl', ['-s', '-f', '-L', '-m', '300', '--retry', '2', '-A', 'Mozilla/5.0',
        ...(referer ? ['-e', referer] : []), ...(proxy ? ['-x', proxy] : []), '-o', file, url]);
      if (fs.statSync(file).size > 0) return file;
    } catch {}
  }
  throw new Error('下载失败：' + new URL(url).host);
}

// Rename a downloaded image so its extension matches its real format (douyin serves webp under .jpg URLs).
export function fixImageExt(file) {
  const ext = imageExt(fs.readFileSync(file));
  const fixed = file.replace(/\.\w+$/, '.' + ext);
  if (fixed !== file) fs.renameSync(file, fixed);
  return fixed;
}
