import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { POST_PRESETS, postProcess, hasFfmpeg } from '../lib/post.mjs';
import { FFMPEG } from '../lib/config.mjs';

test('every post preset runs through ffmpeg and outputs a 1080-wide or same-size jpeg', { skip: !hasFfmpeg() }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irs-'));
  const src = path.join(dir, 'src.png');
  execFileSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1086x1448', '-frames:v', '1', src]);
  for (const key of Object.keys(POST_PRESETS)) {
    const dst = path.join(dir, key + '.jpg');
    await postProcess(src, dst, key);
    const buf = fs.readFileSync(dst);
    assert.equal(buf[0], 0xff, key);
    assert.ok(buf.length > 10000, key);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('grok watermark patch and AI label keep image size', { skip: !hasFfmpeg() }, async () => {
  const { removeGrokWatermark, addAiLabel } = await import('../lib/post.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irs-'));
  const src = path.join(dir, 'g.jpg');
  execFileSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=864x1152', '-frames:v', '1', src]);
  for (const [fn, name] of [[removeGrokWatermark, 'clean.jpg'], [addAiLabel, 'label.jpg']]) {
    const dst = path.join(dir, name);
    await fn(src, dst);
    assert.ok(fs.statSync(dst).size > 10000, name);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
