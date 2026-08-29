import { useCallback, useEffect, useState } from 'react';

import type {
  WorkbenchCommand,
  WorkbenchCommandResult,
  WorkbenchEvent,
} from '../../shared/workbench/protocol';
import {
  applyMediaSubtitleCueFinal,
  type MediaSubtitleCueFinalPayload,
  type MediaSubtitleDisplayMode,
  type MediaSubtitleSnapshot,
} from './presentation';

export interface MediaSubtitleProtocol {
  readonly snapshotEventType: string;
  readonly cueFinalEventType: string;
  readonly createGetSnapshotCommand: () => WorkbenchCommand;
  readonly createSetModeCommand: (
    mode: MediaSubtitleDisplayMode,
  ) => WorkbenchCommand;
  readonly createRetryCommand: () => WorkbenchCommand;
  readonly isSetModeResult: (value: unknown) => boolean;
  readonly isSnapshot: (value: unknown) => value is MediaSubtitleSnapshot;
  readonly isCueFinalPayload: (
    value: unknown,
  ) => value is MediaSubtitleCueFinalPayload;
}

export interface UseMediaSubtitlesInput {
  readonly resetKey: string;
  readonly initialMode: MediaSubtitleDisplayMode;
  readonly initialSnapshot: MediaSubtitleSnapshot;
  readonly executeCommand: (
    command: WorkbenchCommand,
  ) => Promise<WorkbenchCommandResult>;
  readonly subscribeEvent?: (
    listener: (event: WorkbenchEvent) => void,
  ) => () => void;
  readonly reportError: (error: unknown, fallback: string) => void;
  readonly protocol: MediaSubtitleProtocol;
  readonly mediaLabel: '视频' | '音频';
}

export interface MediaSubtitleController {
  readonly mode: MediaSubtitleDisplayMode;
  readonly snapshot: MediaSubtitleSnapshot;
  readonly selectMode: (mode: MediaSubtitleDisplayMode) => Promise<void>;
  readonly retry: () => Promise<void>;
}

export function useMediaSubtitles({
  resetKey,
  initialMode,
  initialSnapshot,
  executeCommand,
  subscribeEvent,
  reportError,
  protocol,
  mediaLabel,
}: UseMediaSubtitlesInput): MediaSubtitleController {
  const [mode, setMode] = useState(initialMode);
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    setMode(initialMode);
    setSnapshot(initialSnapshot);
  }, [initialMode, initialSnapshot, resetKey]);

  useEffect(() => {
    if (!subscribeEvent) {
      throw new Error(`${mediaLabel} Workbench 缺少异步事件通道`);
    }
    let disposed = false;
    let receivedEvent = false;
    const unsubscribe = subscribeEvent((event) => {
      if (
        event.type === protocol.snapshotEventType &&
        protocol.isSnapshot(event.payload)
      ) {
        receivedEvent = true;
        setSnapshot(event.payload);
      } else if (
        event.type === protocol.cueFinalEventType &&
        protocol.isCueFinalPayload(event.payload)
      ) {
        receivedEvent = true;
        const payload = event.payload;
        setSnapshot((current) =>
          applyMediaSubtitleCueFinal(current, payload),
        );
      }
    });

    void executeCommand(protocol.createGetSnapshotCommand())
      .then((result) => {
        if (disposed || receivedEvent) return;
        if (!protocol.isSnapshot(result.payload)) {
          throw new Error(`${mediaLabel} Workbench 字幕状态响应无效`);
        }
        setSnapshot(result.payload);
      })
      .catch((error: unknown) => {
        if (!disposed) reportError(error, '无法同步字幕状态。');
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [executeCommand, mediaLabel, protocol, reportError, resetKey, subscribeEvent]);

  const selectMode = useCallback(
    async (nextMode: MediaSubtitleDisplayMode) => {
      const previous = mode;
      setMode(nextMode);
      try {
        const result = await executeCommand(
          protocol.createSetModeCommand(nextMode),
        );
        if (!protocol.isSetModeResult(result.payload)) {
          throw new Error(`${mediaLabel} Workbench 字幕设置响应无效`);
        }
      } catch (error) {
        setMode(previous);
        reportError(error, '无法切换字幕显示方式。');
      }
    },
    [executeCommand, mediaLabel, mode, protocol, reportError],
  );

  const retry = useCallback(async () => {
    try {
      await executeCommand(protocol.createRetryCommand());
    } catch (error) {
      reportError(error, '无法重新处理字幕。');
    }
  }, [executeCommand, protocol, reportError]);

  const effectiveMode =
    snapshot.source?.language === 'unknown' &&
    (mode === 'translated' || mode === 'bilingual')
      ? 'source'
      : mode;
  return { mode: effectiveMode, snapshot, selectMode, retry };
}
