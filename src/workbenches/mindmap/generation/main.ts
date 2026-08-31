import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import {
  LegacyMindMapGenerationProcessor,
  MindMapGenerationProcessor,
} from './mindmap-generation-processor';
import {
  createMindMapGenerationTaskDefinitionV1,
  createMindMapGenerationTaskDefinitionV2,
} from './mindmap-generation-task-definition';

export const mindMapGenerationMainFeature = Object.freeze({
  id: 'builtin.mindmap.generation',
  registerGeneration({
    definitions,
    assets,
    associations,
  }): void {
    definitions.register(
      createMindMapGenerationTaskDefinitionV1(
        new LegacyMindMapGenerationProcessor(assets, associations),
      ),
    );
    definitions.register(
      createMindMapGenerationTaskDefinitionV2(
        new MindMapGenerationProcessor(assets, associations),
      ),
    );
  },
} satisfies MainWorkbenchFeatureContribution);
