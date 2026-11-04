import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Machine-specific settings live in `.env.local` (not committed; see .env.example). Real environment
// variables win over the file.
const LOCAL_ENV = path.join(ROOT, '.env.local');
const fileEnv = fs.existsSync(LOCAL_ENV)
  ? Object.fromEntries(fs.readFileSync(LOCAL_ENV, 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; }))
  : {};
const env = name => process.env[name] ?? fileEnv[name] ?? '';

export const DATA = path.join(ROOT, 'data', 'projects');
export const PORT = Number(env('IRS_PORT') || 3400);
export const PROXY = env('IRS_PROXY') || 'http://127.0.0.1:7890';

function readKeyFile(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
}

// OpenAI-compatible image relay. Either set IMAGE_API_BASE / IMAGE_API_KEY_GPT / IMAGE_API_KEY_GROK,
// or point JOHO_KEYS at a keys.env with JOHO_BASE_URL / JOHO_KEY_GPT / JOHO_KEY_GROK.
export function loadKeys() {
  const f = env('JOHO_KEYS') ? readKeyFile(env('JOHO_KEYS')) : {};
  const base = env('IMAGE_API_BASE') || f.JOHO_BASE_URL;
  if (!base) throw new Error('没有配置生图中转站：在 .env.local 里设置 IMAGE_API_BASE 和 key（见 .env.example）');
  return { base: base.replace(/\/$/, ''), gpt: env('IMAGE_API_KEY_GPT') || f.JOHO_KEY_GPT, grok: env('IMAGE_API_KEY_GROK') || f.JOHO_KEY_GROK };
}

// TikHub (douyin case download). Either TIKHUB_API_KEY (+ optional TIKHUB_BASE_URL), or TIKHUB_ENV pointing at
// a module that exports `config.tikhub = { key, base }` (e.g. another local app's env loader).
export async function loadTikhub() {
  if (env('TIKHUB_API_KEY')) return { key: env('TIKHUB_API_KEY'), base: (env('TIKHUB_BASE_URL') || 'https://api.tikhub.io').replace(/\/$/, '') };
  if (env('TIKHUB_ENV')) return (await import(env('TIKHUB_ENV'))).config.tikhub;
  throw new Error('没有配置 TikHub：在 .env.local 里设置 TIKHUB_API_KEY（见 .env.example）');
}

export const FFMPEG = [env('FFMPEG')].find(p => p && fs.existsSync(p)) || 'ffmpeg';
