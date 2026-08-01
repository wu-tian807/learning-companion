import {
  isAssetTarget,
  type ContentAnchorTarget,
} from './anchor';
import {
  CORE_FACILITY_VERSION,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
} from './facilities/core-facilities';
import type {
  WorkbenchInteractionInput,
  WorkbenchInteractionSnapshot,
} from './interaction';

export interface WorkbenchSelectionSnapshot {
  readonly text: string;
  readonly target: ContentAnchorTarget;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isWorkbenchSelectionSnapshot(
  value: unknown,
): value is WorkbenchSelectionSnapshot {
  if (!isRecord(value) || !isRequiredText(value.text)) {
    return false;
  }

  return (
    isAssetTarget(value.target) &&
    value.target.scope === 'content'
  );
}

export function createTextSelectionInput(
  selection: WorkbenchSelectionSnapshot,
): WorkbenchInteractionInput {
  return {
    type: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
    version: CORE_FACILITY_VERSION,
    target: selection.target,
    payload: { text: selection.text },
  };
}

export function findTextSelectionInput(
  interaction: WorkbenchInteractionSnapshot,
): WorkbenchSelectionSnapshot | undefined {
  const input = interaction.inputs.find(
    (candidate) =>
      candidate.type === CORE_TEXT_SELECTION_INPUT_FACILITY_ID &&
      candidate.version === CORE_FACILITY_VERSION,
  );

  if (
    !input?.target ||
    !isRecord(input.payload) ||
    Array.isArray(input.payload) ||
    typeof input.payload.text !== 'string'
  ) {
    return undefined;
  }

  const selection = {
    text: input.payload.text,
    target: input.target,
  };

  return isWorkbenchSelectionSnapshot(selection)
    ? selection
    : undefined;
}

export function interactionFromTextSelection(
  selection: WorkbenchSelectionSnapshot | undefined,
  focus: ContentAnchorTarget | undefined = selection?.target,
): WorkbenchInteractionSnapshot {
  return {
    ...(focus ? { focus } : {}),
    inputs: selection ? [createTextSelectionInput(selection)] : [],
  };
}
