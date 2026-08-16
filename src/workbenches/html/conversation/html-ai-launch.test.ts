import { describe, expect, it } from 'vitest';

import { createHtmlQuoteTarget } from '../shared';
import {
  HTML_SUMMARIZE_PAGE_QUESTION,
  createOpenChatRequest,
  createExplainSelectionRequest,
  createSummarizePageRequest,
  isHtmlAiLaunchRequest,
} from './html-ai-launch';

describe('html ai launch requests', () => {
  it('open-chat 使用 draft 提交且允许无锚点', () => {
    const request = createOpenChatRequest(1);

    expect(request.intent).toBe('open-chat');
    expect(request.submit).toBe('draft');
    expect(request.anchor).toBeNull();
    if (request.intent === 'open-chat') {
      expect(request.submit).toBe('draft');
    }
  });

  it('open-chat 携带已选锚点时仍为 draft', () => {
    const anchor = createHtmlQuoteTarget('选中文本');
    const request = createOpenChatRequest(1, anchor);

    expect(request.intent).toBe('open-chat');
    expect(request.anchor).toBe(anchor);
    expect(request.submit).toBe('draft');
  });

  it('explain-selection 固定锚点、draft 提交且不预填问题（用户自己提问）', () => {
    const anchor = createHtmlQuoteTarget('自注意力机制');
    const request = createExplainSelectionRequest(1, anchor);

    if (request.intent !== 'explain-selection') {
      throw new Error('unexpected intent');
    }
    expect(request.submit).toBe('draft');
    expect(request.anchor).toBe(anchor);
    if ('question' in request) {
      throw new Error('explain-selection 不应携带固定问题');
    }
  });

  it('summarize-page 固定自动提交、专用问题且锚点为 null', () => {
    const request = createSummarizePageRequest(1);

    if (request.intent !== 'summarize-page') {
      throw new Error('unexpected intent');
    }
    expect(request.submit).toBe('auto');
    expect(request.anchor).toBeNull();
    expect(request.question).toBe(HTML_SUMMARIZE_PAGE_QUESTION);
    expect(request.question.trim().length).toBeGreaterThan(0);
  });

  it('连续创建请求时 id 递增', () => {
    const first = createSummarizePageRequest(1);
    const second = createSummarizePageRequest(2);

    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(second.id).not.toBe(first.id);
  });

  it('请求类型守卫接受三种意图', () => {
    const anchor = createHtmlQuoteTarget('x');

    expect(
      isHtmlAiLaunchRequest(createOpenChatRequest(1, anchor)),
    ).toBe(true);
    expect(
      isHtmlAiLaunchRequest(createExplainSelectionRequest(2, anchor)),
    ).toBe(true);
    expect(
      isHtmlAiLaunchRequest(createSummarizePageRequest(3)),
    ).toBe(true);
  });

  it('请求类型守卫拒绝无效 id、锚点和总结请求', () => {
    expect(
      isHtmlAiLaunchRequest({
        id: 0,
        intent: 'open-chat',
        anchor: null,
        submit: 'draft',
      }),
    ).toBe(false);
    expect(
      isHtmlAiLaunchRequest({
        id: 1,
        intent: 'explain-selection',
        anchor: null,
        submit: 'draft',
      }),
    ).toBe(false);
    expect(
      isHtmlAiLaunchRequest({
        id: 1,
        intent: 'summarize-page',
        anchor: { stale: true },
        question: '总结',
        submit: 'auto',
      }),
    ).toBe(false);
  });
});
