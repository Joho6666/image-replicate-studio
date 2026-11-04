import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { newId, imageExtOf } from './store.mjs';

// Client records for paid work. Two kinds:
//  - longterm: repeat customers; their face/body photos stay on file between orders and are reused.
//  - oneoff:   single orders; photos are meant to be deleted soon after delivery.
// Photos are the customer's own, so nothing is stored or used before consent is recorded, and every
// client carries a retention period after which the app flags the data for deletion.
export const CLIENTS = process.env.IRS_CLIENTS_DIR || path.join(ROOT, 'data', 'clients');
export const clientDir = id => path.join(CLIENTS, id);

export const TYPES = { longterm: '长期客户', oneoff: '散单' };
const DEFAULT_RETAIN = { longterm: 180, oneoff: 7 };
const DAY = 86400000;

export function listClients() {
  fs.mkdirSync(CLIENTS, { recursive: true });
  return fs.readdirSync(CLIENTS).map(getClient).filter(Boolean).map(withExpiry)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getClient(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  const file = path.join(clientDir(id), 'client.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function write(c) {
  fs.writeFileSync(path.join(clientDir(c.id), 'client.json'), JSON.stringify(c, null, 1));
  return withExpiry(c);
}

// Retention counts from the delivery date (one-off), or the last order / creation (long-term).
export function expiryOf(c, now = Date.now()) {
  const days = Number(c.consent?.retainDays) || DEFAULT_RETAIN[c.type] || 30;
  const from = Date.parse(c.deliveredAt || c.lastOrderAt || c.createdAt);
  const expiresAt = new Date(from + days * DAY).toISOString();
  const hasData = c.faces.length + c.bodies.length > 0;
  return { expiresAt, expired: hasData && Date.parse(expiresAt) < now, daysLeft: Math.ceil((Date.parse(expiresAt) - now) / DAY) };
}
const withExpiry = c => ({ ...c, ...expiryOf(c) });

export function createClient({ name, type = 'oneoff', contact = '', notes = '', consent = {} } = {}) {
  if (!name?.trim()) throw new Error('客户名称不能为空');
  if (!TYPES[type]) throw new Error('客户类型只能是 longterm 或 oneoff');
  const id = newId('c');
  fs.mkdirSync(path.join(clientDir(id), 'face'), { recursive: true });
  fs.mkdirSync(path.join(clientDir(id), 'body'), { recursive: true });
  const c = {
    id, name: name.trim(), type, contact, notes, createdAt: new Date().toISOString(), lastOrderAt: null, deliveredAt: null,
    consent: normConsent(consent, type), faces: [], bodies: [], orders: [],
  };
  return write(c);
}

function normConsent(consent, type) {
  return {
    given: !!consent.given, date: consent.given ? (consent.date || new Date().toISOString().slice(0, 10)) : null,
    scope: String(consent.scope || ''), retainDays: Math.min(Math.max(Number(consent.retainDays) || DEFAULT_RETAIN[type], 1), 3650),
    showcase: !!consent.showcase,
  };
}

export function updateClient(id, patch) {
  const c = getClient(id);
  if (!c) throw new Error('客户不存在');
  for (const k of ['name', 'contact', 'notes']) if (typeof patch[k] === 'string') c[k] = patch[k].trim() || c[k];
  if (patch.type && TYPES[patch.type]) c.type = patch.type;
  if (patch.consent) c.consent = normConsent({ ...c.consent, ...patch.consent }, c.type);
  return write(c);
}

export function requireConsent(c) {
  if (!c.consent?.given) throw new Error('先在客户档案里确认「客户已同意」并写明用途，再上传照片或建订单');
}

export function addPhoto(id, kind, buffer, ext) {
  const c = getClient(id);
  if (!c) throw new Error('客户不存在');
  requireConsent(c);
  if (!['face', 'body'].includes(kind)) throw new Error('照片类型只能是 face 或 body');
  const list = kind === 'face' ? c.faces : c.bodies;
  if (list.length >= (kind === 'face' ? 8 : 6)) throw new Error(kind === 'face' ? '脸部照片最多 8 张' : '身材照片最多 6 张');
  const rel = `${kind}/${newId('p')}.${ext}`;
  fs.writeFileSync(path.join(clientDir(id), rel), buffer);
  list.push(rel);
  return write(c);
}

export function removePhoto(id, kind, rel) {
  const c = getClient(id);
  if (!c) throw new Error('客户不存在');
  const key = kind === 'face' ? 'faces' : 'bodies';
  if (!c[key].includes(rel)) throw new Error('没有这张照片');
  fs.rmSync(path.join(clientDir(id), rel), { force: true });
  c[key] = c[key].filter(x => x !== rel);
  return write(c);
}

export function markOrder(id, projectId) {
  const c = getClient(id);
  c.orders.push(projectId);
  c.lastOrderAt = new Date().toISOString();
  c.deliveredAt = null;
  return write(c);
}

export function markDelivered(id) {
  const c = getClient(id);
  if (!c) throw new Error('客户不存在');
  c.deliveredAt = new Date().toISOString();
  return write(c);
}

// Remove the customer's photos and record. Project folders (outputs) are deleted by the caller.
export function deleteClient(id) {
  if (!getClient(id)) return;
  fs.rmSync(clientDir(id), { recursive: true, force: true });
}

export { imageExtOf };
