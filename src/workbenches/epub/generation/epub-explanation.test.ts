import { describe, expect, it, vi } from 'vitest';

import {
  EPUB_EXPLANATION_TASK_DEFINITION_ID,
  EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
} from '../../../shared/epub-explanations';
import { EpubExplanationInstruction } from './epub-explanation-instruction';
import { createEpubExplanationTaskDefinitionV1 } from './epub-explanation-task-definition';

describe('EPUB explanation generation', () => {
  it('creates a fixed explanation message with selection context', () => {
    const instruction = new EpubExplanationInstruction({
      attachmentId: 'attachment-1',
      exact: '需要解释的文字',
      prefix: '前面的内容',
      suffix: '后面的内容',
    });
    const message = instruction.toUserMessage();
    const text = message.content[0];

    expect(instruction.toSnapshot()).toMatchObject({
      attachmentId: 'attachment-1',
      exact: '需要解释的文字',
    });
    expect(text).toMatchObject({ type: 'text' });
    expect(text.type === 'text' ? text.text : '').toContain(
      '<selection>\n需要解释的文字\n</selection>',
    );
    expect(text.type === 'text' ? text.text : '').toContain('前面的内容');
    expect(text.type === 'text' ? text.text : '').toContain('后面的内容');
  });

  it('registers as an isolated writable GenerationTask', () => {
    const definition = createEpubExplanationTaskDefinitionV1({
      process: vi.fn(),
    });

    expect(definition.id).toBe(EPUB_EXPLANATION_TASK_DEFINITION_ID);
    expect(definition.version).toBe(
      EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
    );
    expect(definition.primaryWorkspaceConfig).toMatchObject({
      scope: 'task',
      permissions: { read: true, write: true },
    });
    expect(definition.assetReferenceSchema).toEqual({});
  });
});
