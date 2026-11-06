// Automatic first-pass QA with a vision model behind an OpenAI-compatible /chat/completions endpoint.
// Default: the JOHO relay with gpt-6-luna (probed 2026-11-05: gpt-6-luna and grok-4.7 describe images correctly;
// gpt-6.1-sol and grok-4.6 did not answer in the test). Override in .env.local: VISION_BASE, VISION_KEY, VISION_MODEL.
// curl is used instead of fetch: long requests behind the TUN proxy are cut far less often.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadKeys, envValue, FFMPEG } from './config.mjs';
import { QA_CHECKS } from './qa.mjs';

const run = promisify(execFile);

export function visionConfig() {
  const keys = (() => { try { return loadKeys(); } catch { return {}; } })();
  return {
    base: (envValue('VISION_BASE') || keys.base || '').replace(/\/$/, ''),
    key: envValue('VISION_KEY') || keys.gpt || '',
    model: envValue('VISION_MODEL') || 'gpt-6-luna',
  };
}

const RUBRIC = `You are a strict photo quality inspector for AI-generated portraits. The image is a contact sheet:
- Row 1: reference photos of the real person (the model).
- Row 2: the reference scene first (only if "reference_first" is true), then the generated results, left to right.
- Row 3: the upper half of each generated result, zoomed, to judge the face.
Judge each generated result separately on these checks and answer ONLY with JSON, no prose:
{"results":[{"index":1,"checks":{"likeness":{"ok":true|false|null,"note":""},"overlay":{...},"anatomy":{...},"outfit":{...},"background":{...},"boundary":{...}},"note":""}]}
Checks: ${Object.entries(QA_CHECKS).map(([k, v]) => `${k} = ${v}`).join('; ')}.
Rules: ok=null when you cannot tell at this size (say why in note); never guess a pass. For likeness compare face shape, eyes, nose, lips, hair and the position of any mole against row 1. Notes are short, in Chinese. index is 1-based among the generated results.`;

export async function sheetDataUrl(sheetFile) {
  const tmp = path.join(os.tmpdir(), `qa_${Date.now()}.jpg`);
  await run(FFMPEG, ['-loglevel', 'error', '-y', '-i', sheetFile, '-vf', 'scale=1800:-2:force_original_aspect_ratio=decrease', '-q:v', '4', tmp]);
  const url = 'data:image/jpeg;base64,' + fs.readFileSync(tmp).toString('base64');
  fs.rmSync(tmp, { force: true });
  return url;
}

async function chat(cfg, body) {
  const tmp = path.join(os.tmpdir(), `vis_${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(body));
  try {
    for (let t = 0; t < 4; t++) {
      try {
        const { stdout } = await run('curl', ['-s', '-m', '150', '-X', 'POST', cfg.base + '/chat/completions', '-H', 'Authorization: Bearer ' + cfg.key, '-H', 'Content-Type: application/json', '--data-binary', '@' + tmp], { maxBuffer: 1 << 26 });
        if (stdout) return JSON.parse(stdout);
      } catch { /* retry */ }
    }
    throw new Error('看图模型没有响应（连接被断，可以重试）');
  } finally { fs.rmSync(tmp, { force: true }); }
}

export function parseVisionJson(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || '').replace(/```(?:json)?/g, ''));
  if (!m) throw new Error('看图模型没有返回 JSON');
  return JSON.parse(m[0]);
}

export async function visionQa(sheetFile, { referenceFirst, results }) {
  const cfg = visionConfig();
  if (!cfg.base || !cfg.key) throw new Error('没有配置看图模型（VISION_BASE / VISION_KEY，或用中转站的 key）');
  const j = await chat(cfg, {
    model: cfg.model, max_tokens: 2500, temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text: `${RUBRIC}\nreference_first=${!!referenceFirst}; generated results=${results}.` }, { type: 'image_url', image_url: { url: await sheetDataUrl(sheetFile) } }] }],
  });
  if (j.error) throw new Error('看图模型报错：' + JSON.stringify(j.error).slice(0, 160));
  const parsed = parseVisionJson(j.choices?.[0]?.message?.content);
  return { model: cfg.model, results: Array.isArray(parsed.results) ? parsed.results : [] };
}
