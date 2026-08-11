import type { JsonValue } from '../../shared/workbench/protocol';

export const AI_ANNOTATION_ATTACHMENT_TYPE = 'ai.annotation';
export const AI_ANNOTATION_ATTACHMENT_VERSION = 1;

/** Small, queryable metadata only. Full question/answer text lives in content.ref. */
export interface AiAnnotationMetadata {
  readonly contentFormat: 'ai-annotation-v1';
  readonly questionPreview: string;
  readonly modelInfo?: string;
  readonly timestamp: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAiAnnotationMetadata(value: JsonValue): boolean {
  if (!isRecord(value) || value.contentFormat !== 'ai-annotation-v1') return false;
  if (Object.keys(value).some((key) => !['contentFormat', 'questionPreview', 'modelInfo', 'timestamp'].includes(key))) return false;
  if (
    typeof value.questionPreview !== 'string' ||
    value.questionPreview.trim().length === 0 ||
    [...value.questionPreview].length > 200
  ) return false;
  if (value.modelInfo !== undefined && typeof value.modelInfo !== 'string') return false;
  if (typeof value.timestamp !== 'number' || !Number.isSafeInteger(value.timestamp) || value.timestamp <= 0) return false;
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= 16 * 1024;
}
