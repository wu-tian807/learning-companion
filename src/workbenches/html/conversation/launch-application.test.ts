import { describe, expect, it } from 'vitest';

import { createHtmlQuoteTarget } from '../shared';
import type { HtmlAiLaunchRequest } from './html-ai-launch';
import {
  HTML_SUMMARIZE_PAGE_QUESTION,
} from './html-ai-launch';
import {
  applyLaunchRequest,
  createSubmitSpec,
  type PendingAnchorValue,
} from './launch-application';

function requestOf(
  intent: HtmlAiLaunchRequest['intent'],
  id = 1,
): HtmlAiLaunchRequest {
  if (intent === 'open-chat') {
    return { id, intent, anchor: null, submit: 'draft' };
  }
  if (intent === 'explain-selection') {
    return {
      id,
      intent,
      anchor: createHtmlQuoteTarget('选中文本'),
      submit: 'draft',
    };
  }
  return {
    id,
    intent,
    anchor: null,
    question: HTML_SUMMARIZE_PAGE_QUESTION,
    submit: 'auto',
  };
}

describe('applyLaunchRequest', () => {
  it('open-chat 带锚点：设置为 pendingAnchor 且不提交', () => {
    const anchor = createHtmlQuoteTarget('选中文本');
    const result = applyLaunchRequest({
      id: 1,
      intent: 'open-chat',
      anchor,
      submit: 'draft',
    });

    expect(result.pendingAnchor).toBe(anchor);
    expect(result.autoSubmit).toBeUndefined();
  });

  it('open-chat 无锚点：清除旧 pendingAnchor 且不提交', () => {
    const result = applyLaunchRequest({
      id: 1,
      intent: 'open-chat',
      anchor: null,
      submit: 'draft',
    });

    expect(result.pendingAnchor).toBeNull();
    expect(result.autoSubmit).toBeUndefined();
  });

  it('explain-selection：设置锚点且不自动提交（用户自己提问）', () => {
    const anchor = createHtmlQuoteTarget('自注意力机制');
    const result = applyLaunchRequest({
      id: 2,
      intent: 'explain-selection',
      anchor,
      submit: 'draft',
    });

    expect(result.pendingAnchor).toBe(anchor);
    expect(result.autoSubmit).toBeUndefined();
  });

  it('summarize-page：清除旧锚点并自动提交无锚点问题', () => {
    const result = applyLaunchRequest({
      id: 3,
      intent: 'summarize-page',
      anchor: null,
      question: HTML_SUMMARIZE_PAGE_QUESTION,
      submit: 'auto',
    });

    expect(result.pendingAnchor).toBeNull();
    expect(result.autoSubmit?.question).toBe(
      HTML_SUMMARIZE_PAGE_QUESTION,
    );
    expect(result.autoSubmit?.anchor).toBeUndefined();
  });
});

describe('createSubmitSpec', () => {
  it('question 为空时返回 undefined（不提交）', () => {
    expect(createSubmitSpec('   ')).toBeUndefined();
  });

  it('question 非空时返回自动提交规格', () => {
    const spec = createSubmitSpec('问题', undefined);

    expect(spec).toEqual({ question: '问题' });
    expect(spec?.anchor).toBeUndefined();
  });

  it('带锚点时返回包含锚点的规格', () => {
    const anchor = createHtmlQuoteTarget('选区');
    const spec = createSubmitSpec('问题', anchor);

    expect(spec).toEqual({ question: '问题', anchor });
  });
});

describe('launch request 类型闭环', () => {
  it('三种意图都能生成合法请求并应用', () => {
    const openChat = applyLaunchRequest(requestOf('open-chat'));
    const explain = applyLaunchRequest(requestOf('explain-selection'));
    const summarize = applyLaunchRequest(requestOf('summarize-page'));

    expect(openChat.pendingAnchor).toBeNull();
    expect(explain.pendingAnchor).toEqual(
      expect.objectContaining({ anchorType: 'html.quote' }),
    );
    expect(summarize.pendingAnchor).toBeNull();
  });

  it('pendingAnchor 类型允许 undefined（未变化语义）', () => {
    const anchor: PendingAnchorValue = undefined;

    expect(anchor).toBeUndefined();
  });
});
