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
  IMAGE_DEFAULT_EXPLANATION_QUESTION,
  IMAGE_EXPLANATION_INSTRUCTION_FORMAT,
  IMAGE_EXPLANATION_INSTRUCTION_VERSION,
  isImageRegionTarget,
  type ImageRegionTarget,
} from '../shared';

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9._-]{1,256}$/u;
const MAX_QUESTION_LENGTH = 32_768;

export type ImageExplanationInstructionSnapshot = JsonValue & {
  readonly format: typeof IMAGE_EXPLANATION_INSTRUCTION_FORMAT;
  readonly version: typeof IMAGE_EXPLANATION_INSTRUCTION_VERSION;
  readonly assetId: string;
  readonly sourceRevision?: string;
  readonly target?: JsonValue & ImageRegionTarget;
  readonly conversationId?: string;
  readonly question?: string;
  readonly saveAsNote?: boolean;
  readonly generateTitle?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ImageExplanationInstruction extends GenerationInstruction<ImageExplanationInstructionSnapshot> {
  readonly assetId: string;
  readonly sourceRevision?: string;
  readonly target?: ImageRegionTarget;
  readonly conversationId?: string;
  readonly question: string;
  readonly saveAsNote: boolean;
  readonly generateTitle: boolean;

  constructor(input: {
    readonly assetId: string;
    readonly sourceRevision?: string;
    readonly target?: ImageRegionTarget;
    readonly conversationId?: string;
    readonly question?: string;
    readonly saveAsNote?: boolean;
    readonly generateTitle?: boolean;
  }) {
    super();
    const assetId = input.assetId.trim();
    const sourceRevision = input.sourceRevision?.trim();
    const conversationId = input.conversationId?.trim();
    const question = (input.question ?? IMAGE_DEFAULT_EXPLANATION_QUESTION).trim();
    const saveAsNote = input.saveAsNote ?? input.target !== undefined;
    if (
      !assetId ||
      (sourceRevision !== undefined &&
        !SOURCE_REVISION_PATTERN.test(sourceRevision)) ||
      !question ||
      question.length > MAX_QUESTION_LENGTH ||
      (conversationId !== undefined && !CONVERSATION_ID_PATTERN.test(conversationId)) ||
      (saveAsNote && !input.target) ||
      (!input.target && !conversationId)
    ) {
      throw new Error('图片解释对话任务数据无效');
    }
    this.assetId = assetId;
    this.sourceRevision = sourceRevision;
    this.target = input.target;
    this.conversationId = conversationId;
    this.question = question;
    this.saveAsNote = saveAsNote;
    this.generateTitle = input.generateTitle === true;
  }

  toSnapshot(): ImageExplanationInstructionSnapshot {
    const target = this.target
      ? (Object.freeze({
          scope: 'content' as const,
          anchorType: this.target.anchorType,
          anchorVersion: this.target.anchorVersion,
          anchorPayload: this.target.anchorPayload,
        }) as JsonValue & ImageRegionTarget)
      : undefined;
    return Object.freeze({
      format: IMAGE_EXPLANATION_INSTRUCTION_FORMAT,
      version: IMAGE_EXPLANATION_INSTRUCTION_VERSION,
      assetId: this.assetId,
      ...(this.sourceRevision
        ? { sourceRevision: this.sourceRevision }
        : {}),
      ...(target ? { target } : {}),
      ...(this.conversationId ? { conversationId: this.conversationId } : {}),
      question: this.question,
      saveAsNote: this.saveAsNote,
      ...(this.generateTitle ? { generateTitle: true } : {}),
    });
  }

  toUserMessage(): AgentUserMessage {
    const titleInstruction = this.generateTitle
      ? '\n\n这是本次对话的第一个问题。请先输出一行 <conversation-title>简短主题</conversation-title>，主题不超过 16 个汉字，然后再输出正常回答。'
      : '';
    if (!this.target) {
      return createTextAgentUserMessage(
        `用户在当前图片解读对话中继续追问：\n\n${this.question}\n\n请结合同一对话中已有的整张图片、兴趣区域和前文直接回答。${titleInstruction}`,
      );
    }
    const region = this.target.anchorPayload;
    return createTextAgentUserMessage(`用户问题：${this.question}

请解释用户在图片中选中的兴趣区域。

你将依次收到三张由同一张源图片生成的图像：
1. 未遮挡的整图，用于理解主题、场景和整体结构。
2. 标出红框的整图，红框就是用户选择的兴趣区域。
3. 兴趣区域及其邻近上下文的放大图，用于观察局部细节。

必须先理解整图，再结合红框位置、周边关系和局部放大图解释，不能把第三张图当成脱离语境的独立图片。说明选中内容是什么、它在整图中的作用、它与周围内容的关系，以及真正有助于理解的关键细节。若文字或细节看不清，明确说明不确定性，不要猜测。

区域归一化坐标：x=${region.x.toFixed(6)}, y=${region.y.toFixed(6)}, width=${region.width.toFixed(6)}, height=${region.height.toFixed(6)}。${titleInstruction}`);
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
        (input.sourceRevision !== undefined &&
          typeof input.sourceRevision !== 'string') ||
        (input.target !== undefined && !isImageRegionTarget(input.target)) ||
        (input.conversationId !== undefined && typeof input.conversationId !== 'string') ||
        (input.question !== undefined && typeof input.question !== 'string') ||
        (input.saveAsNote !== undefined && typeof input.saveAsNote !== 'boolean') ||
        (input.generateTitle !== undefined && typeof input.generateTitle !== 'boolean')
      ) {
        return generationValidationFailure([
          { path: 'instruction', message: '图片区域解释任务数据无效' },
        ]);
      }
      try {
        return generationValidationSuccess(
          new ImageExplanationInstruction({
            assetId: input.assetId,
            ...(input.sourceRevision === undefined
              ? {}
              : { sourceRevision: input.sourceRevision }),
            ...(input.target === undefined ? {} : { target: input.target }),
            ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
            ...(input.question === undefined ? {} : { question: input.question }),
            ...(input.saveAsNote === undefined ? {} : { saveAsNote: input.saveAsNote }),
            ...(input.generateTitle === true ? { generateTitle: true } : {}),
          }),
        );
      } catch {
        return generationValidationFailure([
          { path: 'instruction', message: '图片解释对话任务数据无效' },
        ]);
      }
    },
  });
