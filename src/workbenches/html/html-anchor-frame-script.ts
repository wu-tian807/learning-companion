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

  function compactText(value: unknown): string {
    return normalizedText(value).replace(/\s+/g, '');
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

  function nodeFromDomPath(path: unknown): Node | undefined {
    if (!Array.isArray(path)) {
      return undefined;
    }
    let node: Node = document.documentElement;
    for (const index of path) {
      if (!Number.isSafeInteger(index) || Number(index) < 0) {
        return undefined;
      }
      const child = node.childNodes.item(Number(index));
      if (!child) {
        return undefined;
      }
      node = child;
    }
    return node;
  }

  function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  }

  function matchesElement(
    element: Element | undefined,
    locator: Record<string, unknown> | undefined,
  ): element is Element {
    if (!element || !locator) {
      return false;
    }
    const tagName = normalizedText(locator.tagName).toLowerCase();
    return !tagName || element.tagName.toLowerCase() === tagName;
  }

  function resolveElement(
    locator: Record<string, unknown> | undefined,
  ): Element | undefined {
    if (!locator) {
      return undefined;
    }
    const id = normalizedText(locator.id);
    const byId = id ? document.getElementById(id) ?? undefined : undefined;
    if (matchesElement(byId, locator)) {
      return byId;
    }
    const byPath = elementFromDomPath(locator.path ?? locator.domPath);
    if (matchesElement(byPath, locator)) {
      return byPath;
    }

    const tagName = normalizedText(locator.tagName).toLowerCase();
    const textQuote = normalizedText(locator.textQuote);
    const ariaLabel = normalizedText(locator.ariaLabel);
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

  function resolveDomRange(
    domRange: Record<string, unknown> | undefined,
    exact: string,
    container?: Element,
  ): Range | undefined {
    const start =
      typeof domRange?.start === 'object' && domRange.start !== null
        ? (domRange.start as Record<string, unknown>)
        : undefined;
    const end =
      typeof domRange?.end === 'object' && domRange.end !== null
        ? (domRange.end as Record<string, unknown>)
        : undefined;
    const startNode = nodeFromDomPath(start?.path);
    const endNode = nodeFromDomPath(end?.path);
    const startOffset = Number(start?.offset);
    const endOffset = Number(end?.offset);

    if (
      !startNode ||
      !endNode ||
      !Number.isSafeInteger(startOffset) ||
      !Number.isSafeInteger(endOffset) ||
      startOffset < 0 ||
      endOffset < 0
    ) {
      return undefined;
    }
    if (
      container &&
      (!container.contains(startNode) || !container.contains(endNode))
    ) {
      return undefined;
    }

    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const reconstructed = normalizedText(range.toString());
      return (
        reconstructed === exact ||
        compactText(reconstructed) === compactText(exact)
      )
        ? range
        : undefined;
    } catch {
      return undefined;
    }
  }

  function resolveQuoteWithin(
    container: Element | undefined,
    exact: string,
  ): Range | undefined {
    if (!exact || !container) {
      return undefined;
    }
    const walker = document.createTreeWalker(
      container,
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

    if (characters.length === 0) {
      return undefined;
    }
    let startIndex = indexedText.indexOf(exact);
    let matchedCharacters = characters;
    let matchedLength = exact.length;
    if (startIndex < 0) {
      const compactExact = compactText(exact);
      const compactCharacters: typeof characters = [];
      let compactIndexedText = '';
      for (let index = 0; index < indexedText.length; index += 1) {
        const character = indexedText[index];
        const location = characters[index];
        if (!character || !location || /\s/.test(character)) {
          continue;
        }
        compactIndexedText += character;
        compactCharacters.push(location);
      }
      startIndex = compactIndexedText.indexOf(compactExact);
      matchedCharacters = compactCharacters;
      matchedLength = compactExact.length;
    }
    if (startIndex < 0 || matchedLength === 0) {
      return undefined;
    }
    const endIndex = startIndex + matchedLength - 1;
    const start = matchedCharacters[startIndex];
    const end = matchedCharacters[endIndex];
    if (!start || !end) {
      return undefined;
    }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, Math.min(end.node.length, end.offset + 1));
    return range;
  }

  function resolveDomAnchor(): Element | Range | undefined {
    if (!record || !payload) {
      return undefined;
    }

    if (record.anchorType === 'html.dom') {
      const locator = asRecord(payload.element);
      return resolveElement(locator);
    }

    if (record.anchorType === 'html.element') {
      return resolveElement(payload);
    }

    if (record.anchorType === 'html.quote') {
      const exact = normalizedText(payload.exact);
      if (!exact) {
        return undefined;
      }
      return (
        resolveDomRange(asRecord(payload.domRange), exact) ??
        resolveQuoteWithin(document.body ?? undefined, exact)
      );
    }

    return undefined;
  }

  const resolved: Element | Range | undefined =
    record?.anchorType === 'html.link'
      ? resolveLink()
      : resolveDomAnchor();

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
