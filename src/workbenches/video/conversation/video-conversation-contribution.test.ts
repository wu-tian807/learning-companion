import { describe, expect, it, vi } from 'vitest';

import { createContextualConversationTaskRequest } from '../../../renderer/conversation/conversation-task-request';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import { createVideoFrameRegionTarget } from '../shared';
import {
  createVideoConversationContribution,
  createVideoFrameConversationLaunch,
} from './video-conversation-contribution';
import {
  createVideoConversationContext,
  shouldReleaseVideoConversationContext,
  VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
} from './video-conversation-context';

const target = createVideoFrameRegionTarget({
  timeSeconds: 12.345,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  sourceWidth: 1920,
  sourceHeight: 1080,
});

function contribution(sourceRevision = '100') {
  return createVideoConversationContribution({
    sourceRevision,
  });
}

describe('video conversation contribution', () => {
  it('uses the shared conversation task without copying the full video', () => {
    const context = createVideoConversationContext(target, '100');
    expect(
      createContextualConversationTaskRequest(contribution(), {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '画面中的公式是什么意思？',
        context,
        generateTitle: true,
      }),
    ).toMatchObject({
      definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
      definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      instruction: {
        contextProviderId: VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
        conversationId: 'conversation-1',
        question: '画面中的公式是什么意思？',
        context,
        generateTitle: true,
      },
      assetReferences: {},
    });
  });

  it('attaches the selected frame without injecting or submitting a default question', () => {
    const context = createVideoConversationContext(target, '100');

    const launch = createVideoFrameConversationLaunch(context);

    expect(launch).toEqual({ context });
    expect(launch).not.toHaveProperty('question');
    expect(launch).not.toHaveProperty('submit');
  });

  it('can target the conversation that originally created a saved marker', () => {
    const context = createVideoConversationContext(target, '100');

    expect(
      createVideoFrameConversationLaunch(context, 'conversation-1'),
    ).toEqual({ context, conversationId: 'conversation-1' });
  });

  it('requires a current-revision frame whenever the Video context provider is selected', () => {
    expect(() =>
      createContextualConversationTaskRequest(contribution(), {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '解释这里',
        generateTitle: true,
      }),
    ).toThrow('请先在视频画面上单击或拖动选择一个区域');

    expect(() =>
      createContextualConversationTaskRequest(contribution(), {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '解释这里',
        context: createVideoConversationContext(target, '101'),
        generateTitle: true,
      }),
    ).toThrow('当前聊天上下文无效');

    expect(() =>
      createContextualConversationTaskRequest(contribution(), {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '刚才框内的文字是什么意思？',
        generateTitle: false,
      }),
    ).toThrow('请先在视频画面上单击或拖动选择一个区域');
  });

  it('persists any initial frame answer as a marker but keeps follow-ups conversational', () => {
    const value = contribution();
    const context = createVideoConversationContext(target, '100');

    expect(
      value.shouldCommitAnswer?.({
        question: '公式中的 λ 表示什么？',
        context,
      } as never),
    ).toBe(true);
    expect(
      value.shouldCommitAnswer?.({
        question: '换一种说法',
      } as never),
    ).toBe(false);
  });
  it('releases only the Video-owned context through the shared lifecycle hook', () => {
    const onContextReleased = vi.fn();
    const context = createVideoConversationContext(target, '100');
    const value = createVideoConversationContribution({
      sourceRevision: '100',
      onContextReleased,
    });
    value.onContextReleased?.(context);
    value.onContextReleased?.(undefined);
    expect(onContextReleased).toHaveBeenNthCalledWith(1, context);
    expect(onContextReleased).toHaveBeenNthCalledWith(2, undefined);
  });

  it('does not let a stale task release a newer frame selection', () => {
    const oldContext = createVideoConversationContext(target, '100');
    const newContext = createVideoConversationContext(
      createVideoFrameRegionTarget({
        timeSeconds: 20,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.4,
        sourceWidth: 1920,
        sourceHeight: 1080,
      }),
      '100',
    );
    expect(
      shouldReleaseVideoConversationContext(newContext, oldContext),
    ).toBe(false);
    expect(
      shouldReleaseVideoConversationContext(newContext, newContext),
    ).toBe(true);
    expect(
      shouldReleaseVideoConversationContext(newContext, undefined),
    ).toBe(true);
  });

  it('does not own a separate per-video history store', () => {
    expect(contribution()).not.toHaveProperty('historyStore');
  });
});
