import { isAssetTarget, type AssetTarget } from '../../shared/workbench/anchor';
import type { JsonValue } from '../../shared/workbench/protocol';
import type { ConversationContextPresentation } from './conversation-contracts';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
}

export function conversationContextTarget(
  context: JsonValue | undefined,
): AssetTarget | undefined {
  if (isAssetTarget(context)) return context;
  const target = record(context)?.target;
  return isAssetTarget(target) ? target : undefined;
}

export function conversationContextSourceRevision(
  context: JsonValue | undefined,
): string | undefined {
  return text(record(context)?.sourceRevision);
}

function anchorDetail(target: AssetTarget): string | undefined {
  if (target.scope !== 'content') return undefined;
  const payload = record(target.anchorPayload);
  const quote = record(payload?.quote);
  const element = record(payload?.element);
  const firstRange = Array.isArray(payload?.ranges)
    ? record(payload.ranges[0])
    : undefined;
  const region = ['x', 'y', 'width', 'height'].every(
    (key) => typeof payload?.[key] === 'number',
  )
    ? `左侧 ${Math.round(Number(payload!.x) * 100)}% · 顶部 ${Math.round(Number(payload!.y) * 100)}% · ${Math.round(Number(payload!.width) * 100)}% × ${Math.round(Number(payload!.height) * 100)}%`
    : undefined;
  return (
    text(quote?.exact) ??
    text(firstRange?.exact) ??
    text(payload?.exact) ??
    text(element?.textQuote) ??
    text(payload?.textQuote) ??
    text(payload?.url) ??
    region
  );
}

function anchorLabel(target: AssetTarget, context: Record<string, unknown>): string {
  if (target.scope === 'asset') return '整份资料';
  const payload = record(target.anchorPayload);
  const pageNumber = Number.isSafeInteger(context.pageNumber)
    ? Number(context.pageNumber)
    : Number.isSafeInteger(payload?.pageNumber)
      ? Number(payload?.pageNumber)
      : undefined;
  if (pageNumber && pageNumber > 0) return `第 ${pageNumber} 页`;
  if (typeof payload?.timeSeconds === 'number') {
    return `${payload.timeSeconds.toFixed(1)} 秒处`;
  }
  if (text(payload?.url)) return '链接';
  if (['x', 'y', 'width', 'height'].every(
    (key) => typeof payload?.[key] === 'number',
  )) return '引用区域';
  return '引用内容';
}

export function describeConversationContext(
  context: JsonValue | undefined,
): ConversationContextPresentation {
  const contextRecord = record(context) ?? {};
  const target = conversationContextTarget(context);
  if (!target) return { label: '引用内容' };
  const selectedText = text(contextRecord.selectedText);
  const detail = selectedText ?? anchorDetail(target);
  const previewDataUrl = text(contextRecord.previewDataUrl);
  return {
    label: anchorLabel(target, contextRecord),
    ...(detail ? { detail } : {}),
    ...(previewDataUrl ? { previewDataUrl } : {}),
  };
}
