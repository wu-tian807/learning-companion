import { join } from 'node:path';
import {
  prepareVisualRegionInputs,
  type PreparedVisualRegionInputs,
} from '../../../../main/conversation/visual-region-input-preparer';
import type { ImageRegionTarget } from '../shared';

export type PreparedImageExplanationInputs = PreparedVisualRegionInputs;

export async function prepareImageExplanationInputs(
  sourcePath: string,
  target: ImageRegionTarget,
  workspacePath: string,
): Promise<PreparedImageExplanationInputs> {
  return prepareVisualRegionInputs(
    sourcePath,
    target.anchorPayload,
    join(workspacePath, 'image-explanation-inputs'),
  );
}
