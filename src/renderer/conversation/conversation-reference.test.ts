import { describe, expect, it } from 'vitest';

import {
  conversationContextSourceRevision,
  conversationContextTarget,
  describeConversationContext,
} from './conversation-reference';

describe('Project conversation references', () => {
  it('extracts both direct HTML anchors and wrapped media anchors', () => {
    const html = {
      scope: 'content' as const,
      targetType: 'html.dom',
      targetVersion: 1,
      targetPayload: { element: { textQuote: '均方误差' } },
    };
    const video = {
      sourceRevision: '1',
      target: {
        scope: 'content' as const,
        targetType: 'video.frame-region',
        targetVersion: 1,
        targetPayload: { timeSeconds: 48.25 },
      },
    };

    expect(conversationContextTarget(html)).toEqual(html);
    expect(conversationContextTarget(video)).toEqual(video.target);
    expect(conversationContextSourceRevision(video)).toBe('1');
  });

  it('describes normalized image and video regions without format presenters', () => {
    expect(describeConversationContext({
      target: {
        scope: 'content',
        targetType: 'video.frame-region',
        targetVersion: 1,
        targetPayload: {
          timeSeconds: 12.345,
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.4,
        },
      },
    })).toEqual({
      label: '12.3 秒处',
      detail: '左侧 10% · 顶部 20% · 30% × 40%',
    });
  });

  it('describes persisted references without loading a Workbench', () => {
    expect(describeConversationContext({
      scope: 'content',
      targetType: 'html.dom',
      targetVersion: 1,
      targetPayload: { element: { textQuote: 'MSE 损失' } },
    })).toEqual({ label: '引用内容', detail: 'MSE 损失' });

    expect(describeConversationContext({
      sourceRevision: '1',
      target: {
        scope: 'content',
        targetType: 'video.frame-region',
        targetVersion: 1,
        targetPayload: { timeSeconds: 48.25 },
      },
    })).toEqual({ label: '48.3 秒处' });
  });
});
