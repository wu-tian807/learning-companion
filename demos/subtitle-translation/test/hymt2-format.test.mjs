import assert from 'node:assert/strict';
import test from 'node:test';
import { createHyMt2CuePrompt, parseHyMt2CueResponse } from '../src/hymt2-format.mjs';

const cues = [
  { id: 'cue-000001', text: 'Welcome back.', startMs: 0, endMs: 1_000 },
  { id: 'cue-000002', text: 'We are discussing linear regression.', startMs: 1_000, endMs: 2_000 },
  { id: 'cue-000003', text: 'It fits a model to data.', startMs: 2_000, endMs: 3_000 },
];

test('Hy-MT2 cue prompt separates context from the translation target', () => {
  const prompt = createHyMt2CuePrompt(cues, 1, 'en', 'zh');
  assert.match(prompt, /Previous subtitle: Welcome back\./u);
  assert.match(prompt, /Next subtitle: It fits a model to data\./u);
  assert.match(prompt, /\[Source Text\]\nWe are discussing linear regression\./u);
});

test('Hy-MT2 cue parser removes wrappers without changing the translation', () => {
  assert.equal(parseHyMt2CueResponse('Translation: 我们正在讨论线性回归。'), '我们正在讨论线性回归。');
  assert.equal(parseHyMt2CueResponse('```text\n我们正在讨论线性回归。\n```'), '我们正在讨论线性回归。');
});

test('Hy-MT2 cue parser rejects empty output', () => {
  assert.throws(() => parseHyMt2CueResponse('  '), /empty cue translation/u);
});
