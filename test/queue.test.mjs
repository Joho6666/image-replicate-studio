import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, withRetry } from '../lib/queue.mjs';

test('queue never runs more than the limit at once', async () => {
  const q = createQueue(3);
  let running = 0, peak = 0;
  const task = () => q.run(async () => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 20)); running--; return 1; });
  const results = await Promise.all(Array.from({ length: 8 }, task));
  assert.equal(peak, 3);
  assert.equal(results.length, 8);
});

test('queue keeps going after a rejected task', async () => {
  const q = createQueue(1);
  await assert.rejects(q.run(async () => { throw new Error('x'); }));
  assert.equal(await q.run(async () => 'ok'), 'ok');
});

test('withRetry retries only matching errors', async () => {
  let n = 0;
  const v = await withRetry(async () => { if (++n < 3) throw Object.assign(new Error('busy'), { status: 429 }); return n; }, { delay: 1, retryIf: e => e.status === 429 });
  assert.equal(v, 3);
  let m = 0;
  await assert.rejects(withRetry(async () => { m++; throw new Error('bad'); }, { delay: 1, retryIf: () => false }));
  assert.equal(m, 1);
});
