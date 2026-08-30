import type {
  HtmlEditVisualClearPayload,
  HtmlEditVisualShowPayload,
} from './html-edit-visual-commands';

interface HtmlEditVisualFrameInput {
  readonly action: 'show' | 'clear';
  readonly target: unknown;
  readonly revision: number;
  readonly phase?: 'scanning' | 'rejected';
}

function runHtmlEditVisualFrameCommand(input: HtmlEditVisualFrameInput) {
  const stateKey = '__learningCompanionHtmlEditVisualV1';
  const root = globalThis as unknown as Record<string, unknown>;
  type RuntimeState = {
    readonly revision: number;
    cleanup(): void;
  };
  const current = root[stateKey] as RuntimeState | undefined;

  if (input.action === 'clear') {
    if (current && input.revision >= current.revision) current.cleanup();
    return { found: false };
  }
  if (current && current.revision > input.revision) return { found: false };
  current?.cleanup();

  const target =
    typeof input.target === 'object' && input.target !== null
      ? (input.target as Record<string, unknown>)
      : undefined;
  const anchorPayload =
    typeof target?.anchorPayload === 'object' && target.anchorPayload !== null
      ? (target.anchorPayload as Record<string, unknown>)
      : undefined;
  const locator =
    typeof anchorPayload?.element === 'object' &&
    anchorPayload.element !== null
      ? (anchorPayload.element as Record<string, unknown>)
      : undefined;

  function normalizedText(value: unknown): string {
    return typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim()
      : '';
  }

  function matches(element: Element | undefined): element is Element {
    if (!element || !locator) return false;
    const tagName = normalizedText(locator.tagName).toLowerCase();
    return !tagName || element.tagName.toLowerCase() === tagName;
  }

  function elementFromPath(path: unknown): Element | undefined {
    if (!Array.isArray(path)) return undefined;
    let element: Element = document.documentElement;
    for (const index of path) {
      if (!Number.isSafeInteger(index) || Number(index) < 0) return undefined;
      const child = element.children.item(Number(index));
      if (!child) return undefined;
      element = child;
    }
    return element;
  }

  function resolveElement(): Element | undefined {
    const id = normalizedText(locator?.id);
    const byId = id ? document.getElementById(id) ?? undefined : undefined;
    if (matches(byId)) return byId;
    const byPath = elementFromPath(locator?.path);
    if (matches(byPath)) return byPath;
    return undefined;
  }

  const element = resolveElement();
  if (!element) return { found: false };
  const resolvedElement = element;

  let disposed = false;
  let animationFrame: number | undefined;
  let rejectedTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;
  const overlay = document.createElement('div');
  const state: RuntimeState = {
    revision: input.revision,
    cleanup() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('scroll', scheduleUpdate, true);
      globalThis.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (animationFrame !== undefined) {
        globalThis.cancelAnimationFrame(animationFrame);
      }
      if (rejectedTimer !== undefined) {
        globalThis.clearTimeout(rejectedTimer);
      }
      overlay.remove();
      if (root[stateKey] === state) delete root[stateKey];
    },
  };
  root[stateKey] = state;

  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute(
    'data-learning-companion-html-agent-edit',
    input.phase ?? 'scanning',
  );
  const overlayStyles: Readonly<Record<string, string>> = {
    all: 'initial',
    position: 'fixed',
    overflow: 'hidden',
    'pointer-events': 'none',
    'z-index': '2147483647',
    'box-sizing': 'border-box',
    'border-radius': '6px',
    border: '1px solid rgba(147, 197, 253, 0.58)',
    background: 'rgba(12, 18, 26, 0.72)',
    'backdrop-filter': 'blur(2px)',
    'box-shadow':
      '0 0 0 1px rgba(96, 165, 250, 0.16), inset 0 0 28px rgba(59, 130, 246, 0.12)',
    transition:
      'left 80ms linear, top 80ms linear, width 80ms linear, height 80ms linear, border-color 140ms ease, background 140ms ease',
  };
  for (const [property, value] of Object.entries(overlayStyles)) {
    overlay.style.setProperty(property, value, 'important');
  }

  const style = document.createElement('style');
  style.textContent = `
    @keyframes lc-html-edit-sweep {
      0% { transform: translate(-105%, -105%); opacity: 0; }
      14% { opacity: 1; }
      86% { opacity: 1; }
      100% { transform: translate(105%, 105%); opacity: 0; }
    }
    @keyframes lc-html-edit-rejected {
      0%, 100% { opacity: 1; }
      45% { opacity: .48; }
    }
  `;
  overlay.appendChild(style);

  const mask = document.createElement('div');
  mask.style.cssText =
    'position:absolute;inset:0;background:rgba(10,15,22,.28);';
  overlay.appendChild(mask);

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const waveFilterId = `lc-html-edit-wave-${input.revision}`;
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;inset:0;';
  const definitions = document.createElementNS(svgNamespace, 'defs');
  const filter = document.createElementNS(svgNamespace, 'filter');
  filter.setAttribute('id', waveFilterId);
  filter.setAttribute('x', '-20%');
  filter.setAttribute('y', '-20%');
  filter.setAttribute('width', '140%');
  filter.setAttribute('height', '140%');
  const turbulence = document.createElementNS(svgNamespace, 'feTurbulence');
  turbulence.setAttribute('type', 'turbulence');
  turbulence.setAttribute('baseFrequency', '0.015 0.06');
  turbulence.setAttribute('numOctaves', '2');
  turbulence.setAttribute('seed', '2');
  turbulence.setAttribute('result', 'noise');
  const frequencyAnimation = document.createElementNS(svgNamespace, 'animate');
  frequencyAnimation.setAttribute('attributeName', 'baseFrequency');
  frequencyAnimation.setAttribute('dur', '3s');
  frequencyAnimation.setAttribute(
    'values',
    '0.015 0.06;0.025 0.09;0.015 0.06',
  );
  frequencyAnimation.setAttribute('repeatCount', 'indefinite');
  turbulence.appendChild(frequencyAnimation);
  const displacement = document.createElementNS(
    svgNamespace,
    'feDisplacementMap',
  );
  displacement.setAttribute('in', 'SourceGraphic');
  displacement.setAttribute('in2', 'noise');
  displacement.setAttribute('scale', '22');
  displacement.setAttribute('xChannelSelector', 'R');
  displacement.setAttribute('yChannelSelector', 'G');
  filter.append(turbulence, displacement);
  definitions.appendChild(filter);
  svg.appendChild(definitions);
  overlay.appendChild(svg);

  const sweep = document.createElement('div');
  sweep.setAttribute('data-html-edit-wave-sweep', 'true');
  sweep.style.cssText =
    `position:absolute;inset:0;filter:url(#${waveFilterId});animation:lc-html-edit-sweep 2.15s cubic-bezier(.4,0,.2,1) infinite;`;
  const wrapper = document.createElement('div');
  wrapper.style.cssText =
    'position:absolute;top:-60%;left:-60%;width:220%;height:220%;display:flex;align-items:center;justify-content:center;transform:rotate(25deg);';
  const glow = document.createElement('div');
  glow.style.cssText =
    'position:absolute;width:220px;height:100%;background:linear-gradient(90deg,transparent,rgba(96,165,250,.12) 22%,rgba(125,211,252,.48) 50%,rgba(96,165,250,.12) 78%,transparent);filter:blur(12px);';
  const core = document.createElement('div');
  core.style.cssText =
    'position:absolute;width:74px;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.1) 18%,rgba(255,255,255,.9) 50%,rgba(255,255,255,.1) 82%,transparent);';
  const highlight = document.createElement('div');
  highlight.style.cssText =
    'position:absolute;width:10px;height:100%;background:#fff;filter:blur(3px);';
  wrapper.append(glow, core, highlight);
  sweep.appendChild(wrapper);
  overlay.appendChild(sweep);

  const label = document.createElement('span');
  label.textContent = 'AI 正在修改';
  label.style.cssText =
    'all:initial;position:absolute;right:8px;top:8px;max-width:calc(100% - 16px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:rgba(18,26,36,.82);padding:4px 7px;color:rgba(226,232,240,.92);font:500 11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  overlay.appendChild(label);

  function applyPhase(phase: 'scanning' | 'rejected') {
    overlay.setAttribute('data-learning-companion-html-agent-edit', phase);
    if (phase === 'rejected') {
      overlay.style.setProperty(
        'border-color',
        'rgba(251, 113, 133, 0.9)',
        'important',
      );
      overlay.style.setProperty(
        'background',
        'rgba(48, 16, 24, 0.78)',
        'important',
      );
      overlay.style.setProperty(
        'animation',
        'lc-html-edit-rejected 420ms ease 1',
        'important',
      );
      label.textContent = '修改未应用';
      rejectedTimer = globalThis.setTimeout(() => {
        if (!disposed && root[stateKey] === state) applyPhase('scanning');
      }, 760);
      return;
    }
    overlay.style.setProperty(
      'border-color',
      'rgba(147, 197, 253, 0.58)',
      'important',
    );
    overlay.style.setProperty(
      'background',
      'rgba(12, 18, 26, 0.72)',
      'important',
    );
    overlay.style.removeProperty('animation');
    label.textContent = 'AI 正在修改';
  }

  document.documentElement.appendChild(overlay);
  applyPhase(input.phase ?? 'scanning');

  function update() {
    animationFrame = undefined;
    if (disposed || root[stateKey] !== state) return;
    const rect = resolvedElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      overlay.style.setProperty('display', 'none', 'important');
      return;
    }
    overlay.style.setProperty('display', 'block', 'important');
    overlay.style.setProperty('left', `${Math.round(rect.left)}px`, 'important');
    overlay.style.setProperty('top', `${Math.round(rect.top)}px`, 'important');
    overlay.style.setProperty('width', `${Math.round(rect.width)}px`, 'important');
    overlay.style.setProperty('height', `${Math.round(rect.height)}px`, 'important');
    label.style.display = rect.width >= 112 && rect.height >= 42 ? 'block' : 'none';
  }

  function scheduleUpdate() {
    if (animationFrame === undefined && !disposed) {
      animationFrame = globalThis.requestAnimationFrame(update);
    }
  }

  document.addEventListener('scroll', scheduleUpdate, {
    capture: true,
    passive: true,
  });
  globalThis.addEventListener('resize', scheduleUpdate);
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(resolvedElement);
    resizeObserver.observe(document.documentElement);
  }
  if (typeof MutationObserver === 'function' && document.body) {
    mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  }
  update();
  return { found: true };
}

export function createHtmlEditVisualShowFrameScript(
  payload: HtmlEditVisualShowPayload,
): string {
  return `(${runHtmlEditVisualFrameCommand.toString()})(${JSON.stringify({
    action: 'show',
    ...payload,
  })})`;
}

export function createHtmlEditVisualClearFrameScript(
  payload: HtmlEditVisualClearPayload,
): string {
  return `(${runHtmlEditVisualFrameCommand.toString()})(${JSON.stringify({
    action: 'clear',
    ...payload,
  })})`;
}
