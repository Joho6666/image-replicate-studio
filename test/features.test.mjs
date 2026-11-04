import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractAuthorPrompt } from '../lib/prompt.mjs';
import { isEarlyCut, explainError } from '../lib/relay.mjs';
import { saveStyle, getStyle, deleteStyle, listStyles, styleDir } from '../lib/styles.mjs';

test('extractAuthorPrompt pulls the prompt section and drops hashtags/mentions', () => {
  const desc = 'AI韩女拍照prompt。说明文字。\nprompt：\n一张韩系随拍街头照片，由朋友在近处以轻微俯拍角度拍摄，使用现代 iPhone 后置 1 倍主摄、标准照片模式。\n她蹲在路边。 \n#AIGC #AI影像创作 @某人';
  const p = extractAuthorPrompt(desc);
  assert.match(p, /^一张韩系随拍街头照片/);
  assert.match(p, /她蹲在路边。$/);
  assert.ok(!p.includes('#') && !p.includes('@'));
  assert.equal(extractAuthorPrompt('没有提示词 #AIGC'), '');
  assert.equal(extractAuthorPrompt('prompt: 太短'), '');
  assert.match(extractAuthorPrompt('Prompt: ' + 'a'.repeat(50)), /^a+$/);
});

test('isEarlyCut spots proxy-killed long connections only', () => {
  const sock = Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' }, elapsed: 9000 });
  assert.ok(isEarlyCut(sock));
  assert.match(explainError(sock), /9 秒就被掐断/);
  assert.ok(!isEarlyCut(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' }, elapsed: 60000 })));
  assert.ok(!isEarlyCut(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' }, elapsed: 500 })));
  assert.ok(!isEarlyCut(Object.assign(new Error('bad'), { status: 400 })));
});

test('style card save, update and delete round-trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irs-style-'));
  const a = path.join(dir, 'a.jpg'), b = path.join(dir, 'b.png');
  fs.writeFileSync(a, 'A'); fs.writeFileSync(b, 'B');
  const st = saveStyle({ name: '测试风格', notes: 'n', fields: { shot: 'selfie' }, post: 'phone', model: 'gpt-image-2.5-flare', refs: [a], best: [b] });
  try {
    assert.deepEqual(getStyle(st.id).refs, ['ref_01.jpg']);
    assert.deepEqual(getStyle(st.id).best, ['best_01.png']);
    assert.ok(fs.existsSync(path.join(styleDir(st.id), 'best', 'best_01.png')));
    assert.ok(listStyles().some(s => s.id === st.id));
    const up = saveStyle({ id: st.id, refs: [a, a], best: [] });
    assert.equal(up.id, st.id);
    assert.equal(up.name, '测试风格');
    assert.equal(up.refs.length, 2);
    assert.equal(up.best.length, 0);
    assert.equal(up.createdAt, st.createdAt);
  } finally {
    deleteStyle(st.id);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(getStyle(st.id), null);
});
