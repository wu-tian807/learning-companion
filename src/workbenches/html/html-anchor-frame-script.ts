import type {
  HtmlAnchorClearCommandPayload,
  HtmlAnchorHighlightCommandPayload,
} from './anchor-commands';

interface FrameAnchorCommand {
  readonly action: 'highlight' | 'clear';
  readonly target?: unknown;
  readonly revision: number;
  readonly reveal?: boolean;
  readonly durationMs?: number;
}

/**
 * Runs inside the sandboxed HTML document. It owns both anchor resolution and
 * the red outline, so the outline shares the document's own scroll/reflow
 * lifecycle instead of relying on stale cross-frame viewport coordinates.
 */
async function runHtmlAnchorFrameCommand(input: FrameAnchorCommand) {
  const stateKey = '__learningCompanionHtmlAnchorHighlightV1';
  const root = globalThis as unknown as Record<string, unknown>;
  type RuntimeState = {
    readonly revision: number;
    cleanup(): void;
  };
  const current = root[stateKey] as RuntimeState | undefined;

  if (input.action === 'clear') {
    if (current && input.revision >= current.revision) {
      current.cleanup();
    }
    return { found: false };
  }

  if (current && current.revision > input.revision) {
    return { found: false };
  }
  current?.cleanup();

  let disposed = false;
  const visual: {
    overlay?: HTMLDivElement;
    mutationObserver?: MutationObserver;
  } = {};
  let resizeObserver: ResizeObserver | undefined;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let animationFrame: number | undefined;
  const scrollTarget = document;
  const state: RuntimeState = {
    revision: input.revision,
    cleanup() {
      if (disposed) {
        return;
      }
      disposed = true;
      scrollTarget.removeEventListener('scroll', scheduleUpdate, true);
      globalThis.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
      visual.mutationObserver?.disconnect();
      if (timer !== undefined) {
        globalThis.clearTimeout(timer);
      }
      if (animationFrame !== undefined) {
        globalThis.cancelAnimationFrame(animationFrame);
      }
      visual.overlay?.remove();
      if (root[stateKey] === state) {
        delete root[stateKey];
      }
    },
  };
  root[stateKey] = state;

  const record =
    typeof input.target === 'object' && input.target !== null
      ? (input.target as Record<string, unknown>)
      : undefined;
  const payload =
    record &&
    typeof record.anchorPayload === 'object' &&
    record.anchorPayload !== null
      ? (record.anchorPayload as Record<string, unknown>)
      : undefined;

  function normalizedText(value: unknown): string {
    return typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim()
      : '';
  }

  function elementFromDomPath(path: unknown): Element | undefined {
    if (!Array.isArray(path)) {
      return undefined;
    }
    let element: Element = document.documentElement;
    for (const index of path) {
      if (!Number.isSafeInteger(index) || Number(index) < 0) {
        return undefined;
      }
      const child = element.children.item(Number(index));
      if (!child) {
        return undefined;
      }
      element = child;
    }
    return element;
  }

  function matchesElement(element: Element | undefined): element is Element {
    if (!element || !payload) {
      return false;
    }
    const tagName = normalizedText(payload.tagName).toLowerCase();
    return !tagName || element.tagName.toLowerCase() === tagName;
  }

  function resolveElement(): Element | undefined {
    if (!payload) {
      return undefined;
    }
    const id = normalizedText(payload.id);
    const byId = id ? document.getElementById(id) ?? undefined : undefined;
    if (matchesElement(byId)) {
      return byId;
    }
    const byPath = elementFromDomPath(payload.domPath);
    if (matchesElement(byPath)) {
      return byPath;
    }

    const tagName = normalizedText(payload.tagName).toLowerCase();
    const textQuote = normalizedText(payload.textQuote);
    const ariaLabel = normalizedText(payload.ariaLabel);
    if (!tagName) {
      return undefined;
    }
    return Array.from(document.querySelectorAll(tagName)).find((candidate) => {
      const candidateText = normalizedText(
        'innerText' in candidate
          ? (candidate as HTMLElement).innerText
          : candidate.textContent,
      );
      return (
        (!textQuote || candidateText.includes(textQuote)) &&
        (!ariaLabel ||
          normalizedText(candidate.getAttribute('aria-label')) === ariaLabel)
      );
    });
  }

  function resolveLink(): Element | undefined {
    const url = normalizedText(payload?.url);
    if (!url) {
      return undefined;
    }
    return Array.from(document.querySelectorAll('a[href]')).find(
      (candidate) => (candidate as HTMLAnchorElement).href === url,
    );
  }

  function resolveQuote(): Range | undefined {
    const exact = normalizedText(payload?.exact);
    if (!exact || !document.body) {
      return undefined;
    }
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const characters: Array<{ readonly node: Text; readonly offset: number }> = [];
    let indexedText = '';
    let previousWhitespace = false;
    let node: Node | null;

    while ((node = walker.nextNode())) {
      const textNode = node as Text;
      const value = textNode.data;
      for (let offset = 0; offset < value.length; offset += 1) {
        const character = value[offset];
        const whitespace = /\s/.test(character);
        if (whitespace && previousWhitespace) {
          continue;
        }
        indexedText += whitespace ? ' ' : character;
        characters.push({ node: textNode, offset });
        previousWhitespace = whitespace;
      }
    }

    const startIndex = indexedText.indexOf(exact);
    if (startIndex < 0 || characters.length === 0) {
      return undefined;
    }
    const endIndex = startIndex + exact.length - 1;
    const start = characters[startIndex];
    const end = characters[endIndex];
    if (!start || !end) {
      return undefined;
    }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, Math.min(end.node.length, end.offset + 1));
    return range;
  }

  const resolved: Element | Range | undefined =
    record?.anchorType === 'html.element'
      ? resolveElement()
      : record?.anchorType === 'html.quote'
        ? resolveQuote()
        : record?.anchorType === 'html.link'
          ? resolveLink()
          : undefined;

  if (!resolved) {
    state.cleanup();
    return { found: false };
  }
  const anchor = resolved;

  const observedElement =
    anchor instanceof Range
      ? anchor.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (anchor.commonAncestorContainer as Element)
        : anchor.commonAncestorContainer.parentElement ?? undefined
      : anchor;

  if (input.reveal) {
    observedElement?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'auto',
    });
    await new Promise<void>((resolve) => {
      globalThis.requestAnimationFrame(() => resolve());
    });
  }

  if (disposed || root[stateKey] !== state) {
    return { found: false };
  }

  const overlay = document.createElement('div');
  visual.overlay = overlay;
  overlay.setAttribute('aria-hidden', 'true');
  const overlayStyles: Readonly<Record<string, string>> = {
    all: 'initial',
    position: 'fixed',
    'pointer-events': 'none',
    'z-index': '2147483647',
    'box-sizing': 'border-box',
    border: '2px solid rgba(248, 113, 113, 0.95)',
    'border-radius': '4px',
    background: 'rgba(248, 113, 113, 0.08)',
    'box-shadow':
      '0 0 0 2px rgba(248, 113, 113, 0.14), inset 0 0 18px rgba(248, 113, 113, 0.24)',
    transition:
      'left 80ms linear, top 80ms linear, width 80ms linear, height 80ms linear',
  };
  for (const [property, value] of Object.entries(overlayStyles)) {
    overlay.style.setProperty(property, value, 'important');
  }
  document.documentElement.appendChild(overlay);

  function readRect(): DOMRect {
    return anchor.getBoundingClientRect();
  }

  function update() {
    animationFrame = undefined;
    if (disposed || root[stateKey] !== state || !overlay) {
      return;
    }
    const rect = readRect();
    if (rect.width <= 0 || rect.height <= 0) {
      overlay.style.setProperty('display', 'none', 'important');
      return;
    }
    overlay.style.setProperty('display', 'block', 'important');
    overlay.style.setProperty(
      'left',
      `${Math.round(rect.left) - 2}px`,
      'important',
    );
    overlay.style.setProperty(
      'top',
      `${Math.round(rect.top) - 2}px`,
      'important',
    );
    overlay.style.setProperty(
      'width',
      `${Math.round(rect.width) + 4}px`,
      'important',
    );
    overlay.style.setProperty(
      'height',
      `${Math.round(rect.height) + 4}px`,
      'important',
    );
  }

  function scheduleUpdate() {
    if (animationFrame === undefined && !disposed) {
      animationFrame = globalThis.requestAnimationFrame(update);
    }
  }

  scrollTarget.addEventListener('scroll', scheduleUpdate, {
    capture: true,
    passive: true,
  });
  globalThis.addEventListener('resize', scheduleUpdate);
  if (typeof ResizeObserver === 'function' && observedElement) {
    resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(observedElement);
    resizeObserver.observe(document.documentElement);
  }
  if (typeof MutationObserver === 'function' && document.body) {
    visual.mutationObserver = new MutationObserver(scheduleUpdate);
    visual.mutationObserver.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }
  update();

  const durationMs = Number(input.durationMs ?? 0);
  if (durationMs > 0) {
    timer = globalThis.setTimeout(() => state.cleanup(), durationMs);
  }
  return { found: true };
}

export function createHtmlAnchorHighlightFrameScript(
  payload: HtmlAnchorHighlightCommandPayload,
): string {
  return `(${runHtmlAnchorFrameCommand.toString()})(${JSON.stringify({
    action: 'highlight',
    ...payload,
  })})`;
}

export function createHtmlAnchorClearFrameScript(
  payload: HtmlAnchorClearCommandPayload,
): string {
  return `(${runHtmlAnchorFrameCommand.toString()})(${JSON.stringify({
    action: 'clear',
    ...payload,
  })})`;
}
