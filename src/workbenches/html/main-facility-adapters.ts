import type { ContextMenuParams } from 'electron';

import type {
  MainFacilityCaptureContext,
  MainWorkbenchFacilityAdapter,
} from '../../main/workbench/interaction/main-facility-adapter-registry';
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
  type CoreContextMediaType,
} from '../../shared/workbench/facilities/core-facilities';
import {
  createHtmlElementTarget,
  createHtmlQuoteTarget,
  HTML_WORKBENCH_ID,
  isHtmlElementAnchorV1,
} from './shared';

export const READ_HTML_FRAME_SELECTION_SCRIPT = `(() => {
  const selection = typeof globalThis.getSelection === 'function'
    ? globalThis.getSelection()
    : null;
  return selection ? selection.toString() : '';
})()`;

export const READ_HTML_CONTEXT_ELEMENT_SCRIPT = `(() => {
  try {
    const hovered = Array.from(document.querySelectorAll(':hover'));
    const selection = typeof globalThis.getSelection === 'function'
      ? globalThis.getSelection()
      : null;
    const selectedNode = selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).commonAncestorContainer
      : null;
    const selectedElement = selectedNode
      ? (selectedNode.nodeType === Node.ELEMENT_NODE
          ? selectedNode
          : selectedNode.parentElement)
      : null;
    const candidate = hovered[hovered.length - 1]
      || selectedElement
      || document.activeElement
      || document.body
      || document.documentElement;

    if (!(candidate instanceof Element)) {
      return null;
    }

    const domPath = [];
    let current = candidate;

    while (current !== document.documentElement) {
      const parent = current.parentElement;

      if (!parent || domPath.length >= 128) {
        return null;
      }

      const index = Array.prototype.indexOf.call(
        parent.children,
        current,
      );

      if (index < 0) {
        return null;
      }

      domPath.unshift(index);
      current = parent;
    }

    const bounded = (value, limit) => {
      const normalized = typeof value === 'string'
        ? value.replace(/\\s+/g, ' ').trim()
        : '';
      return normalized ? normalized.slice(0, limit) : undefined;
    };
    const text = bounded(
      'innerText' in candidate
        ? candidate.innerText
        : candidate.textContent,
      1024,
    );
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

    return {
      tagName: candidate.tagName.toLowerCase(),
      domPath,
      rect,
      ...(id ? { id } : {}),
      ...(role ? { role } : {}),
      ...(ariaLabel ? { ariaLabel } : {}),
      ...(text ? { textQuote: text } : {}),
    };
  } catch {
    return null;
  }
})()`;

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
    const selectionText = params.selectionText.slice(
      0,
      CORE_TEXT_SELECTION_MAX_LENGTH,
    );
    let target:
      | ReturnType<typeof createHtmlElementTarget>
      | undefined;

    try {
      const probe = await context.frame.executeJavaScript(
        READ_HTML_CONTEXT_ELEMENT_SCRIPT,
      );
      const anchor = {
        ...(typeof probe === 'object' && probe !== null ? probe : {}),
        frameUrl,
      };

      if (isHtmlElementAnchorV1(anchor)) {
        target = createHtmlElementTarget(anchor);
      }
    } catch {
      // DOM 定位失败不应阻断基础右键菜单。
    }

    return {
      x: params.x,
      y: params.y,
      frameUrl,
      ...(selectionText.trim() ? { selectionText } : {}),
      ...(isExternalHttpUrl(params.linkURL)
        ? { linkUrl: params.linkURL }
        : {}),
      mediaType: mediaType(params.mediaType),
      ...(isExternalHttpUrl(params.srcURL)
        ? { sourceUrl: params.srcURL }
        : {}),
      ...(target ? { target } : {}),
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
    const text =
      typeof result === 'string'
        ? result.slice(0, CORE_TEXT_SELECTION_MAX_LENGTH)
        : '';
    const frameUrl = context.frame.url || 'about:blank';

    return {
      ...(text.trim()
        ? {
            text,
            target: createHtmlQuoteTarget(text, frameUrl),
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
