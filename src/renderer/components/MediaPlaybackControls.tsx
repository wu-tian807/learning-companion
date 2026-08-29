import type { ReactNode } from 'react';
import { formatMediaTime } from './media-playback-time';

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export interface MediaPlaybackControlsProps {
  readonly mediaLabel: '视频' | '音频';
  readonly ready: boolean;
  readonly playing: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly playbackRate: number;
  readonly fullscreen?: boolean;
  readonly generatedSuffixStartSeconds?: number;
  readonly trailingControls?: ReactNode;
  readonly onTogglePlayback: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onToggleMuted: () => void;
  readonly onVolumeChange: (volume: number) => void;
  readonly onPlaybackRateChange: (rate: number) => void;
  readonly onToggleFullscreen?: () => void;
}

export function MediaPlaybackControls({
  mediaLabel,
  ready,
  playing,
  currentTime,
  duration,
  volume,
  muted,
  playbackRate,
  fullscreen,
  generatedSuffixStartSeconds,
  trailingControls,
  onTogglePlayback,
  onSeek,
  onToggleMuted,
  onVolumeChange,
  onPlaybackRateChange,
  onToggleFullscreen,
}: MediaPlaybackControlsProps) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const current = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  const safeCurrentTime = safeDuration ? Math.min(current, safeDuration) : 0;
  const generatedSuffixPercent =
    safeDuration > 0 &&
    generatedSuffixStartSeconds !== undefined &&
    Number.isFinite(generatedSuffixStartSeconds)
      ? (Math.min(safeDuration, Math.max(0, generatedSuffixStartSeconds)) /
          safeDuration) *
        100
      : undefined;
  const nextPlaybackRate =
    PLAYBACK_RATES[
      (PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number]) +
        1) %
        PLAYBACK_RATES.length
    ] ?? 1;
  const buttonClass =
    'ui-control h-8 shrink-0 rounded-lg px-2.5 text-[11px] text-slate-300 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-35';

  return (
    <div
      data-media-playback-controls="true"
      role="group"
      aria-label={`${mediaLabel}播放控件`}
      className="min-w-0"
    >
      <div
        data-media-progress-row="true"
        className="relative px-3 pb-2 pt-2"
      >
        <input
          type="range"
          aria-label={`${mediaLabel}播放进度`}
          min={0}
          max={safeDuration || 1}
          step={0.01}
          value={safeCurrentTime}
          disabled={!ready || safeDuration === 0}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="relative z-10 h-1 w-full cursor-pointer accent-indigo-400 disabled:cursor-not-allowed disabled:opacity-35"
        />
        {generatedSuffixPercent !== undefined && (
          <span
            aria-label="配音已生成区间"
            className="pointer-events-none absolute inset-x-3 bottom-0 z-20 h-1 overflow-visible rounded-full bg-white/[0.08]"
          >
            <span
              className="absolute right-0 top-0 h-1 rounded-full bg-white/85 shadow-[0_0_5px_rgba(255,255,255,0.6)] transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${100 - generatedSuffixPercent}%` }}
            />
            <span
              aria-hidden="true"
              className="absolute top-1/2 h-2 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)] transition-[left] duration-300 motion-reduce:transition-none"
              style={{ left: `${generatedSuffixPercent}%` }}
            />
          </span>
        )}
      </div>

      <div
        data-media-action-row="true"
        className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 pb-2 pt-1"
      >
        <div
          data-media-primary-controls="true"
          className="flex min-w-0 items-center gap-1"
        >
          <button
            type="button"
            aria-label={playing ? `暂停${mediaLabel}` : `播放${mediaLabel}`}
            disabled={!ready}
            onClick={onTogglePlayback}
            className={buttonClass}
          >
            {playing ? '暂停' : '播放'}
          </button>

          <span className="shrink-0 whitespace-nowrap px-1 font-mono text-[11px] tabular-nums text-slate-400">
            {formatMediaTime(safeCurrentTime)} / {formatMediaTime(safeDuration)}
          </span>

          <div
            data-media-volume-controls="true"
            className="group/volume flex shrink-0 items-center"
          >
            <button
              type="button"
              aria-label={muted ? '取消静音' : '静音'}
              disabled={!ready}
              onClick={onToggleMuted}
              className={buttonClass}
            >
              {muted ? '取消静音' : '静音'}
            </button>
            <div
              data-media-volume-slider="true"
              className="w-0 overflow-hidden opacity-0 transition-[width,opacity] duration-150 group-hover/volume:w-16 group-hover/volume:opacity-100 group-focus-within/volume:w-16 group-focus-within/volume:opacity-100 motion-reduce:transition-none"
            >
              <input
                type="range"
                aria-label={`${mediaLabel}音量`}
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                disabled={!ready}
                onChange={(event) =>
                  onVolumeChange(Number(event.target.value))
                }
                className="ml-1 h-1 w-14 cursor-pointer accent-indigo-400 disabled:cursor-not-allowed disabled:opacity-35"
              />
            </div>
          </div>

          <button
            type="button"
            aria-label={`播放速度 ${playbackRate} 倍，点击切换`}
            disabled={!ready}
            onClick={() => onPlaybackRateChange(nextPlaybackRate)}
            className={buttonClass}
          >
            {playbackRate}×
          </button>

          {onToggleFullscreen && (
            <button
              type="button"
              aria-label={fullscreen ? '退出全屏' : '进入全屏'}
              aria-pressed={fullscreen}
              title={fullscreen ? '退出全屏' : '进入全屏'}
              disabled={!ready}
              onClick={onToggleFullscreen}
              className={`${buttonClass} ${
                fullscreen ? 'bg-indigo-400/20 text-indigo-100' : ''
              }`}
            >
              {fullscreen ? '退出' : '全屏'}
            </button>
          )}
        </div>

        {trailingControls && (
          <div data-media-secondary-controls="true" className="shrink-0">
            {trailingControls}
          </div>
        )}
      </div>
    </div>
  );
}
