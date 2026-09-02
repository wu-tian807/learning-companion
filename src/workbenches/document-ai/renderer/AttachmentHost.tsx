import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import type { AssetTarget } from '../../../shared/workbench/anchor';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { ConversationMarkdown } from '../../../renderer/conversation/conversation-markdown';
import {
  resolveWorkbenchAnchor,
  revealWorkbenchAnchor,
  WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT,
  type WorkbenchAnchorRect,
} from '../../../renderer/workbench/host/workbench-anchor-bridge';

export interface AttachmentHostProps {
  readonly attachments: readonly AssetAttachment[];
  readonly assetId: string;
  readonly projectId: string;
  /** 点击标注时回调，传递标注 ID */
  readonly onAttachmentClick?: (attachmentId: string) => void;
  /** 当前活跃的标注 ID */
  readonly activeAttachmentId?: string;
  readonly onDeleteAttachment?: (
    attachmentId: string,
  ) => Promise<void> | void;
  readonly sidebarOpen: boolean;
  readonly onSidebarOpenChange: (open: boolean) => void;
}

interface AnchorPosition {
  readonly pageNumber: number;
  readonly offset?: number;
  readonly xRatio?: number;
  readonly yRatio?: number;
  readonly widthRatio?: number;
  readonly heightRatio?: number;
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

/**
 * 文本选区批注（纯文本 / Markdown 的回归原文）没有 pageNumber，anchorPayload
 * 携带 ranges。这类批注在工作台里用 Word 评论式的小标记展示，点击才展开悬浮回复。
 */
function isTextAnchoredAttachment(attachment: AssetAttachment): boolean {
  if (attachment.target.scope !== 'content') return false;
  const payload = attachment.target.anchorPayload as
    | Record<string, unknown>
    | undefined;
  if (Array.isArray(payload?.ranges) && payload.ranges.length > 0) {
    return true;
  }
  return extractPosition(attachment.target) === undefined;
}

function markerVisibilityStorageKey(
  projectId: string,
  assetId: string,
): string {
  return `learning-companion:attachment-markers-visible:v1:${projectId}:${assetId}`;
}

function extractMetadataPreview(metadata: JsonValue): string {
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata)
  ) {
    const m = metadata as Record<string, unknown>;
    if (typeof m.questionPreview === 'string') {
      return m.questionPreview.slice(0, 60);
    }
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

function attachmentAnchorKey(attachment: AssetAttachment): string {
  const position = extractPosition(attachment.target);
  if (!position) return attachment.id;
  const round = (value: number | undefined) =>
    value === undefined ? '-' : value.toFixed(3);
  return [
    position.pageNumber,
    round(position.xRatio),
    round(position.yRatio),
    round(position.widthRatio),
    round(position.heightRatio),
  ].join(':');
}

function formatTypeLabel(typeId: string): string {
  if (typeId === 'ai.annotation') {
    return 'AI 标注';
  }
  return typeId;
}

function extractAnswerBody(body: JsonValue | undefined): {
  readonly answer?: string;
  readonly selectedAnswer?: string;
} {
  if (
    body === undefined ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    return {};
  }
  const record = body as Record<string, unknown>;
  return {
    ...(typeof record.answer === 'string'
      ? { answer: record.answer }
      : {}),
    ...(typeof record.selectedAnswer === 'string'
      ? { selectedAnswer: record.selectedAnswer }
      : {}),
  };
}

function placeAnswerCard(
  rect: WorkbenchAnchorRect,
  hostSize: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } {
  const cardWidth = 300;
  const cardHeight = 220;
  const margin = 8;
  const left = Math.max(
    margin,
    Math.min(
      rect.left,
      Math.max(margin, hostSize.width - cardWidth - margin),
    ),
  );
  let top = rect.top + rect.height + margin;
  if (top + cardHeight > hostSize.height - margin) {
    top = Math.max(margin, rect.top - cardHeight - margin);
  }
  return { left, top };
}

interface AnnotationPopupProps {
  readonly attachment: AssetAttachment;
  readonly body?: JsonValue;
  readonly onClose: () => void;
  readonly onDelete?: () => Promise<void> | void;
}

function AnnotationPopup({
  attachment,
  body,
  onClose,
  onDelete,
}: AnnotationPopupProps) {
  const [deleting, setDeleting] = useState(false);
  const metadata = (body ?? attachment.metadata) as Record<string, unknown> | undefined;
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
              <ConversationMarkdown text={selectedAnswer ?? answer ?? '无内容'} />
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

function ReplyCard({
  attachedText,
  pageNumber,
  position,
  onView,
  onClose,
}: {
  readonly attachedText: string;
  readonly pageNumber?: number;
  readonly position: { readonly left: number; readonly top: number };
  readonly onView: () => void;
  readonly onClose: () => void;
}) {
  return (
    <aside
      className="pointer-events-auto absolute z-50 w-[300px] overflow-hidden rounded-xl border border-indigo-400/45 bg-[#1b212b]/[0.97] shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur"
      style={{
        left: position.left,
        top: position.top,
      }}
    >
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-3 py-2">
        <span className="text-[10px] font-semibold text-indigo-300">
          AI 回复
        </span>
        {pageNumber !== undefined && (
          <span className="text-[9px] text-slate-500">第 {pageNumber} 页</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onView}
            className="rounded-md px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
          >
            查看
          </button>
          <button
            type="button"
            aria-label="收起 AI 回复"
            onClick={onClose}
            className="grid size-5 place-items-center rounded-md text-[11px] text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
          >
            ×
          </button>
        </span>
      </div>
      <div className="max-h-[200px] overflow-y-auto px-3 py-2.5 text-xs leading-6 text-slate-200">
        <ConversationMarkdown text={attachedText} />
      </div>
    </aside>
  );
}

export function AttachmentHost({
  attachments,
  assetId,
  projectId,
  onAttachmentClick,
  activeAttachmentId,
  onDeleteAttachment,
  sidebarOpen,
  onSidebarOpenChange,
}: AttachmentHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [activePopupId, setActivePopupId] = useState<string | null>(null);
  const [activeBody, setActiveBody] = useState<JsonValue>();
  const [focusedAttachmentId, setFocusedAttachmentId] = useState<string | null>(null);
  const focusTimerRef = useRef<number | undefined>(undefined);
  const [anchorRects, setAnchorRects] = useState<
    ReadonlyMap<string, WorkbenchAnchorRect>
  >(
    new Map(),
  );
  const [bodies, setBodies] = useState<ReadonlyMap<string, JsonValue>>(
    new Map(),
  );
  const [collapsedAttachmentIds, setCollapsedAttachmentIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [hostSize, setHostSize] = useState<{
    readonly width: number;
    readonly height: number;
  }>({ width: 0, height: 0 });
  const knownAttachmentIdsRef = useRef(new Set<string>());
  const [markersVisible, setMarkersVisible] = useState(() => {
    try {
      return (
        window.localStorage.getItem(
          markerVisibilityStorageKey(projectId, assetId),
        ) !== '0'
      );
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (attachments.length === 0) return;
    setCollapsedAttachmentIds((current) => {
      const known = knownAttachmentIdsRef.current;
      const next = new Set(current);
      let changed = false;
      for (const attachment of attachments) {
        if (!known.has(attachment.id)) {
          known.add(attachment.id);
          if (isTextAnchoredAttachment(attachment)) {
            next.add(attachment.id);
            changed = true;
          }
        }
      }
      return changed ? next : current;
    });
  }, [attachments]);

  const toggleMarkersVisible = useCallback(() => {
    setMarkersVisible((visible) => {
      const next = !visible;
      try {
        window.localStorage.setItem(
          markerVisibilityStorageKey(projectId, assetId),
          next ? '1' : '0',
        );
      } catch {
        // 存储不可用时仅在本次会话生效。
      }
      return next;
    });
  }, [assetId, projectId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const update = () => {
      const next = new Map<string, WorkbenchAnchorRect>();
      const hostRect = host.getBoundingClientRect();
      setHostSize({ width: hostRect.width, height: hostRect.height });
      for (const attachment of attachments) {
        const rect = resolveWorkbenchAnchor(assetId, attachment.target);
        if (rect) {
          next.set(attachment.id, {
            ...rect,
            left: rect.left - hostRect.left,
            top: rect.top - hostRect.top,
          });
        }
      }
      setAnchorRects(next);
    };

    update();
    window.addEventListener(WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT, update);
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, {
      capture: true,
      passive: true,
    });
    const observedContainer = host.parentElement ?? host;
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(observedContainer, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(observedContainer);
    return () => {
      window.removeEventListener(WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT, update);
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, {
        capture: true,
      });
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [assetId, attachments]);

  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, JsonValue>();
    void Promise.all(
      attachments.map(async (attachment) => {
        try {
          const body = await window.learningCompanion.readAttachmentContent({
            projectId,
            attachmentId: attachment.id,
          });
          if (!cancelled) next.set(attachment.id, body);
        } catch {
          // 读取失败时仅省略卡片，不影响标注定位。
        }
      }),
    ).then(() => {
      if (!cancelled) setBodies(next);
    });
    return () => {
      cancelled = true;
    };
  }, [attachments, projectId]);

  const handleMarkerClick = useCallback(
    (attachmentId: string, event: ReactMouseEvent) => {
      event.stopPropagation();
      setCollapsedAttachmentIds((current) => {
        if (!current.has(attachmentId)) {
          const next = new Set(current);
          next.add(attachmentId);
          return next;
        }
        const next = new Set(current);
        next.delete(attachmentId);
        return next;
      });
      onAttachmentClick?.(attachmentId);
    },
    [onAttachmentClick],
  );

  const handleClosePopup = useCallback(() => {
    setActivePopupId(null);
    setActiveBody(undefined);
  }, []);

  useEffect(() => {
    if (!activePopupId) return;
    let cancelled = false;
    void window.learningCompanion.readAttachmentContent({
      projectId,
      attachmentId: activePopupId,
    }).then((body) => {
      if (!cancelled) setActiveBody(body);
    }).catch(() => {
      if (!cancelled) setActiveBody(undefined);
    });
    return () => { cancelled = true; };
  }, [activePopupId, projectId]);

  useEffect(
    () => () => {
      if (focusTimerRef.current !== undefined) {
        window.clearTimeout(focusTimerRef.current);
      }
    },
    [],
  );

  const markerGroups = useMemo(() => {
    const groups = new Map<string, AssetAttachment[]>();
    for (const attachment of attachments) {
      const key = attachmentAnchorKey(attachment);
      const group = groups.get(key) ?? [];
      group.push(attachment);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [attachments]);

  const revealAttachment = useCallback((attachment: AssetAttachment) => {
    void revealWorkbenchAnchor(assetId, attachment.target).catch(() => undefined);
    setFocusedAttachmentId(attachment.id);
    onSidebarOpenChange(false);
    if (focusTimerRef.current !== undefined) {
      window.clearTimeout(focusTimerRef.current);
    }
    focusTimerRef.current = window.setTimeout(
      () => setFocusedAttachmentId(null),
      1800,
    );
  }, [assetId, onSidebarOpenChange]);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-20 overflow-visible">
      {markersVisible && markerGroups.map((group) => {
        const att = group.at(-1)!;
        const anchorRect = anchorRects.get(att.id);
        const position = extractPosition(att.target);
        const quote = extractQuote(att.target);
        const preview = extractMetadataPreview(att.metadata);
        const textAnchored = isTextAnchoredAttachment(att);
        const cardOpen = !collapsedAttachmentIds.has(att.id);
        const isActive =
          group.some((item) => item.id === activeAttachmentId) ||
          group.some((item) => item.id === focusedAttachmentId) ||
          (textAnchored && cardOpen);

        if (!anchorRect) return null;

        const body = bodies.get(att.id);
        const { answer, selectedAnswer } = extractAnswerBody(body);
        const attachedText = selectedAnswer ?? answer;
        const viewAttachment = () => {
          setActivePopupId(att.id);
          onAttachmentClick?.(att.id);
        };

        if (textAnchored) {
          const markerSize = 22;
          const markerLeft = anchorRect.left + anchorRect.width;
          const markerTop = anchorRect.top + anchorRect.height / 2;
          const cardPosition = placeAnswerCard(
            {
              left: markerLeft,
              top: anchorRect.top,
              width: 0,
              height: anchorRect.height,
            },
            hostSize,
          );
          return (
            <div key={att.id} className="contents">
              <button
                type="button"
                aria-label={cardOpen ? '收起 AI 回复' : '查看 AI 回复'}
                title={preview || quote || '查看 AI 回复'}
                className={`pointer-events-auto absolute z-30 grid cursor-pointer place-items-center rounded-full border transition-all ${
                  isActive
                    ? 'border-indigo-200 bg-indigo-400/60 text-white shadow-[0_0_0_3px_rgba(129,140,248,0.35)]'
                    : 'border-indigo-300/60 bg-[#2a3248] text-indigo-100 hover:border-indigo-300 hover:bg-indigo-400/30'
                }`}
                style={{
                  left: markerLeft + 2,
                  top: markerTop - markerSize / 2,
                  width: markerSize,
                  height: markerSize,
                }}
                onClick={(event) => handleMarkerClick(att.id, event)}
              >
                {group.length > 1 ? group.length : '✦'}
              </button>
              {cardPosition && attachedText && cardOpen && (
                <ReplyCard
                  attachedText={attachedText}
                  position={cardPosition}
                  onView={viewAttachment}
                  onClose={() =>
                    setCollapsedAttachmentIds((current) =>
                      new Set(current).add(att.id),
                    )
                  }
                />
              )}
            </div>
          );
        }

        const left = anchorRect.left;
        const top = anchorRect.top;
        const width = Math.max(anchorRect.width, 18);
        const height = Math.max(anchorRect.height, 18);
        const cardPosition = placeAnswerCard(anchorRect, hostSize);

        return (
          <div key={att.id} className="contents">
            <button
              type="button"
              className={`pointer-events-auto absolute cursor-pointer border transition-all ${
                isActive
                  ? 'z-40 animate-pulse border-indigo-200 bg-indigo-400/30 ring-2 ring-indigo-300/50'
                  : 'z-30 border-indigo-400/45 bg-indigo-400/[0.08] hover:border-indigo-300/80 hover:bg-indigo-400/15'
              }`}
              style={{ left, top, width, height }}
              onClick={(event) => handleMarkerClick(att.id, event)}
              title={preview || quote || '标注'}
            >
              <span className="absolute -right-3 -top-3 grid size-6 place-items-center rounded-full border border-indigo-300/50 bg-[#242b3b] text-[11px] text-indigo-200 shadow-[0_4px_12px_rgba(0,0,0,.45)]">
                {group.length > 1 ? group.length : '✦'}
              </span>
            </button>
            {cardPosition && attachedText && cardOpen && (
              <ReplyCard
                attachedText={attachedText}
                pageNumber={position?.pageNumber}
                position={cardPosition}
                onView={viewAttachment}
                onClose={() =>
                  setCollapsedAttachmentIds((current) =>
                    new Set(current).add(att.id),
                  )
                }
              />
            )}
          </div>
        );
      })}

      <button
        type="button"
        aria-pressed={markersVisible}
        aria-label={markersVisible ? '隐藏原文批注标记' : '显示原文批注标记'}
        title={markersVisible ? '隐藏原文批注标记' : '显示原文批注标记'}
        onClick={toggleMarkersVisible}
        className={`pointer-events-auto absolute bottom-9 right-2 z-[70] flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] shadow-[0_6px_18px_rgba(0,0,0,0.4)] backdrop-blur transition ${
          markersVisible
            ? 'border-indigo-300/30 bg-[#242b3b]/95 text-indigo-200 hover:bg-indigo-400/15'
            : 'border-white/10 bg-[#242b3b]/95 text-slate-500 hover:text-slate-300'
        }`}
      >
        <span aria-hidden="true">{markersVisible ? '✦' : '✧'}</span>
        <span>
          {markersVisible
            ? `批注 ${attachments.length}`
            : '批注已隐藏'}
        </span>
      </button>

      {markersVisible && sidebarOpen && (
            <aside className="pointer-events-auto absolute bottom-4 right-3 top-24 z-[70] flex w-80 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1b212b]/98 shadow-[0_24px_70px_rgba(0,0,0,.6)] backdrop-blur">
              <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">文档标注</h3>
                  <p className="mt-0.5 text-[10px] text-slate-500">点击定位到原文选区</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSidebarOpenChange(false)}
                  className="rounded-lg px-2 py-1 text-slate-500 hover:bg-white/5 hover:text-slate-200"
                >
                  ×
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {attachments.map((attachment) => {
                  const position = extractPosition(attachment.target);
                  const preview = extractMetadataPreview(attachment.metadata) || '无内容摘要';
                  return (
                    <div
                      key={attachment.id}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 hover:border-indigo-300/25"
                    >
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 rounded-md bg-indigo-400/10 px-1.5 py-0.5 text-[10px] text-indigo-300">
                          第 {position?.pageNumber ?? 1} 页
                        </span>
                        <p className="line-clamp-3 min-w-0 flex-1 text-xs leading-5 text-slate-300">
                          {preview}
                        </p>
                      </div>
                      <div className="mt-2 flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => revealAttachment(attachment)}
                          className="rounded-lg px-2 py-1 text-[10px] text-indigo-300 hover:bg-indigo-400/10"
                        >
                          定位
                        </button>
                        <button
                          type="button"
                          onClick={() => setActivePopupId(attachment.id)}
                          className="rounded-lg bg-white/[0.06] px-2 py-1 text-[10px] text-slate-300 hover:bg-white/[0.1]"
                        >
                          查看
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          )}

      {markersVisible && activePopupId && (
        <AnnotationPopup
          body={activeBody}
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
