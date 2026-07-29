import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_FACILITY_VERSION,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
  isCoreContextMenuFacilityEvent,
  isCoreTextSelectionFacilityEvent,
  type CoreContextMenuFacilityEvent,
} from '../../shared/workbench/facilities/core-facilities';
import type { WorkbenchFacilityEvent } from '../../shared/workbench/facilities/facility-event';
import type { WorkbenchInteractionSnapshot } from '../../shared/workbench/interaction';
import { interactionFromTextSelection } from '../../shared/workbench/selection';
import {
  createHtmlLinkTarget,
  createHtmlQuoteTarget,
} from './shared';

export type HtmlWorkbenchFacilityResult =
  | {
      readonly kind: 'selection';
      readonly interaction: WorkbenchInteractionSnapshot;
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
      ? {
          text: event.payload.text,
          target: createHtmlQuoteTarget(
            event.payload.text,
            event.payload.frameUrl,
          ),
        }
      : undefined;

    return {
      kind: 'selection',
      interaction: interactionFromTextSelection(selection),
    };
  }

  if (
    event.facilityId ===
      CORE_CONTEXT_MENU_SURFACE_FACILITY_ID &&
    isCoreContextMenuFacilityEvent(event.payload)
  ) {
    const context = event.payload;
    const selection = context.selectionText
      ? {
          text: context.selectionText,
          target: createHtmlQuoteTarget(
            context.selectionText,
            context.frameUrl,
          ),
        }
      : undefined;
    const target =
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
