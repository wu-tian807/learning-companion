/**
 * Transient red-outline highlight for the HTML element captured on
 * right-click.
 *
 * The element's rect is captured by the main-side probe script inside the
 * sandbox frame (`getBoundingClientRect` in frame coordinates). The renderer
 * cannot reach into the frame's DOM, so this component positions a fixed
 * overlay box using the frame rect offset by the iframe's viewport position.
 * Scroll tracking is handled by re-reading the iframe element's rect on
 * scroll (no frame access needed).
 */
import { useEffect, useRef, useState } from 'react';

export interface AnchorHighlightTarget {
  readonly anchorType?: string;
  readonly anchorPayload?: {
    readonly rect?: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    readonly id?: string;
    readonly tagName?: string;
  };
}

export interface AnchorHighlightProps {
  readonly target: AnchorHighlightTarget | undefined;
  /** 0 = 持久显示（当前对话期间常驻），否则为显示毫秒数。 */
  readonly durationMs?: number;
}

interface FrameOffset {
  readonly x: number;
  readonly y: number;
}

function readFrameOffset(): FrameOffset {
  // The document iframe is the only child frame of the workbench area.
  const frame = document.querySelector('iframe[src^="learning-content://"]');
  const rect = frame?.getBoundingClientRect();
  return rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 };
}

export function AnchorHighlight({
  target,
  durationMs = 2_800,
}: AnchorHighlightProps) {
  const [box, setBox] = useState<
    | { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
    | undefined
  >();
  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState<string>();
  const timerRef = useRef<number | undefined>(undefined);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const payload = target?.anchorPayload;
    const rect = payload?.rect;

    if (!rect || rect.width === 0 || rect.height === 0) {
      setVisible(false);
      setBox(undefined);
      return;
    }

    const update = () => {
      const offset = readFrameOffset();
      setBox({
        x: offset.x + rect.x,
        y: offset.y + rect.y,
        width: rect.width,
        height: rect.height,
      });
      setVisible(true);
    };

    update();
    const doc = document.getElementById('doc');
    doc?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    const id = payload.id;
    const tag = payload.tagName;
    setLabel(id ? `#${id}` : tag ? `<${tag}>` : undefined);

    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
    }
    if (durationMs > 0) {
      timerRef.current = window.setTimeout(() => {
        setVisible(false);
      }, durationMs);
    } else {
      // 持久模式：不自动消失，由调用方在切出对话时清除。
      timerRef.current = undefined;
    }

    return () => {
      doc?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, [target, durationMs]);

  if (!visible || !box) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed z-[44] rounded-[4px] border-[1.5px] border-red-400/90 shadow-[0_0_0_2px_rgba(255,90,90,0.12),inset_0_0_18px_rgba(255,90,90,0.35)]"
      style={{
        left: `${box.x - 2}px`,
        top: `${box.y - 2}px`,
        width: `${box.width + 4}px`,
        height: `${box.height + 4}px`,
      }}
      aria-hidden="true"
    >
      {label && (
        <span className="absolute -top-4 left-0 rounded-[4px] bg-red-500/90 px-1.5 py-px font-mono text-[9px] text-red-50 whitespace-nowrap">
          {label}
        </span>
      )}
    </div>
  );
}
