import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { retouch, retouchGraph, cleanRecipe, listRecipes } from '../lib/retouch.mjs';
import { hasFfmpeg, POST_PRESETS } from '../lib/post.mjs';
import { FFMPEG } from '../lib/config.mjs';

test('recipes are cleaned: unknown base falls back, sliders are clamped, zeros dropped', () => {
  const r = cleanRecipe({ base: 'nope', strength: 140, adj: { bright: 90, sat: 0, grain: -5, bogus: 3 } });
  assert.deepEqual(r, { base: 'none', strength: 100, adj: { bright: 50 } });
  assert.ok(listRecipes().some(x => x.id === 'phone' && x.builtin));
  assert.equal(listRecipes().filter(x => x.builtin).length, Object.keys(POST_PRESETS).length + 1);
});

test('partial strength blends the look over the original; full strength does not', async () => {
  assert.match(await retouchGraph('x', { base: 'ccd', strength: 40 }), /blend=all_mode=normal:all_opacity=0\.40/);
  assert.doesNotMatch(await retouchGraph('x', { base: 'ccd', strength: 100 }), /blend/);
  assert.doesNotMatch(await retouchGraph('x', { base: 'none', adj: { temp: 10 } }), /blend|hqdn3d/);
});

test('every recipe shape renders a jpeg, with and without scene colour matching', { skip: !hasFfmpeg() }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irs-rt-'));
  const src = path.join(dir, 'src.png'), ref = path.join(dir, 'ref.png');
  execFileSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1200x1600', '-frames:v', '1', src]);
  execFileSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x806040:size=600x800', '-frames:v', '1', ref]);
  const cases = [
    [{ base: 'phone', strength: 100 }, {}],
    [{ base: 'ccd', strength: 50, adj: { bright: 10, temp: -20, grain: 10 } }, {}],
    [{ base: 'none', adj: { contrast: -20, sat: 30 } }, { size: 'full' }],
    [{ base: 'phone_plus', strength: 70 }, { ref }],
  ];
  for (const [i, [recipe, opts]] of cases.entries()) {
    const dst = path.join(dir, i + '.jpg');
    await retouch(src, dst, recipe, opts);
    const buf = fs.readFileSync(dst);
    assert.equal(buf[0], 0xff, String(i));
    assert.ok(buf.length > 10000, String(i));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
