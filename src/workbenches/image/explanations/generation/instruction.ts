import {
  createTextAgentUserMessage,
  type AgentUserMessage,
} from '../../../../main/generation/contracts/agent-message';
import {
  GenerationInstruction,
  type GenerationInstructionFactory,
} from '../../../../main/generation/contracts/generation-instruction';
import {
  generationValidationFailure,
  generationValidationSuccess,
} from '../../../../main/generation/contracts/generation-validation';
import type { JsonValue } from '../../../../shared/workbench/protocol';
import {
  IMAGE_EXPLANATION_INSTRUCTION_FORMAT,
  IMAGE_EXPLANATION_INSTRUCTION_VERSION,
  isImageRegionTarget,
  type ImageRegionTarget,
} from '../shared';

export type ImageExplanationInstructionSnapshot = JsonValue & {
  readonly format: typeof IMAGE_EXPLANATION_INSTRUCTION_FORMAT;
  readonly version: typeof IMAGE_EXPLANATION_INSTRUCTION_VERSION;
  readonly assetId: string;
  readonly target: JsonValue & ImageRegionTarget;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ImageExplanationInstruction extends GenerationInstruction<ImageExplanationInstructionSnapshot> {
  readonly assetId: string;
  readonly target: ImageRegionTarget;

  constructor(input: { readonly assetId: string; readonly target: ImageRegionTarget }) {
    super();
    this.assetId = input.assetId.trim();
    this.target = input.target;
  }

  toSnapshot(): ImageExplanationInstructionSnapshot {
    return Object.freeze({
      format: IMAGE_EXPLANATION_INSTRUCTION_FORMAT,
      version: IMAGE_EXPLANATION_INSTRUCTION_VERSION,
      assetId: this.assetId,
      target: Object.freeze({
        scope: 'content' as const,
        anchorType: this.target.anchorType,
        anchorVersion: this.target.anchorVersion,
        anchorPayload: this.target.anchorPayload,
      }) as JsonValue & ImageRegionTarget,
    });
  }

  toUserMessage(): AgentUserMessage {
    const region = this.target.anchorPayload;
    return createTextAgentUserMessage(`请解释用户在图片中选中的兴趣区域。

你将依次收到三张由同一张源图片生成的图像：
1. 未遮挡的整图，用于理解主题、场景和整体结构。
2. 标出红框的整图，红框就是用户选择的兴趣区域。
3. 兴趣区域及其邻近上下文的放大图，用于观察局部细节。

必须先理解整图，再结合红框位置、周边关系和局部放大图解释，不能把第三张图当成脱离语境的独立图片。说明选中内容是什么、它在整图中的作用、它与周围内容的关系，以及真正有助于理解的关键细节。若文字或细节看不清，明确说明不确定性，不要猜测。

区域归一化坐标：x=${region.x.toFixed(6)}, y=${region.y.toFixed(6)}, width=${region.width.toFixed(6)}, height=${region.height.toFixed(6)}。`);
  }
}

export const imageExplanationInstructionFactory: GenerationInstructionFactory<ImageExplanationInstruction> =
  Object.freeze({
    parse(input: JsonValue) {
      if (
        !isRecord(input) ||
        input.format !== IMAGE_EXPLANATION_INSTRUCTION_FORMAT ||
        input.version !== IMAGE_EXPLANATION_INSTRUCTION_VERSION ||
        typeof input.assetId !== 'string' ||
        input.assetId.trim().length === 0 ||
        !isImageRegionTarget(input.target)
      ) {
        return generationValidationFailure([
          { path: 'instruction', message: '图片区域解释任务数据无效' },
        ]);
      }
      return generationValidationSuccess(
        new ImageExplanationInstruction({ assetId: input.assetId, target: input.target }),
      );
    },
  });
