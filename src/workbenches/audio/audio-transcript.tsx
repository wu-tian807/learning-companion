import { formatMediaTime } from '../../renderer/components/media-playback-time';
import type {
  AudioSubtitleDisplayMode,
  AudioSubtitleSnapshot,
} from './shared';

export interface AudioTranscriptRow {
  readonly id: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly sourceText: string;
  readonly translatedText?: string;
}

export function resolveAudioTranscriptRows(
  snapshot: AudioSubtitleSnapshot,
): readonly AudioTranscriptRow[] {
  if (!snapshot.source) return [];
  const translations = new Map(
    (snapshot.translation?.cues ?? snapshot.partialTranslations).map((cue) => [
      cue.sourceCueId,
      cue.text,
    ]),
  );
  return snapshot.source.cues.map((cue) => ({
    id: cue.id,
    startSeconds: cue.startMs / 1_000,
    endSeconds: cue.endMs / 1_000,
    sourceText: cue.text,
    translatedText: translations.get(cue.id),
  }));
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

export function AudioTranscript({
  snapshot,
  mode,
  currentTime,
  onSeek,
}: {
  readonly snapshot: AudioSubtitleSnapshot;
  readonly mode: AudioSubtitleDisplayMode;
  readonly currentTime: number;
  readonly onSeek: (seconds: number) => void;
}) {
  const rows = resolveAudioTranscriptRows(snapshot);

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

  const currentMs = currentTime * 1_000;
  return (
    <div
      aria-label="音频逐句字幕"
      className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-5 py-5"
    >
      {snapshot.phase === 'unsupported-language' && (
        <p className="mb-3 rounded-lg border border-amber-200/10 bg-amber-200/[0.04] px-3 py-2 text-[11px] leading-5 text-amber-100/60">
          {snapshot.message ??
            '未检测到明确的中文或英文，本次只显示原文。'}
        </p>
      )}
      <div className="space-y-1.5">
        {rows.map((row) => {
          const active = currentMs >= row.startSeconds * 1_000 &&
            currentMs < row.endSeconds * 1_000;
          return (
            <button
              key={row.id}
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onSeek(row.startSeconds)}
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
        })}
      </div>
    </div>
  );
}
