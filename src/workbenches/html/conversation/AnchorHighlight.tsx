/**
 * Transient red-outline highlight for the HTML element captured on
 * right-click. Positioned with `position: fixed` from the element's
 * `getBoundingClientRect`, so it tracks document scrolling without any
 * frame access.
 */
import { useEffect, useRef, useState } from 'react';

export interface AnchorHighlightProps {
  readonly target: {
    readonly anchorType?: string;
    readonly anchorPayload?: unknown;
  } | undefined;
  readonly durationMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function elementFromAnchor(payload: unknown): HTMLElement | undefined {
  if (typeof document === 'undefined' || !isRecord(payload)) {
    return undefined;
  }
  const id = payload.id;
  if (typeof id === 'string' && id.trim().length > 0) {
    const candidate = document.getElementById(id.trim());
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

export function AnchorHighlight({
  target,
  durationMs = 2_800,
}: AnchorHighlightProps) {
  const [rect, setRect] = useState<DOMRect>();
  const [visible, setVisible] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const onScrollRef = useRef<() => void>(() => undefined);

  const element = target && isRecord(target.anchorPayload)
    ? elementFromAnchor(target.anchorPayload)
    : undefined;

  useEffect(() => {
    if (!element) {
      setVisible(false);
      setRect(undefined);
      return;
    }

    const update = () => {
      const next = element.getBoundingClientRect();
      if (next.width === 0 && next.height === 0) {
        setVisible(false);
        return;
      }
      setRect(next);
      setVisible(true);
    };

    update();
    onScrollRef.current = update;
    const doc = document.getElementById('doc');
    doc?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setVisible(false);
    }, durationMs);

    return () => {
      doc?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, [element, durationMs]);

  useEffect(() => {
    if (visible && rect && boxRef.current) {
      boxRef.current.style.left = `${rect.left - 2}px`;
      boxRef.current.style.top = `${rect.top - 2}px`;
      boxRef.current.style.width = `${rect.width + 4}px`;
      boxRef.current.style.height = `${rect.height + 4}px`;
    }
  }, [visible, rect]);

  if (!visible || !rect || !element) {
    return null;
  }

  return (
    <div
      ref={boxRef}
      className="pointer-events-none fixed z-[44] rounded-[4px] border-[1.5px] border-red-400/90 shadow-[0_0_0_2px_rgba(255,90,90,0.12),inset_0_0_18px_rgba(255,90,90,0.35)]"
      aria-hidden="true"
    >
      <span
        className="absolute -top-4 left-0 rounded-[4px] bg-red-500/90 px-1.5 py-px font-mono text-[9px] text-red-50 whitespace-nowrap"
      >
        {element.id ? `#${element.id}` : `<${element.tagName.toLowerCase()}>`}
      </span>
    </div>
  );
}
