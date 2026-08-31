import { useEffect, useState } from 'react';

import type {
  WorkbenchCommand,
  WorkbenchCommandResult,
  WorkbenchEvent,
} from '../../shared/workbench/protocol';
import {
  audioEventTypes,
  createAudioGetSpeakerTrackCommand,
  isAudioSpeakerTrackSnapshot,
  type AudioSpeakerTrack,
  type AudioSpeakerTrackSnapshot,
} from './shared';

export interface UseAudioSpeakerTrackInput {
  readonly resetKey: string;
  readonly initialSnapshot: AudioSpeakerTrackSnapshot;
  readonly executeCommand: (
    command: WorkbenchCommand,
  ) => Promise<WorkbenchCommandResult>;
  readonly subscribeEvent?: (
    listener: (event: WorkbenchEvent) => void,
  ) => () => void;
  readonly reportError: (error: unknown, fallback: string) => void;
}

export function useAudioSpeakerTrack({
  resetKey,
  initialSnapshot,
  executeCommand,
  subscribeEvent,
  reportError,
}: UseAudioSpeakerTrackInput): AudioSpeakerTrack | undefined {
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => setSnapshot(initialSnapshot), [initialSnapshot, resetKey]);

  useEffect(() => {
    if (!subscribeEvent) {
      throw new Error('Audio Workbench 缺少异步事件通道');
    }
    let disposed = false;
    let receivedEvent = false;
    const unsubscribe = subscribeEvent((event) => {
      if (
        event.type === audioEventTypes.speakerTrack &&
        isAudioSpeakerTrackSnapshot(event.payload)
      ) {
        receivedEvent = true;
        setSnapshot(event.payload);
      }
    });

    void executeCommand(createAudioGetSpeakerTrackCommand())
      .then((result) => {
        if (disposed || receivedEvent) return;
        if (!isAudioSpeakerTrackSnapshot(result.payload)) {
          throw new Error('Audio Workbench 说话人轨道响应无效');
        }
        setSnapshot(result.payload);
      })
      .catch((error: unknown) => {
        if (!disposed) reportError(error, '无法同步说话人轨道。');
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [executeCommand, reportError, resetKey, subscribeEvent]);

  return snapshot.track;
}
