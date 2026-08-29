import type { ContextMenuParams } from 'electron';

import type {
  MainFacilityCaptureContext,
  MainWorkbenchFacilityAdapter,
} from '../../main/workbench/interaction/main-workbench-facility-adapter';
import {
  SANDBOX_CONTEXT_MENU_TRIGGER,
  SANDBOX_SELECTION_SETTLED_TRIGGER,
} from '../../main/workbench/interaction/sandbox-frame-interaction-triggers';
import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_FACILITY_VERSION,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
  CORE_TEXT_SELECTION_MAX_LENGTH,
  coreContextMediaTypes,
  isCoreViewportRect,
  type CoreContextMediaType,
  type CoreViewportRect,
} from '../../shared/workbench/facilities/core-facilities';
import {
  createHtmlDomTarget,
  HTML_WORKBENCH_ID,
  isHtmlDomAnchorV1,
} from './shared';
import {
  createHtmlSourceTextRuntimeExpression,
  type HtmlSourceTextRuntime,
} from './html-source-text-frame-script';
import { createHtmlSourceCopyInstallerExpression } from './html-source-copy-frame-script';

type HtmlDomProbeMode = 'required-selection' | 'prefer-selection' | 'element';

function readHtmlDomAnchor(
  mode: HtmlDomProbeMode,
  sourceText: HtmlSourceTextRuntime,
) {
  try {
    const hovered = Array.from(document.querySelectorAll(':hover'));
    const selection = typeof globalThis.getSelection === 'function'
      ? globalThis.getSelection()
      : null;
    const selectedRange = selection && selection.rangeCount > 0 && !selection.isCollapsed
      ? selection.getRangeAt(0)
      : null;
    const selectedText = selectedRange ? sourceText.readRange(selectedRange) : '';
    const useSelection = mode !== 'element' && selectedText.trim().length > 0;
    if (mode === 'required-selection' && !useSelection) return null;
    const selectedNode = useSelection ? selectedRange?.commonAncestorContainer : null;
    const selectedElement = selectedNode
      ? (selectedNode.nodeType === Node.ELEMENT_NODE
          ? selectedNode
          : selectedNode.parentElement)
      : null;
    const rawCandidate = selectedElement
      || hovered[hovered.length - 1]
      || document.activeElement
      || document.body
      || document.documentElement;

    if (!(rawCandidate instanceof Element)) {
      return null;
    }
    const candidate = sourceText.formulaRoot(rawCandidate) ?? rawCandidate;

    const elementPath = [];
    let current = candidate;

    while (current !== document.documentElement) {
      const parent = current.parentElement;

      if (!parent || elementPath.length >= 128) {
        return null;
      }

      const index = Array.prototype.indexOf.call(
        parent.children,
        current,
      );

      if (index < 0) {
        return null;
      }

      elementPath.unshift(index);
      current = parent;
    }

    const bounded = (value: unknown, limit: number) => {
      const normalized = typeof value === 'string'
        ? value.replace(/\\s+/g, ' ').trim()
        : '';
      return normalized ? normalized.slice(0, limit) : undefined;
    };
    const text = bounded(sourceText.readElement(candidate), 1024);
    const id = bounded(candidate.id, 512);
    const role = bounded(candidate.getAttribute('role'), 128);
    const ariaLabel = bounded(
      candidate.getAttribute('aria-label'),
      512,
    );
    const frameRect = candidate.getBoundingClientRect();
    const rect = {
      x: Math.round(frameRect.x),
      y: Math.round(frameRect.y),
      width: Math.round(frameRect.width),
      height: Math.round(frameRect.height),
    };

    const element = {
      path: elementPath,
      tagName: candidate.tagName.toLowerCase(),
      ...(id ? { id } : {}),
      ...(role ? { role } : {}),
      ...(ariaLabel ? { ariaLabel } : {}),
      ...(text ? { textQuote: text } : {}),
    };
    return {
      ...(useSelection ? { text: selectedText } : {}),
      element,
      rect,
    };
  } catch {
    return null;
  }
}

export function createHtmlDomProbeFrameScript(mode: HtmlDomProbeMode): string {
  return `(() => { const sourceText = ${createHtmlSourceTextRuntimeExpression()}; ${createHtmlSourceCopyInstallerExpression()}(sourceText); return (${readHtmlDomAnchor.toString()})(${JSON.stringify(mode)},sourceText); })()`;
}

export const READ_HTML_FRAME_SELECTION_SCRIPT =
  createHtmlDomProbeFrameScript('required-selection');
export const READ_HTML_CONTEXT_ELEMENT_SCRIPT =
  createHtmlDomProbeFrameScript('element');
export const READ_HTML_CONTEXT_SELECTION_SCRIPT =
  createHtmlDomProbeFrameScript('prefer-selection');

function parseHtmlDomProbe(
  value: unknown,
  frameUrl: string,
): {
  readonly target: ReturnType<typeof createHtmlDomTarget>;
  readonly text?: string;
  readonly rect?: CoreViewportRect;
} | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const probe = value as Record<string, unknown>;
  const anchor = {
    frameUrl,
    element: probe.element,
  };
  if (!isHtmlDomAnchorV1(anchor)) {
    return undefined;
  }
  return {
    target: createHtmlDomTarget(anchor),
    ...(typeof probe.text === 'string' ? { text: probe.text } : {}),
    ...(isCoreViewportRect(probe.rect) ? { rect: probe.rect } : {}),
  };
}

function isExternalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function mediaType(
  value: ContextMenuParams['mediaType'],
): CoreContextMediaType {
  return coreContextMediaTypes.includes(
    value as CoreContextMediaType,
  )
    ? (value as CoreContextMediaType)
    : 'none';
}

export class HtmlContextMenuFacilityAdapter
  implements MainWorkbenchFacilityAdapter
{
  readonly workbenchId = HTML_WORKBENCH_ID;
  readonly facilityId = CORE_CONTEXT_MENU_SURFACE_FACILITY_ID;
  readonly facilityVersion = CORE_FACILITY_VERSION;
  readonly triggers = [SANDBOX_CONTEXT_MENU_TRIGGER] as const;

  async capture(context: MainFacilityCaptureContext) {
    const params = context.source as ContextMenuParams | undefined;

    if (!params) {
      return undefined;
    }

    const frameUrl = params.frameURL || context.frame.url || 'about:blank';
    const fallbackSelectionText = params.selectionText.slice(
      0,
      CORE_TEXT_SELECTION_MAX_LENGTH,
    );
    let probe: ReturnType<typeof parseHtmlDomProbe> = undefined;

    try {
      const result = await context.frame.executeJavaScript(
        fallbackSelectionText.trim()
          ? READ_HTML_CONTEXT_SELECTION_SCRIPT
          : READ_HTML_CONTEXT_ELEMENT_SCRIPT,
      );
      probe = parseHtmlDomProbe(result, frameUrl);
    } catch {
      // DOM 定位失败不应阻断基础右键菜单。
    }

    return {
      x: params.x,
      y: params.y,
      frameUrl,
      ...((probe?.text ?? fallbackSelectionText).trim()
        ? {
            selectionText: (probe?.text ?? fallbackSelectionText).slice(
              0,
              CORE_TEXT_SELECTION_MAX_LENGTH,
            ),
          }
        : {}),
      ...(isExternalHttpUrl(params.linkURL)
        ? { linkUrl: params.linkURL }
        : {}),
      mediaType: mediaType(params.mediaType),
      ...(isExternalHttpUrl(params.srcURL)
        ? { sourceUrl: params.srcURL }
        : {}),
      ...(probe ? { target: probe.target } : {}),
    };
  }
}

export class HtmlTextSelectionFacilityAdapter
  implements MainWorkbenchFacilityAdapter
{
  readonly workbenchId = HTML_WORKBENCH_ID;
  readonly facilityId = CORE_TEXT_SELECTION_INPUT_FACILITY_ID;
  readonly facilityVersion = CORE_FACILITY_VERSION;
  readonly triggers = [
    SANDBOX_SELECTION_SETTLED_TRIGGER,
    SANDBOX_CONTEXT_MENU_TRIGGER,
  ] as const;
  readonly dedupe = true;

  async capture(context: MainFacilityCaptureContext) {
    const result = await context.frame.executeJavaScript(
      READ_HTML_FRAME_SELECTION_SCRIPT,
    );
    const frameUrl = context.frame.url || 'about:blank';
    const probe = parseHtmlDomProbe(result, frameUrl);
    const text = probe?.text?.slice(0, CORE_TEXT_SELECTION_MAX_LENGTH) ?? '';

    return {
      ...(text.trim() && probe
        ? {
            text,
            target: probe.target,
            ...(probe.rect ? { rect: probe.rect } : {}),
          }
        : {}),
      frameUrl,
    };
  }
}

export function createHtmlMainFacilityAdapters(): readonly MainWorkbenchFacilityAdapter[] {
  return [
    new HtmlContextMenuFacilityAdapter(),
    new HtmlTextSelectionFacilityAdapter(),
  ];
}
