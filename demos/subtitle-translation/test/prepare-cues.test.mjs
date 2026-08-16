import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCuesForTranslation } from '../src/prepare-cues.mjs';

function cue(index, startMs, endMs, text) {
  return { id: `raw-${index}`, startMs, endMs, text };
}

test('joins English fragments until a complete sentence', () => {
  const result = prepareCuesForTranslation(
    [
      cue(1, 0, 1000, 'Creative'),
      cue(2, 1000, 2000, 'Commons license.'),
      cue(3, 2000, 3000, 'Next sentence.'),
    ],
    'en',
  );
  assert.deepEqual(result, [
    {
      id: 'cue-000001',
      startMs: 0,
      endMs: 2000,
      text: 'Creative Commons license.',
      sourceCueIds: ['raw-1', 'raw-2'],
    },
    {
      id: 'cue-000002',
      startMs: 2000,
      endMs: 3000,
      text: 'Next sentence.',
      sourceCueIds: ['raw-3'],
    },
  ]);
});

test('bounds unpunctuated Chinese groups by duration', () => {
  const result = prepareCuesForTranslation(
    [
      cue(1, 0, 3000, '人工智能'),
      cue(2, 3000, 6000, '机器学习'),
      cue(3, 6000, 9000, '神经网络'),
    ],
    'zh',
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].text, '人工智能 机器学习');
  assert.equal(result[1].text, '神经网络');
});

test('does not join cues separated by a long silence', () => {
  const result = prepareCuesForTranslation(
    [cue(1, 0, 1000, 'hello'), cue(2, 2000, 3000, 'world')],
    'en',
  );
  assert.equal(result.length, 2);
});
