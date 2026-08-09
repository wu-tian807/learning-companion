/**
 * Floating "解释选中内容" bar shown after a text selection in the HTML
 * document. Positioned below the selection rect (viewport coordinates),
 * fixed so it stays put while the document scrolls. Dismissed when a
 * mousedown lands outside it.
 */
import { useEffect, useRef, useState } from 'react';

export interface SelectionFloatBarProps {
  readonly text: string;
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly onExplain: (text: string) => void;
  readonly onDismiss: () => void;
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
    const update = () => {
      setPosition({
        left: rect.left + 10,
        top: rect.bottom + 8,
      });
    };
    update();
    // 保持与当前选区视觉对齐（选区滚动后通常已被清除，此处理论上无变化）
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [rect.left, rect.bottom]);

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

  const snippet =
    text.length > 18 ? `${text.slice(0, 18)}…` : text;

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
        解释选中内容
      </button>
    </div>
  );
}
