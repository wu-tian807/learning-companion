import type { JsonValue } from '../../../shared/workbench/protocol';
import { createTextAgentUserMessage } from '../../../main/generation/contracts/agent-message';
import {
  GenerationInstruction,
  type GenerationInstructionFactory,
} from '../../../main/generation/contracts/generation-instruction';
import {
  generationValidationFailure,
  generationValidationSuccess,
} from '../../../main/generation/contracts/generation-validation';
import {
  isTranslatableSubtitleLanguage,
  type TranslatableSubtitleLanguage,
} from '../contracts';

export const SUBTITLE_TRANSLATION_TASK_DEFINITION_ID =
  'builtin.media-subtitles.translate';
export const SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION = 4;
export const SUBTITLE_TRANSLATION_INSTRUCTION_FORMAT =
  'media-subtitle-translation';

export type SubtitleTranslationInstructionSnapshot = JsonValue & {
  readonly format: typeof SUBTITLE_TRANSLATION_INSTRUCTION_FORMAT;
  readonly version: 2;
  readonly assetId: string;
  readonly sourceTrackRevision: string;
  readonly sourceLanguage: TranslatableSubtitleLanguage;
  readonly targetLanguage: TranslatableSubtitleLanguage;
  readonly chunkIndex: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export class SubtitleTranslationInstruction extends GenerationInstruction<SubtitleTranslationInstructionSnapshot> {
  readonly assetId: string;
  readonly sourceTrackRevision: string;
  readonly sourceLanguage: TranslatableSubtitleLanguage;
  readonly targetLanguage: TranslatableSubtitleLanguage;
  readonly chunkIndex: number;

  constructor(input: {
    readonly assetId: string;
    readonly sourceTrackRevision: string;
    readonly sourceLanguage: TranslatableSubtitleLanguage;
    readonly targetLanguage: TranslatableSubtitleLanguage;
    readonly chunkIndex: number;
  }) {
    super();
    this.assetId = input.assetId.trim();
    this.sourceTrackRevision = input.sourceTrackRevision.trim();
    this.sourceLanguage = input.sourceLanguage;
    this.targetLanguage = input.targetLanguage;
    this.chunkIndex = input.chunkIndex;
  }

  toSnapshot(): SubtitleTranslationInstructionSnapshot {
    return Object.freeze({
      format: SUBTITLE_TRANSLATION_INSTRUCTION_FORMAT,
      version: 2,
      assetId: this.assetId,
      sourceTrackRevision: this.sourceTrackRevision,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      chunkIndex: this.chunkIndex,
    });
  }

  toUserMessage() {
    return createTextAgentUserMessage(
      `将 Asset ${this.assetId} 的第 ${this.chunkIndex + 1} 段字幕从 ${this.sourceLanguage} 翻译为 ${this.targetLanguage}。`,
    );
  }
}

export const subtitleTranslationInstructionFactory: GenerationInstructionFactory<SubtitleTranslationInstruction> =
  Object.freeze({
    parse(input: JsonValue) {
      if (
        !isRecord(input) ||
        input.format !== SUBTITLE_TRANSLATION_INSTRUCTION_FORMAT ||
        input.version !== 2 ||
        !isRequiredText(input.assetId) ||
        !isRequiredText(input.sourceTrackRevision) ||
        !isTranslatableSubtitleLanguage(input.sourceLanguage) ||
        !isTranslatableSubtitleLanguage(input.targetLanguage) ||
        input.sourceLanguage === input.targetLanguage ||
        !Number.isSafeInteger(input.chunkIndex) ||
        Number(input.chunkIndex) < 0
      ) {
        return generationValidationFailure([
          {
            path: 'instruction',
            message: '字幕翻译任务参数无效',
          },
        ]);
      }
      return generationValidationSuccess(
        new SubtitleTranslationInstruction({
          assetId: input.assetId,
          sourceTrackRevision: input.sourceTrackRevision,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          chunkIndex: Number(input.chunkIndex),
        }),
      );
    },
  });
