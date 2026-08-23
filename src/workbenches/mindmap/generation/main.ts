import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { MindMapGenerationProcessor } from './mindmap-generation-processor';
import { createMindMapGenerationTaskDefinitionV1 } from './mindmap-generation-task-definition';

export const mindMapGenerationMainFeature = Object.freeze({
  id: 'builtin.mindmap.generation',
  registerGeneration({
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
} satisfies MainWorkbenchFeatureContribution);
