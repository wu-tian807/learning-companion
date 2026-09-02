import { describe, expect, it } from 'vitest';

import type { AssetAssociationServiceApi } from '../../../main/asset-associations/asset-association-service';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import { GenerationTaskDefinitionRegistry } from '../../../main/generation/generation-task-definition-registry';
import { AssetTargetRegistry } from '../../../main/workbench/asset-target-registry';
import type { MainWorkbenchGenerationContext } from '../../../main/workbench/main-workbench-contribution';
import {
  MIND_MAP_GENERATION_TASK_DEFINITION_ID,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION_V1,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION_V2,
} from '../../../shared/generation-definitions';
import { mindMapGenerationMainFeature } from './main';

describe('Mind Map generation main feature', () => {
  it('registers both the recovery protocol and the latest protocol', () => {
    const definitions = new GenerationTaskDefinitionRegistry();

    mindMapGenerationMainFeature.registerGeneration?.({
      definitions,
      assets: {} as AssetServiceApi,
      associations: {} as AssetAssociationServiceApi,
      targets: new AssetTargetRegistry(),
    } as unknown as MainWorkbenchGenerationContext);

    expect(
      definitions.get(
        MIND_MAP_GENERATION_TASK_DEFINITION_ID,
        MIND_MAP_GENERATION_TASK_DEFINITION_VERSION_V1,
      ),
    ).toBeDefined();
    expect(
      definitions.get(
        MIND_MAP_GENERATION_TASK_DEFINITION_ID,
        MIND_MAP_GENERATION_TASK_DEFINITION_VERSION_V2,
      ),
    ).toBeDefined();
    expect(
      definitions.get(
        MIND_MAP_GENERATION_TASK_DEFINITION_ID,
        MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
      ),
    ).toBeDefined();
  });
});
