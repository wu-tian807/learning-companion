/**
 * Readable summary of a HTML anchor (html.quote / html.element / html.link).
 * Pure presentation: takes the serialized anchorPayload and renders a chip.
 */
import type { JsonValue } from '../../../shared/workbench/protocol';

export interface HtmlAnchorSummary {
  readonly kindLabel: string;
  readonly detail?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function summarizeHtmlAnchor(anchor: JsonValue): HtmlAnchorSummary {
  if (!isRecord(anchor)) {
    return { kindLabel: '内容' };
  }

  if (anchor.anchorType === 'html.quote') {
    const payload = isRecord(anchor.anchorPayload) ? anchor.anchorPayload : {};
    const exact = text(payload.exact);

    return exact
      ? { kindLabel: '选中文本', detail: `“${exact}”` }
      : { kindLabel: '选中文本' };
  }

  if (anchor.anchorType === 'html.element') {
    const payload = isRecord(anchor.anchorPayload) ? anchor.anchorPayload : {};
    const id = text(payload.id);
    const tag = text(payload.tagName);
    const textQuote = text(payload.textQuote);
    const parts = [
      id ? `#${id}` : undefined,
      tag ? `<${tag}>` : undefined,
    ].filter((part): part is string => part !== undefined);

    return {
      kindLabel: '元素',
      detail: [parts.join(' '), textQuote ? `“${textQuote.slice(0, 40)}”` : undefined]
        .filter((part): part is string => part !== undefined)
        .join(' '),
    };
  }

  if (anchor.anchorType === 'html.link') {
    const payload = isRecord(anchor.anchorPayload) ? anchor.anchorPayload : {};
    const url = text(payload.url);

    return url
      ? { kindLabel: '链接', detail: url }
      : { kindLabel: '链接' };
  }

  return { kindLabel: '内容' };
}

export function AnchorChip({
  anchor,
  onRemove,
}: {
  readonly anchor: JsonValue;
  readonly onRemove?: () => void;
}) {
  const summary = summarizeHtmlAnchor(anchor);

  return (
    <div className="mx-3 mt-2.5 flex items-start gap-1.5 rounded-[10px] border border-indigo-300/20 bg-indigo-400/10 px-2.5 py-2 text-[10px] leading-5">
      <span className="shrink-0 font-semibold text-indigo-200">
        {summary.kindLabel}
      </span>
      {summary.detail && (
        <span className="min-w-0 break-all text-slate-400">{summary.detail}</span>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label="删除选中锚点"
          onClick={onRemove}
          className="ml-auto shrink-0 rounded-md px-1 text-slate-500 hover:bg-white/10 hover:text-slate-200"
        >
          ✕
        </button>
      )}
    </div>
  );
}
