import type { JsonValue } from '../../../shared/workbench/protocol';
import type {
  GenerationTaskProcessContext,
  GenerationTaskProcessor,
} from '../../../main/generation/contracts/task-definition';
import type { HtmlAssistantInstruction } from './html-assistant-instruction';

export type HtmlAssistantTaskResult = JsonValue & {
  readonly answer: string;
};

/**
 * Single-turn processor: one agent call per question.
 *
 * The conversational thread is reused across tasks via the shared workspace
 * (`scope: 'shared'` in the task definition), so Codex maintains history and
 * the processor never re-sends previous turns. The model's streaming reply is
 * delivered to the renderer through generation task events; this processor
 * only marks the task successful.
 */
export function createHtmlAssistantProcessor(
  dependencies: { readonly now?: () => number } = {},
): GenerationTaskProcessor<
  HtmlAssistantInstruction,
  HtmlAssistantTaskResult
> {
  const now = dependencies.now ?? Date.now;

  return {
    async process(
      context: GenerationTaskProcessContext<HtmlAssistantInstruction>,
    ): Promise<HtmlAssistantTaskResult> {
      context.signal?.throwIfAborted();

      await context.agent.call({
        callKey: 'ask',
        purpose: 'answer',
        userMessage: context.defaultUserMessage,
      });

      context.signal?.throwIfAborted();

      return Object.freeze({ answer: '', completedTime: now() });
    },
  };
}
