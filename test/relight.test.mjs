import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHTS, STRENGTH, relightPrompt } from '../lib/relight.mjs';

test('every light type builds a prompt that keeps the scene and protects skin', () => {
  for (const key of Object.keys(LIGHTS)) {
    const p = relightPrompt(key);
    assert.match(p, /^Edit the original photograph to add the following lighting: /, key);
    assert.match(p, /Preserve the source canvas, camera perspective, identity/, key);
    assert.match(p, /no oily shine/, key);
    assert.ok(!p.includes('  '), key);
  }
});

test('strength and extra text are appended; unknown light throws', () => {
  assert.match(relightPrompt('flash_front', { strength: 'subtle' }), /subtle/);
  assert.match(relightPrompt('flash_front', { strength: 'strong' }), /strong and unmistakable/);
  assert.match(relightPrompt('flash_front', { extra: 'warm tungsten color' }), /warm tungsten color/);
  assert.ok(!relightPrompt('flash_front', { strength: 'normal' }).includes('subtle'));
  assert.deepEqual(Object.keys(STRENGTH), ['subtle', 'normal', 'strong']);
  assert.throws(() => relightPrompt('nope'), /没有这种灯型/);
});

test('scene_match light and the smart-light prompt clause', async () => {
  const { SMART_LIGHT_CLAUSE, withSmartLight } = await import('../lib/relight.mjs');
  assert.match(relightPrompt('scene_match'), /dominant light source already visible/);
  const once = withSmartLight('A woman in a cafe.');
  assert.ok(once.endsWith(SMART_LIGHT_CLAUSE));
  assert.equal(withSmartLight(once), once, 'clause is not added twice');
});
