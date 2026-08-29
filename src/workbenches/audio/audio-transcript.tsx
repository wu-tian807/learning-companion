import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { formatMediaTime } from '../../renderer/components/media-playback-time';
import type {
  AudioSpeakerTrack,
  AudioSubtitleDisplayMode,
  AudioSubtitleSnapshot,
} from './shared';

export interface AudioTranscriptSpeaker {
  readonly id: string;
  readonly label: string;
  readonly status: 'stable' | 'uncertain' | 'unknown';
  readonly referenceMode: 'reference' | 'default';
  readonly referenceStartSeconds?: number;
  readonly referenceEndSeconds?: number;
}

export interface AudioTranscriptRow {
  readonly id: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly sourceText: string;
  readonly translatedText?: string;
  readonly speaker?: AudioTranscriptSpeaker;
}

export interface AudioTranscriptPosition {
  readonly activeRowId?: string;
  readonly locateRowId?: string;
}

const SPEAKER_BADGE_CLASSES = Object.freeze([
  'border-cyan-300/15 bg-cyan-300/[0.07] text-cyan-100/75',
  'border-fuchsia-300/15 bg-fuchsia-300/[0.07] text-fuchsia-100/75',
  'border-amber-300/15 bg-amber-300/[0.07] text-amber-100/75',
  'border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-100/75',
]);

function speakerLabel(speakerId: string): string {
  if (speakerId === 'speaker-unknown') return '未知说话人';
  const match = /^speaker-(\d{4})$/u.exec(speakerId);
  return match ? `说话人 ${Number(match[1])}` : '未知说话人';
}

function speakerBadgeClass(speakerId: string): string {
  const match = /^speaker-(\d{4})$/u.exec(speakerId);
  if (!match) {
    return 'border-slate-300/10 bg-slate-300/[0.05] text-slate-400';
  }
  const index = Math.max(0, Number(match[1]) - 1);
  return SPEAKER_BADGE_CLASSES[index % SPEAKER_BADGE_CLASSES.length]!;
}

function speakerDescription(speaker: AudioTranscriptSpeaker): string {
  const certainty =
    speaker.status === 'uncertain'
      ? '；该句归属不够稳定，不会用作声色参考候选'
      : speaker.status === 'unknown'
        ? '；未识别到可靠说话人'
        : '';
  if (
    speaker.referenceMode === 'reference' &&
    speaker.referenceStartSeconds !== undefined &&
    speaker.referenceEndSeconds !== undefined
  ) {
    return `${speaker.label}${certainty}；声色参考 ${formatMediaTime(
      speaker.referenceStartSeconds,
    )}–${formatMediaTime(speaker.referenceEndSeconds)}`;
  }
  return `${speaker.label}${certainty}；配音使用默认声线`;
}

function speakerReferenceLabel(speaker: AudioTranscriptSpeaker): string {
  if (
    speaker.referenceMode === 'reference' &&
    speaker.referenceStartSeconds !== undefined &&
    speaker.referenceEndSeconds !== undefined
  ) {
    return `参考 ${formatMediaTime(speaker.referenceStartSeconds)}–${formatMediaTime(
      speaker.referenceEndSeconds,
    )}`;
  }
  return '默认声线';
}

export function resolveAudioTranscriptRows(
  snapshot: AudioSubtitleSnapshot,
  speakerTrack?: AudioSpeakerTrack,
): readonly AudioTranscriptRow[] {
  if (!snapshot.source) return [];
  const translations = new Map(
    (snapshot.translation?.cues ?? snapshot.partialTranslations).map((cue) => [
      cue.sourceCueId,
      cue.text,
    ]),
  );
  const assignments = new Map(
    (speakerTrack?.cues ?? []).map((cue) => [cue.sourceCueId, cue]),
  );
  const profiles = new Map(
    (speakerTrack?.profiles ?? []).map((profile) => [
      profile.speakerId,
      profile,
    ]),
  );
  return snapshot.source.cues.map((cue) => {
    const assignment = assignments.get(cue.id);
    const profile = assignment
      ? profiles.get(assignment.speakerId)
      : undefined;
    const speaker = assignment && profile
      ? {
          id: assignment.speakerId,
          label: speakerLabel(assignment.speakerId),
          status: assignment.status,
          referenceMode: profile.mode,
          ...(profile.mode === 'reference'
            ? {
                referenceStartSeconds: profile.referenceStartMs / 1_000,
                referenceEndSeconds: profile.referenceEndMs / 1_000,
              }
            : {}),
        }
      : undefined;
    return {
      id: cue.id,
      startSeconds: cue.startMs / 1_000,
      endSeconds: cue.endMs / 1_000,
      sourceText: cue.text,
      translatedText: translations.get(cue.id),
      ...(speaker ? { speaker } : {}),
    };
  });
}

export function resolveAudioTranscriptPosition(
  rows: readonly AudioTranscriptRow[],
  currentTime: number,
): AudioTranscriptPosition {
  if (rows.length === 0) return Object.freeze({});
  const seconds = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle]!.endSeconds <= seconds) low = middle + 1;
    else high = middle;
  }
  if (low >= rows.length) {
    return Object.freeze({ locateRowId: rows.at(-1)!.id });
  }
  const row = rows[low]!;
  return Object.freeze({
    ...(seconds >= row.startSeconds ? { activeRowId: row.id } : {}),
    locateRowId: row.id,
  });
}

function transcriptStatus(snapshot: AudioSubtitleSnapshot): string {
  if (snapshot.phase === 'runtime-required') {
    return snapshot.message ?? '安装字幕组件后会自动生成逐句文本。';
  }
  if (snapshot.phase === 'failed') {
    return snapshot.message ?? '字幕处理失败，可以从下方重新尝试。';
  }
  if (snapshot.phase === 'unsupported-language') {
    return snapshot.message ?? '当前音频语言暂不支持翻译。';
  }
  return '正在后台识别音频，完成的字幕会自动显示在这里。';
}

const AudioTranscriptRowView = memo(function AudioTranscriptRowView({
  row,
  mode,
  active,
  registerRow,
  onSelect,
}: {
  readonly row: AudioTranscriptRow;
  readonly mode: AudioSubtitleDisplayMode;
  readonly active: boolean;
  readonly registerRow: (id: string, node: HTMLButtonElement | null) => void;
  readonly onSelect: (row: AudioTranscriptRow) => void;
}) {
  const speakerTitle = row.speaker
    ? speakerDescription(row.speaker)
    : undefined;
  return (
    <button
      ref={(node) => registerRow(row.id, node)}
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect(row)}
      className={`ui-control grid w-full grid-cols-[52px_minmax(0,1fr)] gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
        active
          ? 'bg-indigo-400/[0.12] text-slate-100'
          : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
      }`}
    >
      <span className="pt-0.5 font-mono text-[10px] tabular-nums text-slate-600">
        {formatMediaTime(row.startSeconds)}
      </span>
      <span className="min-w-0">
        {row.speaker && (
          <span className="mb-1 flex items-center gap-2 text-[10px] leading-4">
            <span
              title={speakerTitle}
              aria-label={speakerTitle}
              className={`inline-flex rounded-full border px-2 py-0.5 ${speakerBadgeClass(
                row.speaker.id,
              )}`}
            >
              {row.speaker.label}
              {row.speaker.status === 'uncertain' ? ' ?' : ''}
            </span>
            <span className="text-slate-600">
              {speakerReferenceLabel(row.speaker)}
            </span>
          </span>
        )}
        {mode !== 'translated' && (
          <span className="block text-[13px] leading-5">
            {row.sourceText}
          </span>
        )}
        {mode !== 'source' && (
          <span
            className={`block leading-5 ${
              mode === 'bilingual'
                ? 'mt-1 text-[12px] text-indigo-200/70'
                : 'text-[13px]'
            }`}
          >
            {row.translatedText ?? '正在翻译…'}
          </span>
        )}
      </span>
    </button>
  );
});

export function AudioTranscript({
  snapshot,
  mode,
  currentTime,
  speakerTrack,
  onSeek,
}: {
  readonly snapshot: AudioSubtitleSnapshot;
  readonly mode: AudioSubtitleDisplayMode;
  readonly currentTime: number;
  readonly speakerTrack?: AudioSpeakerTrack;
  readonly onSeek: (seconds: number) => void;
}) {
  const rows = useMemo(
    () => resolveAudioTranscriptRows(snapshot, speakerTrack),
    [snapshot, speakerTrack],
  );
  const position = useMemo(
    () => resolveAudioTranscriptPosition(rows, currentTime),
    [currentTime, rows],
  );
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastLocatedRowRef = useRef<string | undefined>(undefined);
  const [followingCurrent, setFollowingCurrent] = useState(true);
  const sourceRevision = snapshot.source?.sourceRevision;

  useEffect(() => {
    setFollowingCurrent(true);
    lastLocatedRowRef.current = undefined;
  }, [sourceRevision]);

  const registerRow = useCallback(
    (id: string, node: HTMLButtonElement | null) => {
      if (node) rowRefs.current.set(id, node);
      else rowRefs.current.delete(id);
    },
    [],
  );

  useEffect(() => {
    if (
      mode === 'off' ||
      !followingCurrent ||
      !position.locateRowId
    ) {
      return;
    }
    const row = rowRefs.current.get(position.locateRowId);
    if (!row) return;
    row.scrollIntoView({
      block: 'center',
      behavior: lastLocatedRowRef.current ? 'smooth' : 'auto',
    });
    lastLocatedRowRef.current = position.locateRowId;
  }, [followingCurrent, mode, position.locateRowId]);

  const stopFollowing = useCallback(() => setFollowingCurrent(false), []);
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'PageDown' ||
        event.key === 'PageUp' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        stopFollowing();
      }
    },
    [stopFollowing],
  );
  const handleSelect = useCallback(
    (row: AudioTranscriptRow) => {
      setFollowingCurrent(true);
      onSeek(row.startSeconds);
    },
    [onSeek],
  );

  if (mode === 'off') {
    return (
      <div className="grid h-full place-items-center px-8 text-center text-xs leading-5 text-slate-600">
        字幕已关闭。音频仍会正常播放。
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div>
          <span className="mx-auto block size-4 animate-pulse rounded-full bg-indigo-300/35" />
          <p className="mt-3 max-w-sm text-xs leading-5 text-slate-500">
            {transcriptStatus(snapshot)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div
        aria-label="音频逐句字幕"
        tabIndex={0}
        onWheelCapture={stopFollowing}
        onTouchStartCapture={stopFollowing}
        onKeyDownCapture={handleKeyDown}
        onPointerDownCapture={(event) => {
          if (event.target === event.currentTarget) stopFollowing();
        }}
        className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-5 py-5 outline-none"
      >
        {snapshot.phase === 'unsupported-language' && (
          <p className="mb-3 rounded-lg border border-amber-200/10 bg-amber-200/[0.04] px-3 py-2 text-[11px] leading-5 text-amber-100/60">
            {snapshot.message ??
              '未检测到明确的中文或英文，本次只显示原文。'}
          </p>
        )}
        <div className="space-y-1.5">
          {rows.map((row) => (
            <AudioTranscriptRowView
              key={row.id}
              row={row}
              mode={mode}
              active={position.activeRowId === row.id}
              registerRow={registerRow}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </div>
      {!followingCurrent && position.locateRowId && (
        <button
          type="button"
          onClick={() => setFollowingCurrent(true)}
          className="ui-control absolute bottom-4 right-5 rounded-full border border-indigo-200/15 bg-[#202632]/95 px-3 py-2 text-[11px] text-indigo-100/80 shadow-lg backdrop-blur"
        >
          定位当前句
        </button>
      )}
    </div>
  );
}
