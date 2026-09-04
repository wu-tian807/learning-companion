import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { mindMapGenerationMainFeature } from './generation/main';
import { MindMapWorkbenchProvider } from './main';
import { mindMapWorkbenchManifest } from './shared';
import { mindMapTargetMainFeature } from './target-main-feature';
import { MindMapConversationContextProvider } from './conversation/mindmap-conversation-context-provider';

export const mindMapMainWorkbenchContribution =
  composeMainWorkbenchContribution(
    mindMapWorkbenchManifest,
    (context) =>
      new MindMapWorkbenchProvider(
        context.stateDatabase,
        context.associationService,
      ),
    [
      mindMapTargetMainFeature,
      mindMapGenerationMainFeature,
      {
        id: 'builtin.mindmap.conversation-generation',
        registerGeneration({ conversationContexts }): void {
          conversationContexts.register(new MindMapConversationContextProvider());
        },
      },
    ],
  );
