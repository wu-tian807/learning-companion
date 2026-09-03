import type { OpenWorkbenchConversationInput } from '../../../renderer/conversation/workbench-conversation-runtime';
import type { ImageRegionTarget } from '../shared';
import { createImageConversationContext } from './image-conversation-context';
import { IMAGE_DEFAULT_EXPLANATION_QUESTION } from './shared';

export type ImageRegionConversationMode = 'explain' | 'ask';

export function createImageRegionConversationOpenOptions(
  target: ImageRegionTarget,
  sourceRevision: string,
  mode: ImageRegionConversationMode,
): OpenWorkbenchConversationInput {
  const context = createImageConversationContext(target, sourceRevision);
  if (mode === 'ask') return { context };
  return {
    context,
    question: IMAGE_DEFAULT_EXPLANATION_QUESTION,
    submit: true,
  };
}
