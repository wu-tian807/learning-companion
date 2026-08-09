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
      question: ' 什么是自注意力？ ',
      anchor: quoteAnchor,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.question).toBe('什么是自注意力？');
    expect(result.value.anchor).toEqual(quoteAnchor);
  });

  it('parses an instruction without anchor', () => {
    const result = htmlAssistantInstructionFactory.parse({
      format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
      version: HTML_ASSISTANT_INSTRUCTION_VERSION,
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
        question: '   ',
      }).ok,
    ).toBe(false);
    expect(
      htmlAssistantInstructionFactory.parse({
        format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
        version: HTML_ASSISTANT_INSTRUCTION_VERSION,
        question: 'q'.repeat(2_001),
      }).ok,
    ).toBe(false);
    expect(
      htmlAssistantInstructionFactory.parse({
        format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
        version: HTML_ASSISTANT_INSTRUCTION_VERSION,
        question: 'ok',
        anchor: { invalid: () => 1 },
      }).ok,
    ).toBe(false);
  });
});

describe('HtmlAssistantInstruction', () => {
  it('renders user message with anchor description', () => {
    const instruction = new HtmlAssistantInstruction({
      question: '什么是自注意力？',
      anchor: quoteAnchor,
    });
    const message = instruction.toUserMessage();

    expect(message.role).toBe('user');
    expect(message.content.length).toBeGreaterThan(0);
    const text = message.content[0]?.text ?? '';
    expect(text).toContain('什么是自注意力？');
    expect(text).toContain('自注意力机制');
  });

  it('toSnapshot is frozen and versioned', () => {
    const snapshot = new HtmlAssistantInstruction({
      question: '问题',
    }).toSnapshot();

    expect(snapshot.format).toBe(HTML_ASSISTANT_INSTRUCTION_FORMAT);
    expect(snapshot.version).toBe(HTML_ASSISTANT_INSTRUCTION_VERSION);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('rejects empty and oversized questions', () => {
    expect(() => new HtmlAssistantInstruction({ question: '  ' })).toThrow();
    expect(
      () => new HtmlAssistantInstruction({ question: 'q'.repeat(2_001) }),
    ).toThrow();
  });
});

describe('createHtmlAssistantTaskDefinitionV1', () => {
  it('declares shared workspace scope and single source schema', () => {
    const processor = {
      async process() {
        return Object.freeze({ answer: '' }) as HtmlAssistantTaskResult;
      },
    };
    const definition = createHtmlAssistantTaskDefinitionV1(processor);

    expect(definition.id).toBe(HTML_ASSISTANT_TASK_DEFINITION_ID);
    expect(definition.version).toBe(HTML_ASSISTANT_TASK_DEFINITION_VERSION);
    expect(definition.primaryWorkspaceConfig).toEqual({
      key: 'html-assistant',
      scope: 'shared',
      permissions: { read: true, write: false },
    });
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
