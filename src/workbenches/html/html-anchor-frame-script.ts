import type {
  HtmlAnchorClearCommandPayload,
  HtmlAnchorHighlightCommandPayload,
} from './anchor-commands';
import {
  createHtmlSourceTextRuntimeExpression,
  type HtmlSourceTextRuntime,
} from './html-source-text-frame-script';

interface FrameAnchorCommand {
  readonly action: 'highlight' | 'clear';
  readonly channel?: 'anchor' | 'editing';
  readonly phase?: 'editing' | 'rejected';
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
async function runHtmlAnchorFrameCommand(
  input: FrameAnchorCommand,
  sourceText: HtmlSourceTextRuntime,
) {
  const stateKey = input.channel === 'editing'
    ? '__learningCompanionHtmlEditIndicatorV1'
    : '__learningCompanionHtmlAnchorHighlightV1';
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
    editStatus?: HTMLDivElement;
    mutationObserver?: MutationObserver;
    animations: Animation[];
  } = { animations: [] };
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
      for (const animation of visual.animations) {
        animation.cancel();
      }
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
    const id = normalizedText(locator.id);
    const role = normalizedText(locator.role);
    const ariaLabel = normalizedText(locator.ariaLabel);
    const textQuote = normalizedText(locator.textQuote);
    const elementText = normalizedText(sourceText.readElement(element));
    return (
      (!tagName || element.tagName.toLowerCase() === tagName) &&
      (!id || element.id === id) &&
      (!role || normalizedText(element.getAttribute('role')) === role) &&
      (!ariaLabel ||
        normalizedText(element.getAttribute('aria-label')) === ariaLabel) &&
      (!textQuote || elementText.includes(textQuote))
    );
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
    if (!tagName) {
      return undefined;
    }
    return Array.from(document.querySelectorAll(tagName)).find((candidate) =>
      matchesElement(candidate, locator),
    );
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
      const reconstructed = normalizedText(sourceText.readRange(range));
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
  const editing = input.channel === 'editing';
  const rejected = editing && input.phase === 'rejected';
  const reducedMotion =
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const color = rejected
    ? '244, 63, 94'
    : editing
      ? '59, 130, 246'
      : '248, 113, 113';
  const overlayStyles: Readonly<Record<string, string>> = {
    all: 'initial',
    position: 'fixed',
    'pointer-events': 'none',
    'z-index': '2147483647',
    'box-sizing': 'border-box',
    overflow: editing ? 'visible' : 'hidden',
    isolation: 'isolate',
    border: `${editing ? '1px' : '2px'} solid rgba(${color}, 0.95)`,
    'border-radius': editing ? '6px' : '4px',
    background: rejected
      ? 'repeating-linear-gradient(135deg, rgba(76, 5, 25, 0.52) 0 10px, rgba(136, 19, 55, 0.44) 10px 20px)'
      : editing
        ? 'rgba(7, 16, 30, 0.5)'
        : `rgba(${color}, 0.08)`,
    'backdrop-filter': editing ? 'blur(3px) saturate(0.82)' : 'none',
    'box-shadow': editing
      ? `0 0 0 1px rgba(${color}, 0.2), 0 12px 32px rgba(2, 6, 12, 0.26), inset 0 0 28px rgba(${color}, ${rejected ? '0.2' : '0.12'})`
      : `0 0 0 2px rgba(${color}, 0.16), inset 0 0 18px rgba(${color}, 0.24)`,
    transition:
      'left 80ms linear, top 80ms linear, width 80ms linear, height 80ms linear',
  };
  for (const [property, value] of Object.entries(overlayStyles)) {
    overlay.style.setProperty(property, value, 'important');
  }
  document.documentElement.appendChild(overlay);

  if (editing) {
    overlay.setAttribute(
      'data-learning-companion-edit-mask',
      rejected ? 'rejected' : 'editing',
    );

    const texture = document.createElement('div');
    texture.setAttribute('data-learning-companion-edit-texture', '');
    const textureStyles: Readonly<Record<string, string>> = {
      all: 'initial',
      display: 'block',
      position: 'absolute',
      inset: '0',
      'pointer-events': 'none',
      overflow: 'hidden',
      'border-radius': '5px',
      opacity: rejected ? '0.16' : '0.09',
      background: rejected
        ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 9px)'
        : 'linear-gradient(rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.45) 1px, transparent 1px)',
      'background-size': rejected ? 'auto' : '24px 24px',
    };
    for (const [property, value] of Object.entries(textureStyles)) {
      texture.style.setProperty(property, value, 'important');
    }
    if (rejected) {
      overlay.appendChild(texture);
    }

    const innerFrame = document.createElement('div');
    innerFrame.setAttribute('data-learning-companion-edit-frame', '');
    const innerFrameStyles: Readonly<Record<string, string>> = {
      all: 'initial',
      display: 'block',
      position: 'absolute',
      inset: '6px',
      'pointer-events': 'none',
      border: `1px solid rgba(${color}, ${rejected ? '0.72' : '0.42'})`,
      'border-radius': '3px',
      'box-shadow': `inset 3px 0 0 rgba(${color}, 0.82), inset -3px 0 0 rgba(${color}, 0.82)`,
    };
    for (const [property, value] of Object.entries(innerFrameStyles)) {
      innerFrame.style.setProperty(property, value, 'important');
    }
    if (rejected) {
      overlay.appendChild(innerFrame);
    }

    const status = document.createElement('div');
    status.setAttribute('data-learning-companion-edit-status', '');
    const statusStyles: Readonly<Record<string, string>> = {
      all: 'initial',
      display: 'flex',
      position: 'absolute',
      top: '8px',
      left: '8px',
      'align-items': 'center',
      gap: '6px',
      height: '22px',
      padding: '0 9px 0 8px',
      'pointer-events': 'none',
      border: `1px solid rgba(${color}, 0.45)`,
      'border-radius': '4px',
      background: rejected
        ? 'rgba(76, 5, 25, 0.92)'
        : 'rgba(7, 18, 36, 0.9)',
      color: rejected ? 'rgb(254, 205, 211)' : 'rgb(219, 234, 254)',
      'box-shadow': `0 6px 18px rgba(2, 6, 12, 0.28), inset 2px 0 0 rgba(${color}, 0.92)`,
      'font-family':
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      'font-size': '11px',
      'font-weight': '600',
      'line-height': '1',
      'white-space': 'nowrap',
      'letter-spacing': '0',
      'z-index': '4',
    };
    for (const [property, value] of Object.entries(statusStyles)) {
      status.style.setProperty(property, value, 'important');
    }
    visual.editStatus = status;

    const statusMark = document.createElement('span');
    statusMark.setAttribute('data-learning-companion-edit-status-mark', '');
    statusMark.textContent = rejected ? '!' : '';
    const statusMarkStyles: Readonly<Record<string, string>> = {
      all: 'initial',
      display: 'grid',
      width: rejected ? '16px' : '7px',
      height: rejected ? '16px' : '7px',
      'place-items': 'center',
      'border-radius': rejected ? '3px' : '999px',
      background: rejected ? `rgba(${color}, 0.2)` : 'rgb(147, 197, 253)',
      color: rejected ? 'rgb(254, 205, 211)' : 'rgb(219, 234, 254)',
      'box-shadow': rejected ? 'none' : `0 0 9px rgba(${color}, 0.95)`,
      'font-family': 'ui-sans-serif, system-ui, sans-serif',
      'font-size': rejected ? '11px' : '8px',
      'font-weight': '800',
      'line-height': '1',
      'letter-spacing': '0',
    };
    for (const [property, value] of Object.entries(statusMarkStyles)) {
      statusMark.style.setProperty(property, value, 'important');
    }
    status.appendChild(statusMark);

    const statusText = document.createElement('span');
    statusText.setAttribute('data-learning-companion-edit-status-text', '');
    statusText.textContent = rejected ? '修改未应用' : '正在重写';
    statusText.style.setProperty('all', 'initial', 'important');
    statusText.style.setProperty('color', 'inherit', 'important');
    statusText.style.setProperty('font', 'inherit', 'important');
    statusText.style.setProperty('letter-spacing', '0', 'important');
    status.appendChild(statusText);

    overlay.appendChild(status);

    if (!rejected) {
      const svgNamespace = 'http://www.w3.org/2000/svg';
      const filterId =
        `learning-companion-edit-wave-filter-${input.revision}`;
      const filterDefinitions = document.createElementNS(svgNamespace, 'svg');
      filterDefinitions.setAttribute('width', '0');
      filterDefinitions.setAttribute('height', '0');
      filterDefinitions.style.setProperty('position', 'absolute', 'important');
      const definitions = document.createElementNS(svgNamespace, 'defs');
      const waveFilter = document.createElementNS(svgNamespace, 'filter');
      waveFilter.setAttribute('id', filterId);
      waveFilter.setAttribute('data-learning-companion-edit-wave-filter', '');
      waveFilter.setAttribute('x', '-20%');
      waveFilter.setAttribute('y', '-20%');
      waveFilter.setAttribute('width', '140%');
      waveFilter.setAttribute('height', '140%');
      const turbulence = document.createElementNS(
        svgNamespace,
        'feTurbulence',
      );
      turbulence.setAttribute('type', 'turbulence');
      turbulence.setAttribute('baseFrequency', '0.015 0.06');
      turbulence.setAttribute('numOctaves', '2');
      turbulence.setAttribute('seed', '2');
      turbulence.setAttribute('result', 'noise');
      if (!reducedMotion) {
        const frequencyAnimation = document.createElementNS(
          svgNamespace,
          'animate',
        );
        frequencyAnimation.setAttribute('attributeName', 'baseFrequency');
        frequencyAnimation.setAttribute('dur', '3s');
        frequencyAnimation.setAttribute(
          'values',
          '0.015 0.06; 0.025 0.09; 0.015 0.06',
        );
        frequencyAnimation.setAttribute('repeatCount', 'indefinite');
        turbulence.appendChild(frequencyAnimation);
      }
      const displacement = document.createElementNS(
        svgNamespace,
        'feDisplacementMap',
      );
      displacement.setAttribute('in', 'SourceGraphic');
      displacement.setAttribute('in2', 'noise');
      displacement.setAttribute('scale', '22');
      displacement.setAttribute('xChannelSelector', 'R');
      displacement.setAttribute('yChannelSelector', 'G');
      waveFilter.append(turbulence, displacement);
      definitions.appendChild(waveFilter);
      filterDefinitions.appendChild(definitions);
      overlay.appendChild(filterDefinitions);

      const waveViewport = document.createElement('div');
      waveViewport.setAttribute(
        'data-learning-companion-edit-wave-viewport',
        '',
      );
      const waveViewportStyles: Readonly<Record<string, string>> = {
        all: 'initial',
        display: 'block',
        position: 'absolute',
        inset: '0',
        overflow: 'hidden',
        'pointer-events': 'none',
        'border-radius': '5px',
        'z-index': '2',
      };
      for (const [property, value] of Object.entries(waveViewportStyles)) {
        waveViewport.style.setProperty(property, value, 'important');
      }
      overlay.appendChild(waveViewport);

      const waveSweep = document.createElement('div');
      waveSweep.setAttribute('data-learning-companion-edit-wave-sweep', '');
      const waveSweepStyles: Readonly<Record<string, string>> = {
        display: 'block',
        position: 'absolute',
        inset: '0',
        'pointer-events': 'none',
        opacity: reducedMotion ? '0.6' : '1',
        filter: `url(#${filterId})`,
        transform: 'translate(0, 0)',
        'will-change': reducedMotion ? 'auto' : 'transform, opacity',
      };
      for (const [property, value] of Object.entries(waveSweepStyles)) {
        waveSweep.style.setProperty(
          property,
          value,
          property === 'opacity' || property === 'transform' ? '' : 'important',
        );
      }

      const beamWrapper = document.createElement('div');
      beamWrapper.setAttribute(
        'data-learning-companion-edit-beam-wrapper',
        '',
      );
      const beamWrapperStyles: Readonly<Record<string, string>> = {
        all: 'initial',
        display: 'flex',
        position: 'absolute',
        top: '-50%',
        left: '-50%',
        width: '200%',
        height: '200%',
        'align-items': 'center',
        'justify-content': 'center',
        transform: 'rotate(25deg)',
      };
      for (const [property, value] of Object.entries(beamWrapperStyles)) {
        beamWrapper.style.setProperty(property, value, 'important');
      }

      const beamGlow = document.createElement('div');
      beamGlow.setAttribute('data-learning-companion-edit-beam-glow', '');
      const beamGlowStyles: Readonly<Record<string, string>> = {
        all: 'initial',
        display: 'block',
        position: 'absolute',
        width: '220px',
        height: '100%',
        background:
          'linear-gradient(90deg, transparent 0%, rgba(96,165,250,0.14) 25%, rgba(96,165,250,0.48) 50%, rgba(96,165,250,0.14) 75%, transparent 100%)',
        filter: 'blur(12px)',
      };
      for (const [property, value] of Object.entries(beamGlowStyles)) {
        beamGlow.style.setProperty(property, value, 'important');
      }

      const beamCore = document.createElement('div');
      beamCore.setAttribute('data-learning-companion-edit-beam-core', '');
      const beamCoreStyles: Readonly<Record<string, string>> = {
        all: 'initial',
        display: 'block',
        position: 'absolute',
        width: '80px',
        height: '100%',
        background:
          'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 20%, rgba(255,255,255,0.88) 50%, rgba(255,255,255,0.1) 80%, transparent 100%)',
      };
      for (const [property, value] of Object.entries(beamCoreStyles)) {
        beamCore.style.setProperty(property, value, 'important');
      }

      const beamHighlight = document.createElement('div');
      beamHighlight.setAttribute(
        'data-learning-companion-edit-beam-highlight',
        '',
      );
      const beamHighlightStyles: Readonly<Record<string, string>> = {
        all: 'initial',
        display: 'block',
        position: 'absolute',
        width: '12px',
        height: '100%',
        background: 'rgb(255, 255, 255)',
        filter: 'blur(3px)',
      };
      for (const [property, value] of Object.entries(beamHighlightStyles)) {
        beamHighlight.style.setProperty(property, value, 'important');
      }

      beamWrapper.append(beamGlow, beamCore, beamHighlight);
      waveSweep.appendChild(beamWrapper);
      waveViewport.appendChild(waveSweep);

      if (
        typeof waveSweep.animate === 'function' &&
        !reducedMotion
      ) {
        visual.animations.push(
          waveSweep.animate(
            [
              {
                transform: 'translate(-100%, -100%)',
                opacity: 0,
                offset: 0,
              },
              {
                transform: 'translate(-70%, -70%)',
                opacity: 1,
                offset: 0.15,
              },
              {
                transform: 'translate(70%, 70%)',
                opacity: 1,
                offset: 0.85,
              },
              {
                transform: 'translate(100%, 100%)',
                opacity: 0,
                offset: 1,
              },
            ],
            {
              duration: 2_500,
              easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
              iterations: Infinity,
            },
          ),
        );
      }
    }
  }

  if (
    !editing &&
    typeof overlay.animate === 'function' &&
    !reducedMotion
  ) {
    visual.animations.push(
      overlay.animate(
        [{ opacity: 0.55 }, { opacity: 1 }],
        {
          duration: 760,
          direction: 'alternate',
          easing: 'ease-in-out',
          iterations: Infinity,
        },
      ),
    );
  }

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
    if (visual.editStatus) {
      const toolbarInset = 60;
      const statusTop = Math.max(8, toolbarInset - rect.top + 8);
      visual.editStatus.style.setProperty(
        'top',
        `${Math.round(statusTop)}px`,
        'important',
      );
    }
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
  })},${createHtmlSourceTextRuntimeExpression()})`;
}

export function createHtmlAnchorClearFrameScript(
  payload: HtmlAnchorClearCommandPayload,
): string {
  return `(${runHtmlAnchorFrameCommand.toString()})(${JSON.stringify({
    action: 'clear',
    ...payload,
  })},${createHtmlSourceTextRuntimeExpression()})`;
}

export function createHtmlEditIndicatorFrameScript(input: {
  readonly target: HtmlAnchorHighlightCommandPayload['target'];
  readonly revision: number;
  readonly phase: 'editing' | 'rejected';
}): string {
  return `(${runHtmlAnchorFrameCommand.toString()})(${JSON.stringify({
    action: 'highlight',
    channel: 'editing',
    target: input.target,
    revision: input.revision,
    reveal: false,
    durationMs: 0,
    phase: input.phase,
  })},${createHtmlSourceTextRuntimeExpression()})`;
}

export function createHtmlEditIndicatorClearFrameScript(input: {
  readonly target: HtmlAnchorClearCommandPayload['target'];
  readonly revision: number;
}): string {
  return `(${runHtmlAnchorFrameCommand.toString()})(${JSON.stringify({
    action: 'clear',
    channel: 'editing',
    target: input.target,
    revision: input.revision,
  })},${createHtmlSourceTextRuntimeExpression()})`;
}
