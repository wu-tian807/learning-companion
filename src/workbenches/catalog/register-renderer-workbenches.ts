import type { RendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import type { RendererWorkbenchRegistry } from '../../renderer/workbench/renderer-workbench-registry';
import {
  defaultConversationModeRegistry,
  type ConversationModeRegistry,
} from '../../renderer/conversation/conversation-mode-registry';
import { audioRendererWorkbenchContribution } from '../audio/renderer-contribution';
import { epubRendererWorkbenchContribution } from '../epub/renderer-contribution';
import { htmlRendererWorkbenchContribution } from '../html/renderer-contribution';
import { imageRendererWorkbenchContribution } from '../image/renderer-contribution';
import { markdownRendererWorkbenchContribution } from '../markdown/renderer-contribution';
import { mindMapRendererWorkbenchContribution } from '../mindmap/renderer-contribution';
import { learningOutlineRendererWorkbenchContribution } from '../learning-outline/renderer-contribution';
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
    learningOutlineRendererWorkbenchContribution,
    pdfRendererWorkbenchContribution,
    officeRendererWorkbenchContribution,
    htmlRendererWorkbenchContribution,
    epubRendererWorkbenchContribution,
    imageRendererWorkbenchContribution,
    audioRendererWorkbenchContribution,
    videoRendererWorkbenchContribution,
  ]);

export const rendererGenerationTools = Object.freeze(
  rendererWorkbenchContributions.flatMap(
    ({ generationTools }) => generationTools ?? [],
  ),
);

export function registerRendererWorkbenches(
  registry: Pick<RendererWorkbenchRegistry, 'registerLoader'>,
  modes: ConversationModeRegistry = defaultConversationModeRegistry,
): void {
  for (const { manifest, load, conversationModes } of rendererWorkbenchContributions) {
    registry.registerLoader(manifest, load);
    for (const mode of conversationModes ?? []) modes.register(mode);
  }
}
