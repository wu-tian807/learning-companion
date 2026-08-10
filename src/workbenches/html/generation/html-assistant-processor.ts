import type {
  GenerationTaskProcessContext,
  GenerationTaskProcessor,
} from '../../../main/generation/contracts/task-definition';
import type { HtmlAssistantInstruction } from './html-assistant-instruction';
import type { HtmlAssistantTaskResult } from './html-assistant-result';

export type { HtmlAssistantTaskResult } from './html-assistant-result';

/**
 * Single-turn processor: one agent call per question.
 *
 * Tasks carrying the same conversationId resolve to the same named workspace,
 * so Codex maintains history and the processor never re-sends previous turns.
 * Streaming deltas remain optional execution events; the completed call output
 * is returned as the authoritative business result.
 */
export function createHtmlAssistantProcessor(): GenerationTaskProcessor<
  HtmlAssistantInstruction,
  HtmlAssistantTaskResult
> {
  return {
    async process(
      context: GenerationTaskProcessContext<HtmlAssistantInstruction>,
    ): Promise<HtmlAssistantTaskResult> {
      context.signal?.throwIfAborted();

      const completed = await context.agent.call({
        callKey: 'ask',
        purpose: 'answer',
        userMessage: context.defaultUserMessage,
      });

      context.signal?.throwIfAborted();

      if (!completed.assistantOutput) {
        throw new Error('HTML Assistant 未收到最终回答');
      }

      return Object.freeze({ answer: completed.assistantOutput.text });
    },
  };
}
