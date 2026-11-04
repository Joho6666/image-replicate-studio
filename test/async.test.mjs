import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Mock relay: async endpoints per docs/server-async-prompt.md; `mode` switches behaviours.
function mockRelay({ asyncOn = true, fail = null } = {}) {
  const jobs = new Map();
  const seen = { submits: [], polls: 0, sync: 0 };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const authed = req.headers.authorization === 'Bearer k-gpt';
    if (req.url === '/async/health') {
      if (!asyncOn) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html>'); }
      return json(200, { ok: true, queued: 0, running: 0 });
    }
    let m;
    if ((m = req.url.match(/^\/async\/v1\/images\/(generations|edits)$/)) && req.method === 'POST') {
      if (!authed) return json(401, { error: { message: 'bad key' } });
      const id = 'job' + (jobs.size + 1);
      seen.submits.push({ kind: m[1], type: req.headers['content-type'], body: body.toString('latin1') });
      jobs.set(id, { polls: 0 });
      return json(202, { id, status: 'queued' });
    }
    if ((m = req.url.match(/^\/async\/v1\/jobs\/(\w+)$/))) {
      const job = jobs.get(m[1]);
      if (!job || !authed) return json(404, { error: 'not found' });
      seen.polls++;
      if (++job.polls < 2) return json(200, { id: m[1], status: 'running' });
      if (fail) return json(200, { id: m[1], status: 'failed', error: fail });
      return json(200, { id: m[1], status: 'succeeded', images: [{ url: `/async/v1/jobs/${m[1]}/images/0`, bytes: PNG.length }] });
    }
    if ((m = req.url.match(/^\/async\/v1\/jobs\/(\w+)\/images\/0$/))) {
      if (!authed) return json(404, {});
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length });
      return res.end(PNG);
    }
    if (req.url === '/v1/images/generations') {
      seen.sync++;
      return json(200, { data: [{ b64_json: PNG.toString('base64') }] });
    }
    json(404, {});
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, seen, base: `http://127.0.0.1:${server.address().port}/v1` })));
}

process.env.IRS_ASYNC_POLL_MS = '20';
process.env.IMAGE_API_KEY_GPT = 'k-gpt';
const { generateImage, connStats, explainError } = await import('../lib/relay.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'irs-async-'));

test('async generations: submit, poll, download', async () => {
  const { server, seen, base } = await mockRelay();
  process.env.IMAGE_API_BASE = base;
  try {
    const file = await generateImage({ model: 'gpt-image-2.5-flare', prompt: 'apple', size: '1024x1024', outBase: path.join(tmp, 'a') });
    assert.equal(path.extname(file), '.png');
    assert.deepEqual(fs.readFileSync(file), PNG);
    assert.equal(seen.submits[0].kind, 'generations');
    assert.match(seen.submits[0].body, /"model":"gpt-image-2.5-flare"/);
    assert.ok(seen.polls >= 2);
    assert.equal(seen.sync, 0);
    assert.equal(connStats.mode, 'async');
  } finally { server.close(); }
});

test('async edits send multipart with reference images', async () => {
  const { server, seen, base } = await mockRelay();
  process.env.IMAGE_API_BASE = base;
  const ref = path.join(tmp, 'ref.png');
  fs.writeFileSync(ref, PNG);
  try {
    await generateImage({ model: 'gpt-image-2.5-flare', prompt: 'p', refs: [ref, ref], outBase: path.join(tmp, 'b') });
    const s = seen.submits[0];
    assert.equal(s.kind, 'edits');
    assert.match(s.type, /^multipart\/form-data; boundary=/);
    assert.equal((s.body.match(/name="image\[\]"/g) || []).length, 2);
  } finally { server.close(); }
});

test('failed async job surfaces the upstream error (moderation is not retried)', async () => {
  const fail = { status: 400, body: JSON.stringify({ error: { code: 'moderation_blocked', message: 'rejected by the safety system. safety_violations=[sexual].' } }) };
  const { server, seen, base } = await mockRelay({ fail });
  process.env.IMAGE_API_BASE = base;
  try {
    await assert.rejects(generateImage({ model: 'gpt-image-2.5-flare', prompt: 'p', outBase: path.join(tmp, 'c') }), err => {
      assert.equal(err.code, 'moderation_blocked');
      assert.match(explainError(err), /安全审核拦截（sexual）/);
      return true;
    });
    assert.equal(seen.submits.length, 1);
  } finally { server.close(); }
});

test('falls back to the sync endpoint when /async/health is not JSON', async () => {
  const { server, seen, base } = await mockRelay({ asyncOn: false });
  process.env.IMAGE_API_BASE = base;
  try {
    const file = await generateImage({ model: 'gpt-image-2.5-flare', prompt: 'p', outBase: path.join(tmp, 'd') });
    assert.ok(fs.existsSync(file));
    assert.equal(seen.sync, 1);
    assert.equal(seen.submits.length, 0);
    assert.equal(connStats.mode, 'sync');
  } finally { server.close(); }
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
