import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'irs-clients-'));
process.env.IRS_CLIENTS_DIR = tmp;
const C = await import('../lib/clients.mjs');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

test('creating a client needs a name and a valid type; defaults differ by type', () => {
  assert.throws(() => C.createClient({ name: ' ' }), /名称/);
  assert.throws(() => C.createClient({ name: 'a', type: 'vip' }), /类型/);
  const one = C.createClient({ name: '散单客户', type: 'oneoff' });
  const long = C.createClient({ name: '长期客户', type: 'longterm' });
  assert.equal(one.consent.given, false);
  assert.equal(one.consent.retainDays, 7);
  assert.equal(long.consent.retainDays, 180);
});

test('photos and orders are refused until consent is recorded', () => {
  const c = C.createClient({ name: '无同意' });
  assert.throws(() => C.addPhoto(c.id, 'face', JPG, 'jpg'), /同意/);
  const ok = C.updateClient(c.id, { consent: { given: true, scope: '写真出图，不公开', date: '2026-11-05' } });
  assert.equal(ok.consent.given, true);
  assert.equal(ok.consent.date, '2026-11-05');
  const after = C.addPhoto(c.id, 'face', JPG, 'jpg');
  assert.equal(after.faces.length, 1);
  assert.ok(fs.existsSync(path.join(C.clientDir(c.id), after.faces[0])));
});

test('photo limits, kinds and removal', () => {
  const c = C.createClient({ name: '照片', consent: { given: true } });
  assert.throws(() => C.addPhoto(c.id, 'hand', JPG, 'jpg'), /face 或 body/);
  for (let i = 0; i < 6; i++) C.addPhoto(c.id, 'body', JPG, 'jpg');
  assert.throws(() => C.addPhoto(c.id, 'body', JPG, 'jpg'), /最多 6/);
  const cur = C.getClient(c.id);
  const gone = C.removePhoto(c.id, 'body', cur.bodies[0]);
  assert.equal(gone.bodies.length, 5);
  assert.ok(!fs.existsSync(path.join(C.clientDir(c.id), cur.bodies[0])));
});

test('retention counts from delivery or last order and flags expired data', () => {
  const c = { type: 'oneoff', createdAt: '2026-11-01T00:00:00Z', lastOrderAt: null, deliveredAt: null, consent: { retainDays: 7 }, faces: ['face/x.jpg'], bodies: [] };
  const day = 86400000;
  const t0 = Date.parse('2026-11-01T00:00:00Z');
  assert.equal(C.expiryOf(c, t0 + 3 * day).expired, false);
  assert.equal(C.expiryOf(c, t0 + 8 * day).expired, true);
  assert.equal(C.expiryOf({ ...c, deliveredAt: '2026-11-07T00:00:00Z' }, t0 + 8 * day).expired, false);
  assert.equal(C.expiryOf({ ...c, faces: [] }, t0 + 30 * day).expired, false);
});

test('delivering and ordering update dates; deleting removes everything', () => {
  const c = C.createClient({ name: '订单', type: 'longterm', consent: { given: true } });
  const o = C.markOrder(c.id, 'p1');
  assert.deepEqual(o.orders, ['p1']);
  assert.ok(o.lastOrderAt);
  assert.ok(C.markDelivered(c.id).deliveredAt);
  C.deleteClient(c.id);
  assert.equal(C.getClient(c.id), null);
  assert.ok(!fs.existsSync(C.clientDir(c.id)));
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
