import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_FACILITY_VERSION,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
  isCoreContextMenuFacilityEvent,
  isCoreTextSelectionFacilityEvent,
  type CoreContextMenuFacilityEvent,
  type CoreViewportRect,
} from '../../shared/workbench/facilities/core-facilities';
import type { WorkbenchFacilityEvent } from '../../shared/workbench/facilities/facility-event';
import type { WorkbenchInteractionSnapshot } from '../../shared/workbench/interaction';
import { interactionFromTextSelection } from '../../shared/workbench/selection';
import {
  createHtmlLinkTarget,
  isHtmlDomTarget,
  isHtmlElementTarget,
  isHtmlQuoteTarget,
} from './shared';

export type HtmlWorkbenchFacilityResult =
  | {
      readonly kind: 'selection';
      readonly interaction: WorkbenchInteractionSnapshot;
      readonly rect?: CoreViewportRect;
    }
  | {
      readonly kind: 'context-menu';
      readonly context: CoreContextMenuFacilityEvent;
      readonly interaction: WorkbenchInteractionSnapshot;
      readonly position: {
        readonly x: number;
        readonly y: number;
      };
    };

export function mapHtmlWorkbenchFacilityEvent(
  event: WorkbenchFacilityEvent,
  sessionId: string,
): HtmlWorkbenchFacilityResult | undefined {
  if (
    event.sessionId !== sessionId ||
    event.facilityVersion !== CORE_FACILITY_VERSION
  ) {
    return undefined;
  }

  if (
    event.facilityId ===
      CORE_TEXT_SELECTION_INPUT_FACILITY_ID &&
    isCoreTextSelectionFacilityEvent(event.payload)
  ) {
    const selection = event.payload.text
      && (
        isHtmlDomTarget(event.payload.target) ||
        isHtmlQuoteTarget(event.payload.target)
      )
      ? {
          text: event.payload.text,
          target: event.payload.target,
        }
      : undefined;

    return {
      kind: 'selection',
      interaction: interactionFromTextSelection(selection),
      ...(event.payload.rect === undefined
        ? {}
        : { rect: event.payload.rect }),
    };
  }

  if (
    event.facilityId ===
      CORE_CONTEXT_MENU_SURFACE_FACILITY_ID &&
    isCoreContextMenuFacilityEvent(event.payload)
  ) {
    const context = event.payload;
    const selectionTarget =
      isHtmlDomTarget(context.target) ||
      isHtmlQuoteTarget(context.target)
        ? context.target
        : undefined;
    const selection = context.selectionText && selectionTarget
      ? {
          text: context.selectionText,
          target: selectionTarget,
        }
      : undefined;
    const target =
      (isHtmlDomTarget(context.target) ||
      isHtmlElementTarget(context.target) ||
      isHtmlQuoteTarget(context.target)
        ? context.target
        : undefined) ??
      selection?.target ??
      (context.linkUrl
        ? createHtmlLinkTarget(context.linkUrl)
        : undefined);

    return {
      kind: 'context-menu',
      context,
      interaction: interactionFromTextSelection(
        selection,
        target,
      ),
      position: {
        x: context.x,
        y: context.y,
      },
    };
  }

  return undefined;
}
