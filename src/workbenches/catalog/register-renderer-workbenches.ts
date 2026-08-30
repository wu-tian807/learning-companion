import type { RendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import type { RendererWorkbenchRegistry } from '../../renderer/workbench/renderer-workbench-registry';
import type { ConversationContextPresentation } from '../../renderer/conversation/conversation-contracts';
import type { ConversationMessageContextSource } from '../../shared/project-conversations';
import type { JsonValue } from '../../shared/workbench/protocol';
import { audioRendererWorkbenchContribution } from '../audio/renderer-contribution';
import { epubRendererWorkbenchContribution } from '../epub/renderer-contribution';
import { htmlRendererWorkbenchContribution } from '../html/renderer-contribution';
import { imageRendererWorkbenchContribution } from '../image/renderer-contribution';
import { markdownRendererWorkbenchContribution } from '../markdown/renderer-contribution';
import { mindMapRendererWorkbenchContribution } from '../mindmap/renderer-contribution';
import { officeRendererWorkbenchContribution } from '../office/renderer-contribution';
import { pdfRendererWorkbenchContribution } from '../pdf/renderer-contribution';
import { plainTextRendererWorkbenchContribution } from '../plain-text/renderer-contribution';
import { videoRendererWorkbenchContribution } from '../video/renderer-contribution';

export type { RendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';

export const rendererWorkbenchContributions: readonly RendererWorkbenchContribution[] =
  Object.freeze([
    plainTextRendererWorkbenchContribution,
    markdownRendererWorkbenchContribution,
    mindMapRendererWorkbenchContribution,
    pdfRendererWorkbenchContribution,
    officeRendererWorkbenchContribution,
    htmlRendererWorkbenchContribution,
    epubRendererWorkbenchContribution,
    imageRendererWorkbenchContribution,
    audioRendererWorkbenchContribution,
    videoRendererWorkbenchContribution,
  ]);

export function registerRendererWorkbenches(
  registry: Pick<RendererWorkbenchRegistry, 'registerLoader'>,
): void {
  for (const { manifest, load } of rendererWorkbenchContributions) {
    registry.registerLoader(manifest, load);
  }
}

export function describeRendererConversationContext(
  source: ConversationMessageContextSource,
  context: JsonValue,
): ConversationContextPresentation | undefined {
  const presenter = rendererWorkbenchContributions.find(
    ({ conversationContextPresenter: candidate }) =>
      candidate?.contributionId === source.contributionId &&
      candidate.contextProviderId === source.contextProviderId,
  )?.conversationContextPresenter;
  return presenter?.describe(context);
}
