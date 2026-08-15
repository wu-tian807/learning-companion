import type { MainWorkbenchContribution } from '../../catalog/register-main-workbenches';
import { MindMapGenerationProcessor } from './mindmap-generation-processor';
import { createMindMapGenerationTaskDefinitionV1 } from './mindmap-generation-task-definition';

export const mindMapGenerationMainFeature = Object.freeze({
  id: 'builtin.mindmap.generation',
  registerGenerationTaskDefinitions({
    definitions,
    assets,
    associations,
  }): void {
    definitions.register(
      createMindMapGenerationTaskDefinitionV1(
        new MindMapGenerationProcessor(assets, associations),
      ),
    );
  },
} satisfies MainWorkbenchContribution);
