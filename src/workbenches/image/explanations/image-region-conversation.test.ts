import { describe, expect, it } from 'vitest';

import { createImageRegionTarget } from '../shared';
import { createImageRegionConversationOpenOptions } from './image-region-conversation';

const target = createImageRegionTarget({
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  sourceWidth: 1000,
  sourceHeight: 800,
});

describe('image region conversation launch', () => {
  it('opens free-form questions with region context and no automatic submission', () => {
    expect(
      createImageRegionConversationOpenOptions(target, 'revision-1', 'ask'),
    ).toEqual({
      context: expect.objectContaining({ target, sourceRevision: 'revision-1' }),
    });
  });

  it('keeps the fixed explanation as an explicitly submitted question', () => {
    expect(
      createImageRegionConversationOpenOptions(target, 'revision-1', 'explain'),
    ).toMatchObject({
      context: expect.objectContaining({ target, sourceRevision: 'revision-1' }),
      question: '请解释这个图片区域。',
      submit: true,
    });
  });
});
