// 实况图: turn a finished still into a 2-4 second looping clip through the relay's image-to-video endpoint,
// then convert it to mp4 + animated webp + gif + a poster frame.
// Relay protocol: POST /videos {model, prompt, seconds, image: {url: data URL}} -> {request_id};
// GET /videos/{id} -> {status: pending|done}; GET /videos/{id}/content -> mp4.
// WARNING (found 2026-11-05): a string `image_url` is accepted with HTTP 200 but silently IGNORED, so the result is a
// text-to-video of an unrelated person. Only `image: {url}` (and, blended, `reference_images`) actually use the picture.
// Checked by comparing frames of clips made from a synthetic colour-bar image. Not yet checked: output aspect ratio for
// portrait stills. The clips made without a working image are 848x480 (landscape), and the image-to-video test frame looked
// cropped to landscape (its dimensions were not read). Whether an `aspect_ratio` field is honoured is untested.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadKeys, FFMPEG } from './config.mjs';
import { runAsyncJob, originOf } from './async-relay.mjs';
import { withRetry } from './queue.mjs';

const run = promisify(execFile);
const ff = args => run(FFMPEG, ['-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 26 });

export const LIVE_MODEL = 'grok-imagine-video';

// Motion text kept deliberately small: the video model drifts the face when asked for big movement.
export const GIF_PROMPTS = {
  "breeze": "Turn this exact photograph into a short looping animated GIF. Every frame keeps the same person, face, hair, pose, outfit, background, lighting, framing and composition as the input image. Only tiny motion: she blinks once (eyes close halfway and reopen), a few strands of hair and nearby leaves or fabric sway slightly in a soft breeze. No camera movement, no zoom, no text.",
  "smile": "Turn this exact photograph into a short looping animated GIF. Every frame keeps the same person, face, hair, pose, outfit, background, lighting, framing and composition as the input image. Only tiny motion: her expression softens into a faint natural smile and relaxes again, one slow blink. No camera movement, no zoom, no text.",
  "still": "Turn this exact photograph into a short looping animated GIF. Every frame is nearly identical to the input image; only gentle breathing and tiny natural light changes, maybe one slow blink. No camera movement, no zoom, no text."
};

export const LIVE_PRESETS = {
  breeze: { label: '微风：眨眼 + 呼吸 + 头发微动', prompt: 'Subtle, natural live-photo motion for about three seconds: she blinks once and breathes gently, a soft breeze moves a few strands of her hair and any leaves or fabric nearby, the light shimmers slightly. Static camera, no zoom, no cut. Her face, hair, pose, outfit and the background stay exactly the same; no change of expression beyond a faint natural smile.' },
  smile: { label: '浅笑：轻轻抬眼微笑', prompt: 'Subtle, natural live-photo motion for about three seconds: she looks at the camera and her expression softens into a faint natural smile, one slow blink, gentle breathing. Static camera, no zoom, no cut. Her face, hair, pose, outfit and the background stay exactly the same.' },
  still: { label: '几乎静止：只有呼吸和光影', prompt: 'Almost still live photo for about three seconds: only gentle breathing and tiny natural light changes, maybe one slow blink. Static camera, no zoom, no cut. Everything else stays exactly the same.' },
};

const auth = (keys) => ({ Authorization: 'Bearer ' + keys.grok });

// Data URLs go in the JSON body, so keep the still modest: 1080 px wide jpeg.
async function stillAsDataUrl(imageFile, tmpDir) {
  const tmp = path.join(tmpDir, `_live_src_${Date.now()}.jpg`);
  await ff(['-i', imageFile, '-vf', 'scale=1080:-2:force_original_aspect_ratio=decrease', '-q:v', '3', tmp]);
  const url = 'data:image/jpeg;base64,' + fs.readFileSync(tmp).toString('base64');
  fs.rmSync(tmp, { force: true });
  return url;
}

// GPT image GIF output (relay >= 0.2.19, verified 2026-11-06 on /images/edits with a synthetic image: the GIF starts from the
// input picture). frame_count / frame_duration_ms are passed through to the upstream; the upstream picks the final size.
export async function makeLiveGif({ imageFile, prompt, frames = 6, frameMs = 120, outBase, model = 'gpt-image-2.6-flare' }) {
  const keys = loadKeys();
  const buf = fs.readFileSync(imageFile);
  const ext = path.extname(imageFile).toLowerCase();
  const fd = new FormData();
  fd.set('model', model);
  fd.set('prompt', prompt);
  fd.set('size', '1024x1536');
  fd.set('output_format', 'gif');
  fd.set('frame_count', String(frames));
  fd.set('frame_duration_ms', String(frameMs));
  fd.append('image[]', new Blob([buf], { type: ext === '.png' ? 'image/png' : 'image/jpeg' }), path.basename(imageFile));
  // The local proxy cuts long connections now and then (UND_ERR_SOCKET / CONNECT_TIMEOUT / ECONNRESET): retry the whole job. FormData is single-use, so rebuild it each try.
  const r = await withRetry(() => {
    const f = new FormData();
    for (const [k, v] of fd.entries()) f.append(k, v);
    return runAsyncJob({ origin: originOf(keys.base), auth: { Authorization: 'Bearer ' + keys.gpt }, kind: 'edits', form: f, timeoutMs: 6 * 60 * 1000 });
  }, { tries: 4, delay: 6000, retryIf: e => /ECONNRESET|UND_ERR|fetch failed|timeout|socket/i.test(String(e.message) + ' ' + String(e.cause?.code || '') + ' ' + String(e.cause?.message || '')) });
  if (r.buffer.subarray(0, 3).toString('latin1') !== 'GIF') throw new Error('中转站没有返回 GIF（上游可能没开 GIF 权限）');
  const raw = outBase + '_raw.gif';
  fs.writeFileSync(raw, r.buffer);
  return convertLive(raw, outBase);
}

export async function makeLive({ imageFile, prompt, seconds = 3, outBase, model = LIVE_MODEL, signal }) {
  const keys = loadKeys();
  const dataUrl = await stillAsDataUrl(imageFile, path.dirname(outBase));
  const r = await fetch(keys.base + '/videos', {
    method: 'POST', headers: { ...auth(keys), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, seconds: String(seconds), image: { url: dataUrl } }), signal,
  });
  const j = await r.json().catch(() => ({}));
  const id = j.id || j.request_id || j.task_id;
  if (!r.ok || !id) throw new Error(`视频任务提交失败 HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);

  let done = false;
  for (let i = 0; i < 120 && !done; i++) {
    await new Promise(s => setTimeout(s, 5000));
    const q = await fetch(`${keys.base}/videos/${id}`, { headers: auth(keys), signal });
    const t = await q.json().catch(() => ({}));
    const d = t.data && !Array.isArray(t.data) ? t.data : t;
    const st = String(d.status || '').toLowerCase();
    if (/fail|error/.test(st)) throw new Error('视频生成失败：' + JSON.stringify(d).slice(0, 200));
    if (/complete|succe|done/.test(st)) done = true;
  }
  if (!done) throw new Error('视频生成超时');
  const c = await fetch(`${keys.base}/videos/${id}/content`, { headers: auth(keys), signal });
  if (!c.ok) throw new Error('视频下载失败 HTTP ' + c.status);
  const raw = outBase + '_raw.mp4';
  fs.writeFileSync(raw, Buffer.from(await c.arrayBuffer()));
  return convertLive(raw, outBase);
}

// mp4 for phones, animated webp / gif (looping) for posting, a poster jpg for the gallery.
export async function convertLive(raw, outBase) {
  const out = { mp4: outBase + '.mp4', webp: outBase + '.webp', gif: outBase + '.gif', poster: outBase + '_poster.jpg' };
  await ff(['-i', raw, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', '-an', out.mp4]);
  await ff(['-i', raw, '-vf', 'fps=15,scale=540:-2:flags=lanczos', '-loop', '0', '-quality', '80', out.webp]);
  await ff(['-i', raw, '-vf', 'fps=12,scale=480:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', out.gif]);
  await ff(['-i', raw, '-frames:v', '1', '-q:v', '3', out.poster]);
  return out;
}
