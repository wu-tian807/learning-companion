import type { JsonValue } from '../../shared/workbench/protocol';

export const AI_ANNOTATION_ATTACHMENT_TYPE = 'ai.annotation';
export const AI_ANNOTATION_ATTACHMENT_VERSION = 1;
/**
 * AI 问答标注的元数据结构。
 * 用户在文档上选择一段文字，向 AI 提问后，
 * 将 AI 的回答（或用户选中的部分）作为标注附着在文档上。
 */
export interface AiAnnotationMetadata {
  /** 用户向 AI 提出的问题 */
  question: string;
  /** AI 的完整回答 */
  answer: string;
  /** 用户选择保留的部分回答（可选，为空则保留全部回答） */
  selectedAnswer?: string;
  /** 使用的模型/Agent 信息（可选） */
  modelInfo?: string;
  /** 标注创建时的时间戳 */
  timestamp: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isAiAnnotationMetadata(
  value: JsonValue,
): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (!isString(value.question) || value.question.trim().length === 0) {
    return false;
  }

  if (!isString(value.answer) || value.answer.trim().length === 0) {
    return false;
  }

  if (
    value.selectedAnswer !== undefined &&
    value.selectedAnswer !== null &&
    (!isString(value.selectedAnswer) || value.selectedAnswer.trim().length === 0)
  ) {
    return false;
  }

  if (
    value.modelInfo !== undefined &&
    value.modelInfo !== null &&
    !isString(value.modelInfo)
  ) {
    return false;
  }

  if (typeof value.timestamp !== 'number' || value.timestamp <= 0) {
    return false;
  }

  return true;
}
