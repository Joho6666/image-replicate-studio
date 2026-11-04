import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, composePrompt, referencePreamble, swapPrompt, DEFAULT_FACE, PRESETS } from '../lib/prompt.mjs';

test('buildPrompt uses default face, shot, flash and the tail', () => {
  const p = buildPrompt({ shot: 'selfie', flash: 'off', framing: 'close', outfit: 'She wears a cream cardigan' });
  assert.match(p, /^Vertical 3:4 close-up front-camera selfie/);
  assert.match(p, /flash off/);
  assert.ok(p.includes(DEFAULT_FACE));
  assert.match(p, /She wears a cream cardigan\./);
  assert.match(p, /no brand logos\.$/);
});

test('buildPrompt skips empty fields and does not double periods', () => {
  const p = buildPrompt({ face: 'A woman.', hair: '  ', scene: 'A street.' });
  assert.ok(!p.includes('..'));
  assert.ok(!p.includes(DEFAULT_FACE));
  assert.match(p, /A woman\. A street\./);
});

test('every preset builds a prompt', () => {
  for (const [k, preset] of Object.entries(PRESETS)) assert.ok(buildPrompt(preset).length > 300, k);
});

test('reference preamble covers face and moodboard combinations', () => {
  assert.equal(referencePreamble({}), '');
  assert.match(referencePreamble({ moodboard: 3 }), /^The 3 reference photos are a style moodboard/);
  assert.match(referencePreamble({ moodboard: 1 }), /reference photo is a style moodboard/);
  const both = referencePreamble({ hasFace: true, moodboard: 2 });
  assert.match(both, /^The first reference photo shows the model/);
  assert.match(both, /The last 2 reference photos are a style moodboard/);
  assert.match(both, /keep the model in the new setting/);
  const pack = referencePreamble({ hasFace: true, faceCount: 3, bodyCount: 2, moodboard: 1 });
  assert.match(pack, /^The first 3 reference photos all show the same real person/);
  assert.match(pack, /The next 2 reference photos show her real body shape.*do not slim/);
  assert.match(pack, /The last 1 reference photo is a style moodboard/);
  assert.equal(composePrompt('X', {}), 'X');
});

test('swap prompt keeps scene and mentions face description', () => {
  const s = swapPrompt('mole on left cheek');
  assert.match(s, /Replace only the woman's face and hair/);
  assert.match(s, /\(mole on left cheek\)/);
  assert.match(s, /open them/);
});
