import {
  CORE_FACILITY_VERSION,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
  CORE_TEXT_SELECTION_MAX_LENGTH,
} from '../../../../shared/workbench/facilities/core-facilities';
import type {
  MainFacilityCaptureContext,
  MainWorkbenchFacilityAdapter,
} from '../main-facility-adapter-registry';
import { SANDBOX_CONTEXT_MENU_TRIGGER } from './sandbox-context-menu-facility-adapter';

export const SANDBOX_SELECTION_SETTLED_TRIGGER =
  'sandbox.selection-settled';

export const READ_FRAME_SELECTION_SCRIPT = `(() => {
  const selection = typeof globalThis.getSelection === 'function'
    ? globalThis.getSelection()
    : null;
  return selection ? selection.toString() : '';
})()`;

export class SandboxTextSelectionFacilityAdapter
  implements MainWorkbenchFacilityAdapter
{
  readonly facilityId = CORE_TEXT_SELECTION_INPUT_FACILITY_ID;
  readonly facilityVersion = CORE_FACILITY_VERSION;
  readonly triggers = [
    SANDBOX_SELECTION_SETTLED_TRIGGER,
    SANDBOX_CONTEXT_MENU_TRIGGER,
  ] as const;
  readonly dedupe = true;

  async capture(context: MainFacilityCaptureContext) {
    const result = await context.frame.executeJavaScript(
      READ_FRAME_SELECTION_SCRIPT,
    );
    const text =
      typeof result === 'string'
        ? result.slice(0, CORE_TEXT_SELECTION_MAX_LENGTH)
        : '';

    return {
      ...(text.trim() ? { text } : {}),
      frameUrl: context.frame.url || 'about:blank',
    };
  }
}
