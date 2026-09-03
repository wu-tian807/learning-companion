import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { MindMapGenerationProcessor } from './mindmap-generation-processor';
import { createMindMapGenerationTaskDefinition } from './mindmap-generation-task-definition';

export const mindMapGenerationMainFeature = Object.freeze({
  id: 'builtin.mindmap.generation',
  registerGeneration({
    definitions,
    assets,
    associations,
    targets,
  }): void {
    definitions.register(
      createMindMapGenerationTaskDefinition(
        new MindMapGenerationProcessor(assets, associations, targets),
      ),
    );
  },
} satisfies MainWorkbenchFeatureContribution);
