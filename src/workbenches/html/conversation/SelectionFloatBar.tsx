/**
 * Floating "引用选中内容" bar shown after a text selection in the HTML
 * document.
 *
 * The selection rect is captured by the main-side probe inside the sandbox
 * frame (frame coordinates); the renderer cannot reach into the frame, so
 * this component positions itself at `iframe viewport offset + frame rect`
 * — the same approach as AnchorHighlight. Position updates on scroll by
 * re-reading the iframe element's rect.
 */
import { useEffect, useRef, useState } from 'react';

export interface SelectionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SelectionFloatBarProps {
  readonly text: string;
  readonly rect?: SelectionRect;
  readonly onExplain: (text: string) => void;
  readonly onDismiss: () => void;
}

function readFrameOffset(): { x: number; y: number } {
  const frame = document.querySelector('iframe[src^="learning-content://"]');
  const r = frame?.getBoundingClientRect();
  return r ? { x: r.left, y: r.top } : { x: 0, y: 0 };
}

export function SelectionFloatBar({
  text,
  rect,
  onExplain,
  onDismiss,
}: SelectionFloatBarProps) {
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rect) {
      // 无 rect（历史事件）时退化为文档区顶部
      setPosition({ left: 24, top: 64 });
      return;
    }

    const update = () => {
      const offset = readFrameOffset();
      setPosition({
        left: offset.x + rect.x + 10,
        top: offset.y + rect.y + rect.height + 8,
      });
    };
    update();
    const doc = document.getElementById('doc');
    doc?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      doc?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [rect]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onDismiss]);

  if (!position) {
    return null;
  }

  const snippet = text.length > 18 ? `${text.slice(0, 18)}…` : text;

  return (
    <div
      ref={ref}
      className="fixed z-[42] flex items-center gap-2 rounded-full border border-white/10 bg-[#252b34] py-1.5 pl-3 pr-1.5 text-[10px] text-slate-400 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
      style={{ left: position.left, top: position.top }}
      role="toolbar"
      aria-label="选中内容操作"
    >
      <span className="max-w-[180px] truncate text-slate-500">
        {snippet}
      </span>
      <button
        type="button"
        onClick={() => onExplain(text)}
        className="rounded-full border border-indigo-300/25 bg-indigo-400/15 px-2.5 py-1 text-[10px] font-semibold text-indigo-200 hover:bg-indigo-400/25"
      >
        引用选中内容
      </button>
    </div>
  );
}
