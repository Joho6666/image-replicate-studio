import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA } from './config.mjs';

// The in-memory object is the source of truth while the server runs (jobs mutate it in the
// background); every change is written back to project.json.
const cache = new Map();

export const newId = (prefix = '') => prefix + crypto.randomBytes(4).toString('hex');
export const projectDir = id => path.join(DATA, id);

export function listProjects() {
  fs.mkdirSync(DATA, { recursive: true });
  return fs.readdirSync(DATA).filter(id => fs.existsSync(path.join(DATA, id, 'project.json')))
    .map(id => getProject(id)).filter(Boolean)
    .map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt, jobs: p.jobs.length }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createProject(name) {
  const d = new Date();
  const id = `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${newId()}`;
  const p = { id, name: name?.trim() || '未命名项目', createdAt: d.toISOString(), cases: [], moodboard: [], faces: [], jobs: [] };
  for (const sub of ['refs/upload', 'faces', 'outputs', 'exports']) fs.mkdirSync(path.join(projectDir(id), sub), { recursive: true });
  cache.set(id, p);
  saveProject(p);
  return p;
}

export function getProject(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  if (cache.has(id)) return cache.get(id);
  const file = path.join(projectDir(id), 'project.json');
  if (!fs.existsSync(file)) return null;
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Jobs interrupted by a server restart can never finish.
  for (const j of p.jobs) if (j.status === 'running' || j.status === 'queued') { j.status = j.outputs.length ? 'partial' : 'failed'; j.errors = [...(j.errors || []), '服务重启，任务中断']; }
  cache.set(id, p);
  return p;
}

export function saveProject(p) {
  const file = path.join(projectDir(p.id), 'project.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(p, null, 1));
  fs.renameSync(file + '.tmp', file);
}

// Resolve a project-relative path, refusing anything that escapes the project folder.
export function resolveIn(p, rel) {
  const base = projectDir(p.id);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('非法路径');
  return abs;
}

export const relTo = (p, abs) => path.relative(projectDir(p.id), abs).split(path.sep).join('/');
