import { describe, expect, it } from 'vitest';

import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
} from '../../shared/workbench/facilities/core-facilities';
import { findTextSelectionInput } from '../../shared/workbench/selection';
import { createHtmlElementTarget } from './shared';
import { mapHtmlWorkbenchFacilityEvent } from './facility-events';

describe('HTML Workbench Facility event mapper', () => {
  it('publishes a settled text selection without waiting for a context menu', () => {
    const mapped = mapHtmlWorkbenchFacilityEvent(
      {
        sessionId: 'session-1',
        facilityId: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        facilityVersion: 1,
        payload: {
          text: '即时选区',
          frameUrl: 'learning-content://resource/token',
        },
      },
      'session-1',
    );

    expect(mapped?.kind).toBe('selection');
    expect(
      mapped && findTextSelectionInput(mapped.interaction),
    ).toMatchObject({
      text: '即时选区',
      target: {
        anchorType: 'html.quote',
        anchorPayload: {
          exact: '即时选区',
          frameUrl: 'learning-content://resource/token',
        },
      },
    });
  });

  it('clears the interaction when the sandbox reports an empty selection', () => {
    const mapped = mapHtmlWorkbenchFacilityEvent(
      {
        sessionId: 'session-1',
        facilityId: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        facilityVersion: 1,
        payload: {
          frameUrl: 'learning-content://resource/token',
        },
      },
      'session-1',
    );

    expect(mapped).toEqual({
      kind: 'selection',
      interaction: { inputs: [] },
    });
  });

  it('maps context text and links into one frozen menu interaction', () => {
    const elementTarget = createHtmlElementTarget({
      frameUrl: 'learning-content://resource/token',
      tagName: 'div',
      domPath: [1, 2],
      rect: { x: 5, y: 6, width: 50, height: 20 },
      id: 'chapter',
    });
    const mapped = mapHtmlWorkbenchFacilityEvent(
      {
        sessionId: 'session-1',
        facilityId: CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
        facilityVersion: 1,
        payload: {
          x: 20,
          y: 30,
          frameUrl: 'learning-content://resource/token',
          selectionText: '右键选区',
          linkUrl: 'https://example.com/chapter',
          mediaType: 'none',
          target: elementTarget,
        },
      },
      'session-1',
    );

    expect(mapped?.kind).toBe('context-menu');
    expect(
      mapped?.kind === 'context-menu'
        ? mapped.position
        : undefined,
    ).toEqual({ x: 20, y: 30 });
    expect(
      mapped && findTextSelectionInput(mapped.interaction)?.text,
    ).toBe('右键选区');
    expect(mapped?.interaction.focus).toEqual(elementTarget);
  });

  it('ignores stale sessions and unknown facility versions', () => {
    const event = {
      sessionId: 'session-old',
      facilityId: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
      facilityVersion: 1,
      payload: { text: '过期选区' },
    };

    expect(
      mapHtmlWorkbenchFacilityEvent(event, 'session-current'),
    ).toBeUndefined();
    expect(
      mapHtmlWorkbenchFacilityEvent(
        { ...event, sessionId: 'session-current', facilityVersion: 2 },
        'session-current',
      ),
    ).toBeUndefined();
  });
});
