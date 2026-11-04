import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { newId } from './store.mjs';

// Style cards live outside projects so any project can reuse them:
// data/styles/<id>/style.json + refs/ (moodboard) + best/ (high-star outputs, future moodboard candidates).
export const STYLES = path.join(ROOT, 'data', 'styles');
export const styleDir = id => path.join(STYLES, id);

export function listStyles() {
  fs.mkdirSync(STYLES, { recursive: true });
  return fs.readdirSync(STYLES).map(getStyle).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getStyle(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  const file = path.join(styleDir(id), 'style.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function writeStyle(s) {
  fs.writeFileSync(path.join(styleDir(s.id), 'style.json'), JSON.stringify(s, null, 1));
  return s;
}

function copyInto(files, dir, prefix) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return files.map((src, i) => {
    const name = `${prefix}_${String(i + 1).padStart(2, '0')}${path.extname(src)}`;
    fs.copyFileSync(src, path.join(dir, name));
    return name;
  });
}

// Create or update a style card. refs/best are absolute source paths.
export function saveStyle({ id, name, notes, fields, post, model, refs, best, sourceProject }) {
  const old = id ? getStyle(id) : null;
  const sid = old?.id || newId('s');
  fs.mkdirSync(styleDir(sid), { recursive: true });
  const now = new Date().toISOString();
  return writeStyle({
    id: sid, name: name?.trim() || old?.name || '未命名风格', notes: notes ?? old?.notes ?? '',
    fields: fields || old?.fields || {}, post: post || old?.post || null, model: model || old?.model || null,
    refs: copyInto(refs, path.join(styleDir(sid), 'refs'), 'ref'),
    best: copyInto(best, path.join(styleDir(sid), 'best'), 'best'),
    sourceProject: sourceProject || old?.sourceProject || null,
    createdAt: old?.createdAt || now, updatedAt: now,
  });
}

export function deleteStyle(id) {
  if (getStyle(id)) fs.rmSync(styleDir(id), { recursive: true, force: true });
}
