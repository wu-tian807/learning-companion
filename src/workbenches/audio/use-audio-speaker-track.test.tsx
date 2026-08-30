// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WorkbenchCommandResult,
  WorkbenchEvent,
} from '../../shared/workbench/protocol';
import { audioEventTypes } from './shared';
import { useAudioSpeakerTrack } from './use-audio-speaker-track';

const track = {
  version: 1 as const,
  kind: 'dubbing-speaker-track' as const,
  sourceTrackRevision: 'source-track-revision',
  cues: [
    {
      sourceCueId: 'cue-1',
      speakerId: 'speaker-0001',
      status: 'stable' as const,
    },
  ],
  profiles: [{ speakerId: 'speaker-0001', mode: 'default' as const }],
};
const EMPTY_SNAPSHOT = Object.freeze({});

function Harness({
  executeCommand,
  subscribeEvent,
  reportError,
}: {
  readonly executeCommand: () => Promise<WorkbenchCommandResult>;
  readonly subscribeEvent: (
    listener: (event: WorkbenchEvent) => void,
  ) => () => void;
  readonly reportError: (error: unknown, fallback: string) => void;
}) {
  const current = useAudioSpeakerTrack({
    resetKey: 'session',
    initialSnapshot: EMPTY_SNAPSHOT,
    executeCommand,
    subscribeEvent,
    reportError,
  });
  return <output>{current?.cues[0]?.speakerId ?? 'empty'}</output>;
}

describe('useAudioSpeakerTrack', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps a newer event when first-open reconciliation resolves later', async () => {
    let resolveCommand: ((result: WorkbenchCommandResult) => void) | undefined;
    let listener: ((event: WorkbenchEvent) => void) | undefined;
    const executeCommand = vi.fn(
      () =>
        new Promise<WorkbenchCommandResult>((resolvePromise) => {
          resolveCommand = resolvePromise;
        }),
    );
    const subscribeEvent = vi.fn((nextListener) => {
      listener = nextListener;
      return vi.fn();
    });
    const reportError = vi.fn();

    await act(async () =>
      root.render(
        <Harness
          executeCommand={executeCommand}
          subscribeEvent={subscribeEvent}
          reportError={reportError}
        />,
      ),
    );
    expect(container.textContent).toBe('empty');

    act(() =>
      listener?.({
        sessionId: 'session',
        type: audioEventTypes.speakerTrack,
        payload: { track },
      }),
    );
    expect(container.textContent).toBe('speaker-0001');

    await act(async () => resolveCommand?.({ payload: {} }));
    expect(container.textContent).toBe('speaker-0001');
    expect(reportError).not.toHaveBeenCalled();
  });
});
