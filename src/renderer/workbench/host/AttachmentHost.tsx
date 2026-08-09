import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';

import type { AssetAttachment } from '../../../shared/workbench/attachment';
import type { AssetTarget } from '../../../shared/workbench/anchor';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { AiMarkdownContent } from '../ai-chat/AiChatPanel';

export interface AttachmentHostProps {
  readonly attachments: readonly AssetAttachment[];
  /** 点击标注时回调，传递标注 ID */
  readonly onAttachmentClick?: (attachmentId: string) => void;
  /** 当前活跃的标注 ID */
  readonly activeAttachmentId?: string;
  readonly onDeleteAttachment?: (
    attachmentId: string,
  ) => Promise<void> | void;
}

interface AnchorPosition {
  readonly pageNumber: number;
  readonly offset?: number;
  readonly xRatio?: number;
  readonly yRatio?: number;
  readonly widthRatio?: number;
  readonly heightRatio?: number;
}

interface PageMarkerPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function extractPosition(target: AssetTarget): AnchorPosition | undefined {
  if (target.scope !== 'content') {
    return undefined;
  }

  const payload = target.anchorPayload as Record<string, unknown> | undefined;
  if (!payload) {
    return undefined;
  }

  const pageNumber =
    typeof payload.pageNumber === 'number'
      ? payload.pageNumber
      : typeof payload.start === 'object' && payload.start !== null
        ? (payload.start as Record<string, unknown>).pageNumber as number
        : undefined;

  if (typeof pageNumber !== 'number') {
    return undefined;
  }

  return {
    pageNumber,
    offset:
      typeof payload.start === 'object' && payload.start !== null
        ? ((payload.start as Record<string, unknown>).offset as number | undefined)
        : undefined,
    xRatio:
      typeof payload.x === 'number' && payload.x >= 0 && payload.x <= 1
        ? payload.x
        : undefined,
    yRatio:
      typeof payload.y === 'number' && payload.y >= 0 && payload.y <= 1
        ? payload.y
        : undefined,
    widthRatio:
      typeof payload.width === 'number' && payload.width >= 0 && payload.width <= 1
        ? payload.width
        : undefined,
    heightRatio:
      typeof payload.height === 'number' && payload.height >= 0 && payload.height <= 1
        ? payload.height
        : undefined,
  };
}

function extractQuote(target: AssetTarget): string | undefined {
  if (target.scope !== 'content') {
    return undefined;
  }

  const payload = target.anchorPayload as Record<string, unknown> | undefined;
  if (!payload) {
    return undefined;
  }

  if (
    payload.quote &&
    typeof payload.quote === 'object' &&
    typeof (payload.quote as Record<string, unknown>).exact === 'string'
  ) {
    return (payload.quote as Record<string, unknown>).exact as string;
  }

  if (Array.isArray(payload.ranges) && payload.ranges.length > 0) {
    const range = payload.ranges[0] as Record<string, unknown>;
    if (range && typeof range.exact === 'string') {
      return range.exact as string;
    }
  }

  return undefined;
}

function extractMetadataPreview(metadata: JsonValue): string {
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata)
  ) {
    const m = metadata as Record<string, unknown>;
    if (typeof m.selectedAnswer === 'string') {
      return m.selectedAnswer.slice(0, 60);
    }
    if (typeof m.question === 'string') {
      return m.question.slice(0, 60);
    }
    if (typeof m.text === 'string') {
      return m.text.slice(0, 60);
    }
    if (typeof m.label === 'string') {
      return m.label.slice(0, 60);
    }
  }
  return '';
}

function formatTypeLabel(typeId: string): string {
  if (typeId === 'ai.annotation') {
    return 'AI 标注';
  }
  return typeId;
}

interface AnnotationPopupProps {
  readonly attachment: AssetAttachment;
  readonly onClose: () => void;
  readonly onDelete?: () => Promise<void> | void;
}

function AnnotationPopup({
  attachment,
  onClose,
  onDelete,
}: AnnotationPopupProps) {
  const [deleting, setDeleting] = useState(false);
  const metadata = attachment.metadata as Record<string, unknown> | undefined;
  const question = metadata && typeof metadata.question === 'string' ? metadata.question : undefined;
  const answer = metadata && typeof metadata.answer === 'string' ? metadata.answer : undefined;
  const selectedAnswer =
    metadata && typeof metadata.selectedAnswer === 'string'
      ? metadata.selectedAnswer
      : undefined;

  return createPortal(
    <div
      className="pointer-events-auto fixed inset-0 z-[100] grid place-items-center bg-black/50 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[72vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#1e2430] shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.075] px-5 py-3.5">
          <span className="text-sm font-semibold text-slate-200">
            {formatTypeLabel(attachment.typeId)}详情
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {question && (
            <div className="mb-4">
              <span className="text-[11px] font-semibold text-slate-500">
                问题
              </span>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                {question}
              </p>
            </div>
          )}
          <div>
            <span className="text-[11px] font-semibold text-slate-500">
              附着内容
            </span>
            <div className="mt-1.5 break-words rounded-xl bg-black/15 p-3 text-sm leading-6 text-slate-200">
              <AiMarkdownContent content={selectedAnswer ?? answer ?? '无内容'} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-white/[0.075] px-5 py-3">
          <span className="text-[11px] text-slate-500">
            {selectedAnswer ? `${Array.from(selectedAnswer).length} 字` : ''}
          </span>
          {onDelete && (
          <button
            type="button"
            disabled={deleting}
            onClick={() => {
              if (!window.confirm('确定删除这条附着内容吗？')) {
                return;
              }
              setDeleting(true);
              void Promise.resolve(onDelete()).catch(() => {
                setDeleting(false);
              });
            }}
            className="rounded-lg border border-rose-400/20 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-400/10 disabled:opacity-50"
          >
            {deleting ? '正在删除…' : '删除附着'}
          </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function AttachmentHost({
  attachments,
  onAttachmentClick,
  activeAttachmentId,
  onDeleteAttachment,
}: AttachmentHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [activePopupId, setActivePopupId] = useState<string | null>(null);
  const [pagePositions, setPagePositions] = useState<
    ReadonlyMap<number, PageMarkerPosition>
  >(
    new Map(),
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const update = () => {
      const hostRect = host.getBoundingClientRect();
      const next = new Map<number, PageMarkerPosition>();
      for (const page of host.parentElement?.querySelectorAll<HTMLElement>(
        '.page[data-page-number]',
      ) ?? []) {
        const pageNumber = Number(page.dataset.pageNumber);
        if (Number.isSafeInteger(pageNumber) && pageNumber > 0) {
          const rect = page.getBoundingClientRect();
          next.set(pageNumber, {
            left: rect.left - hostRect.left,
            top: rect.top - hostRect.top,
            width: rect.width,
            height: rect.height,
          });
        }
      }
      setPagePositions(next);
    };

    update();
    const scrollContainer = host.parentElement?.querySelector<HTMLElement>(
      '.pdfViewer',
    )?.parentElement;
    scrollContainer?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = new MutationObserver(update);
    observer.observe(host.parentElement ?? host, { childList: true, subtree: true });
    return () => {
      scrollContainer?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, [attachments]);

  const handleMarkerClick = useCallback(
    (attachmentId: string, event: ReactMouseEvent) => {
      event.stopPropagation();
      setActivePopupId((prev) =>
        prev === attachmentId ? null : attachmentId,
      );
      onAttachmentClick?.(attachmentId);
    },
    [onAttachmentClick],
  );

  const handleClosePopup = useCallback(() => {
    setActivePopupId(null);
  }, []);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-20 overflow-visible">
      {/* We'll render markers as a layer. Each marker is a small clickable icon
          that shows the position. The actual rendering on the PDF pages is
          best done inside the PDF viewer itself, but this shows the UI model. */}
      {attachments.map((att) => {
        const pos = extractPosition(att.target);
        const pagePosition = pos?.pageNumber
          ? pagePositions.get(pos.pageNumber)
          : undefined;
        const quote = extractQuote(att.target);
        const preview = extractMetadataPreview(att.metadata);
        const isActive = att.id === activeAttachmentId;

        const left =
          (pagePosition?.left ?? 16) +
          (pos?.xRatio ?? 1) * (pagePosition?.width ?? 0);
        const top =
          (pagePosition?.top ?? 16) +
          (pos?.yRatio ?? 0) * (pagePosition?.height ?? 0);
        const width =
          (pos?.widthRatio ?? 0) * (pagePosition?.width ?? 0);
        const height =
          (pos?.heightRatio ?? 0) * (pagePosition?.height ?? 0);

        return (
          <button
            key={att.id}
            type="button"
            className={`pointer-events-auto absolute cursor-pointer border transition-all ${
              isActive
                ? 'z-40 border-indigo-300/90 bg-indigo-400/20'
                : 'z-30 border-indigo-400/45 bg-indigo-400/[0.08] hover:border-indigo-300/80 hover:bg-indigo-400/15'
            }`}
            style={{
              left,
              top,
              width: Math.max(width, 18),
              height: Math.max(height, 18),
            }}
            onClick={(e) => handleMarkerClick(att.id, e)}
            title={preview || quote || '标注'}
          >
            <span className="absolute -right-3 -top-3 grid size-6 place-items-center rounded-full border border-indigo-300/50 bg-[#242b3b] text-[11px] text-indigo-200 shadow-[0_4px_12px_rgba(0,0,0,.45)]">
              ✦
            </span>
          </button>
        );
      })}

      {activePopupId && (
        <AnnotationPopup
          attachment={
            attachments.find((a) => a.id === activePopupId) ??
            attachments[0]
          }
          onClose={handleClosePopup}
          onDelete={
            onDeleteAttachment
              ? async () => {
                  await onDeleteAttachment(activePopupId);
                  setActivePopupId(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
