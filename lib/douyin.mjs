import fs from 'node:fs';
import path from 'node:path';
import { loadTikhub } from './config.mjs';
import { withRetry } from './queue.mjs';
import { download, fixImageExt } from './net.mjs';
import { extractFrames } from './post.mjs';

// Pull the first URL out of a pasted douyin share text ("1.28 复制打开抖音… https://v.douyin.com/xxx/ …").
export function extractUrl(text) {
  const m = String(text).match(/https?:\/\/[^\s，。]+/);
  return m ? m[0] : String(text).trim();
}

async function fetchDetail(url) {
  const t = await loadTikhub();
  if (!t?.key) throw new Error('没有找到 TikHub key，检查 .env.local');
  return withRetry(async () => {
    const res = await fetch(t.base + '/api/v1/douyin/app/v3/fetch_one_video_by_share_url?share_url=' + encodeURIComponent(url),
      { headers: { Authorization: 'Bearer ' + t.key } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`TikHub ${res.status} ${json.detail?.message || json.message || ''}`.trim()), { status: res.status });
    const detail = json?.data?.aweme_detail || json?.data;
    if (!detail?.aweme_id) throw new Error('TikHub 没有返回作品数据，检查链接是否有效');
    return detail;
  }, { tries: 3, delay: 3000, retryIf: e => e.name === 'TypeError' || e.status >= 500 });
}

// Download a douyin case into `projectDir/refs/<aweme_id>/`. Image posts keep the original images;
// videos are downloaded and sampled every 6 s. Returned paths are relative to projectDir.
export async function fetchCase(shareText, projectDir) {
  const url = extractUrl(shareText);
  const d = await fetchDetail(url);
  const relDir = path.posix.join('refs', String(d.aweme_id));
  const dir = path.join(projectDir, relDir);
  fs.mkdirSync(dir, { recursive: true });
  const images = [];
  if (d.images?.length) {
    for (const [i, im] of d.images.entries()) {
      const list = im.url_list || [];
      const u = list.find(x => /jpe?g/.test(x)) || list[0];
      if (!u) continue;
      try {
        const f = fixImageExt(await download(u, path.join(dir, `case_${String(i + 1).padStart(2, '0')}.jpg`)));
        images.push(path.posix.join(relDir, path.basename(f)));
      } catch {}
    }
  } else {
    const video = path.join(dir, 'case.mp4');
    let ok = false;
    for (const u of (d.video?.play_addr?.url_list || []).slice(0, 3)) {
      try { await download(u, video, { referer: 'https://www.douyin.com/' }); ok = true; break; } catch {}
    }
    if (!ok) throw new Error('视频下载失败');
    await extractFrames(video, path.join(dir, 'frame_%03d.jpg'), 6);
    images.push(...fs.readdirSync(dir).filter(f => f.startsWith('frame_')).sort().map(f => path.posix.join(relDir, f)));
  }
  if (!images.length) throw new Error('作品里没有下载到图片');
  return {
    url, awemeId: String(d.aweme_id), type: d.images?.length ? 'images' : 'video',
    author: d.author?.nickname || '', desc: d.desc || '', images, fetchedAt: new Date().toISOString(),
  };
}
