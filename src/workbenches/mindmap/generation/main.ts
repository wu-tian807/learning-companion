import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import {
  AssetTargetMindMapGenerationProcessor,
  LegacyMindMapGenerationProcessor,
  MindMapGenerationProcessor,
} from './mindmap-generation-processor';
import {
  createMindMapGenerationTaskDefinitionV1,
  createMindMapGenerationTaskDefinitionV2,
  createMindMapGenerationTaskDefinitionV3,
} from './mindmap-generation-task-definition';

export const mindMapGenerationMainFeature = Object.freeze({
  id: 'builtin.mindmap.generation',
  registerGeneration({
    definitions,
    assets,
    associations,
    targets,
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
    definitions.register(
      createMindMapGenerationTaskDefinitionV3(
        new AssetTargetMindMapGenerationProcessor(
          assets,
          associations,
          targets,
        ),
      ),
    );
  },
} satisfies MainWorkbenchFeatureContribution);
