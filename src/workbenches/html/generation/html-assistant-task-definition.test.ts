import { describe, expect, it } from 'vitest';

import {
  HTML_ASSISTANT_INSTRUCTION_FORMAT,
  HTML_ASSISTANT_INSTRUCTION_VERSION,
  HTML_ASSISTANT_TASK_DEFINITION_ID,
  HTML_ASSISTANT_TASK_DEFINITION_VERSION,
} from '../../../shared/generation-definitions';
import {
  HtmlAssistantInstruction,
  htmlAssistantInstructionFactory,
} from './html-assistant-instruction';
import { createHtmlAssistantTaskDefinitionV1 } from './html-assistant-task-definition';
import type { HtmlAssistantTaskResult } from './html-assistant-processor';

const quoteAnchor = Object.freeze({
  scope: 'content',
  anchorType: 'html.quote',
  anchorVersion: 1,
  anchorPayload: Object.freeze({ exact: '自注意力机制' }),
});

describe('htmlAssistantInstructionFactory', () => {
  it('parses a valid instruction', () => {
    const result = htmlAssistantInstructionFactory.parse({
      format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
      version: HTML_ASSISTANT_INSTRUCTION_VERSION,
      conversationId: 'conversation-1',
      question: ' 什么是自注意力？ ',
      anchor: quoteAnchor,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.question).toBe('什么是自注意力？');
    expect(result.value.conversationId).toBe('conversation-1');
    expect(result.value.anchor).toEqual(quoteAnchor);
  });

  it('parses an instruction without anchor', () => {
    const result = htmlAssistantInstructionFactory.parse({
      format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
      version: HTML_ASSISTANT_INSTRUCTION_VERSION,
      conversationId: 'conversation-1',
      question: '总结当前页面',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.anchor).toBeUndefined();
  });

  it('rejects invalid input', () => {
    expect(
      htmlAssistantInstructionFactory.parse({ format: 'wrong' }).ok,
    ).toBe(false);
    expect(
      htmlAssistantInstructionFactory.parse({
        format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
        version: HTML_ASSISTANT_INSTRUCTION_VERSION,
        question: '缺少会话身份',
      }).ok,
    ).toBe(false);
    expect(
      htmlAssistantInstructionFactory.parse({
        format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
        version: HTML_ASSISTANT_INSTRUCTION_VERSION,
        conversationId: '../unsafe',
        question: '问题',
      }).ok,
    ).toBe(false);
    expect(
      htmlAssistantInstructionFactory.parse({
        format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
        version: HTML_ASSISTANT_INSTRUCTION_VERSION,
        conversationId: 'conversation-1',
        question: '   ',
      }).ok,
    ).toBe(false);
    expect(
      htmlAssistantInstructionFactory.parse({
        format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
        version: HTML_ASSISTANT_INSTRUCTION_VERSION,
        conversationId: 'conversation-1',
        question: 'q'.repeat(2_001),
      }).ok,
    ).toBe(false);
    expect(
      htmlAssistantInstructionFactory.parse({
        format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
        version: HTML_ASSISTANT_INSTRUCTION_VERSION,
        conversationId: 'conversation-1',
        question: 'ok',
        anchor: 42,
      }).ok,
    ).toBe(false);
    expect(
      htmlAssistantInstructionFactory.parse({
        format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
        version: HTML_ASSISTANT_INSTRUCTION_VERSION,
        conversationId: 'conversation-1',
        question: 'ok',
        anchor: {
          scope: 'content',
          anchorType: 'html.quote',
          anchorVersion: 1,
          anchorPayload: { exact: 'x'.repeat(10_000) },
        },
      }).ok,
    ).toBe(false);
  });
});

describe('HtmlAssistantInstruction', () => {
  it('renders user message with anchor description', () => {
    const instruction = new HtmlAssistantInstruction({
      conversationId: 'conversation-1',
      question: '什么是自注意力？',
      anchor: quoteAnchor,
    });
    const message = instruction.toUserMessage();

    expect(message.role).toBe('user');
    expect(message.content.length).toBeGreaterThan(0);
    const parts = message.content
      .map((part) => ('text' in part ? part.text : ''))
      .join('');
    expect(parts).toContain('什么是自注意力？');
    expect(parts).toContain('自注意力机制');
    expect(parts).toContain('用户选中/聚焦的内容');
  });

  it('renders user message with whole-page guidance when no anchor', () => {
    const instruction = new HtmlAssistantInstruction({
      conversationId: 'conversation-1',
      question: '请总结当前 HTML 页面。',
    });
    const message = instruction.toUserMessage();

    const parts = message.content
      .map((part) => ('text' in part ? part.text : ''))
      .join('');
    expect(parts).toContain('请总结当前 HTML 页面。');
    expect(parts).toContain('基于整个资料回答');
    expect(parts).not.toContain('用户选中/聚焦的内容');
  });

  it('summarize question never serializes a selection anchor', () => {
    const instruction = new HtmlAssistantInstruction({
      conversationId: 'conversation-1',
      question: '请总结当前 HTML 页面。',
    });
    const snapshot = instruction.toSnapshot();

    expect(snapshot.anchor).toBeUndefined();
    expect(snapshot.question).toContain('总结');
  });

  it('toSnapshot is frozen and versioned', () => {
    const snapshot = new HtmlAssistantInstruction({
      conversationId: 'conversation-1',
      question: '问题',
    }).toSnapshot();

    expect(snapshot.format).toBe(HTML_ASSISTANT_INSTRUCTION_FORMAT);
    expect(snapshot.version).toBe(HTML_ASSISTANT_INSTRUCTION_VERSION);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('rejects empty and oversized questions', () => {
    expect(
      () =>
        new HtmlAssistantInstruction({
          conversationId: 'conversation-1',
          question: '  ',
        }),
    ).toThrow();
    expect(
      () =>
        new HtmlAssistantInstruction({
          conversationId: 'conversation-1',
          question: 'q'.repeat(2_001),
        }),
    ).toThrow();
  });
});

describe('createHtmlAssistantTaskDefinitionV1', () => {
  it('maps each validated conversation to a named workspace', () => {
    const processor = {
      async process() {
        return Object.freeze({
          answer: '回答',
        }) as HtmlAssistantTaskResult;
      },
    };
    const definition = createHtmlAssistantTaskDefinitionV1(processor);

    expect(definition.id).toBe(HTML_ASSISTANT_TASK_DEFINITION_ID);
    expect(definition.version).toBe(HTML_ASSISTANT_TASK_DEFINITION_VERSION);
    expect(definition.primaryWorkspaceConfig).toEqual({
      key: 'html-assistant',
      scope: 'named',
      permissions: { read: true, write: false },
    });
    expect(
      definition.resolvePrimaryWorkspaceInstanceKey?.(
        new HtmlAssistantInstruction({
          conversationId: 'conversation-1',
          question: '问题',
        }),
      ),
    ).toBe('conversation-1');
    expect(definition.assetReferenceSchema.sources).toEqual({
      required: true,
      cardinality: 'one',
      minItems: 1,
    });
    expect(definition.toolRequirements).toEqual([]);
    expect(definition.skills).toEqual([]);
    expect(definition.mcpServers).toEqual([]);
  });
});
