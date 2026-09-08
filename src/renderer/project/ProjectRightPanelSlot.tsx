import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import type { ProjectRightPanelKind } from './use-project-layout';

export function ProjectRightPanelSlot({
  panel,
  inline,
  generation,
  conversation,
  learningNote,
}: {
  readonly panel: ProjectRightPanelKind | null;
  readonly inline: boolean;
  readonly generation: ReactNode;
  readonly conversation: ReactNode;
  readonly learningNote: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | undefined>(undefined);
  const [learningNoteWidth, setLearningNoteWidth] = useState(390);
  const [previewWidth, setPreviewWidth] = useState<number>();
  const [dragging, setDragging] = useState(false);

  const widthBounds = useCallback(() => {
    const host = hostRef.current;
    const minimum = 318;
    if (!host) return { minimum, maximum: 720 };
    const parentWidth = host.parentElement?.getBoundingClientRect().width ?? 0;
    if (!inline) {
      return {
        minimum,
        maximum: Math.max(minimum, Math.min(720, parentWidth - 20)),
      };
    }
    const workbench = host.previousElementSibling as HTMLElement | null;
    const workbenchWidth = workbench?.getBoundingClientRect().width ?? 0;
    const currentWidth = host.getBoundingClientRect().width;
    return {
      minimum,
      maximum: Math.max(
        minimum,
        Math.min(720, currentWidth + Math.max(0, workbenchWidth - 420)),
      ),
    };
  }, [inline]);

  const resizeByKeyboard = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const { minimum, maximum } = widthBounds();
    let next: number | undefined;
    if (event.key === 'ArrowLeft') next = learningNoteWidth + 24;
    if (event.key === 'ArrowRight') next = learningNoteWidth - 24;
    if (event.key === 'Home') next = minimum;
    if (event.key === 'End') next = maximum;
    if (next === undefined) return;
    event.preventDefault();
    setLearningNoteWidth(Math.min(maximum, Math.max(minimum, next)));
  }, [learningNoteWidth, widthBounds]);

  const beginResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragCleanupRef.current?.();
    const { minimum, maximum } = widthBounds();
    const startX = event.clientX;
    const startWidth = hostRef.current?.getBoundingClientRect().width ??
      learningNoteWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    let latestWidth = startWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setPreviewWidth(startWidth);
    setDragging(true);

    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = startWidth + startX - moveEvent.clientX;
      latestWidth = Math.min(maximum, Math.max(minimum, next));
      setPreviewWidth(latestWidth);
    };
    const finish = () => cleanup(true);
    const cancel = () => cleanup(false);
    const cleanup = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', finish);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      dragCleanupRef.current = undefined;
      if (commit) setLearningNoteWidth(latestWidth);
      setPreviewWidth(undefined);
      setDragging(false);
    };
    dragCleanupRef.current = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', cancel, { once: true });
    window.addEventListener('blur', finish, { once: true });
  }, [learningNoteWidth, widthBounds]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  if (!panel) return null;

  const learningNoteResizable = panel === 'learning-note';
  const visibleLearningNoteWidth = previewWidth ?? learningNoteWidth;

  return (
    <div
      ref={hostRef}
      id="project-right-panel"
      data-project-right-panel={panel}
      data-resizing={dragging || undefined}
      style={learningNoteResizable ? { width: learningNoteWidth } : undefined}
      className={
        inline
          ? learningNoteResizable
            ? 'relative h-full min-h-0 min-w-[318px] max-w-[720px] shrink-0'
            : 'h-full min-h-0 w-[clamp(318px,20vw,390px)] min-w-0 shrink-0'
          : learningNoteResizable
            ? 'absolute inset-y-0 right-0 z-30 h-full min-h-0 min-w-[318px] max-w-[min(720px,calc(100%-20px))] shadow-2xl'
            : 'absolute inset-y-0 right-0 z-30 h-full min-h-0 w-[min(390px,calc(100%-20px))] min-w-0 shadow-2xl'
      }
    >
      <div
        data-learning-note-resize-preview={dragging || undefined}
        style={
          learningNoteResizable && dragging
            ? { width: visibleLearningNoteWidth }
            : undefined
        }
        className={
          learningNoteResizable && dragging
            ? 'absolute inset-y-0 right-0 h-full'
            : 'h-full w-full'
        }
      >
        {learningNoteResizable && (
          <div
            role="separator"
            aria-label="调整学习笔记宽度"
            aria-orientation="vertical"
            aria-valuemin={318}
            aria-valuemax={720}
            aria-valuenow={Math.round(visibleLearningNoteWidth)}
            data-resizing={dragging || undefined}
            tabIndex={0}
            onPointerDown={beginResize}
            onKeyDown={resizeByKeyboard}
            className="group absolute inset-y-2 -left-1.5 z-40 w-3 cursor-col-resize touch-none outline-none"
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-indigo-300/70 group-focus:bg-indigo-300/80 group-data-[resizing=true]:bg-indigo-300" />
          </div>
        )}
        <div
          className={panel === 'conversation' ? 'h-full min-h-0' : 'hidden'}
          aria-hidden={panel !== 'conversation'}
        >
          {conversation}
        </div>
        <div
          className={panel === 'generation' ? 'h-full min-h-0' : 'hidden'}
          aria-hidden={panel !== 'generation'}
        >
          {generation}
        </div>
        <div
          className={panel === 'learning-note' ? 'h-full min-h-0' : 'hidden'}
          aria-hidden={panel !== 'learning-note'}
        >
          {learningNote}
        </div>
      </div>
    </div>
  );
}
