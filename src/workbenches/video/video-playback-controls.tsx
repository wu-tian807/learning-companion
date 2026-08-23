const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export function formatVideoTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds))
    : 0;
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const remainder = safeSeconds % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export interface VideoPlaybackControlsProps {
  readonly ready: boolean;
  readonly playing: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly playbackRate: number;
  readonly onTogglePlayback: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onToggleMuted: () => void;
  readonly onVolumeChange: (volume: number) => void;
  readonly onPlaybackRateChange: (rate: number) => void;
  readonly onToggleFullscreen: () => void;
}

export function VideoPlaybackControls({
  ready,
  playing,
  currentTime,
  duration,
  volume,
  muted,
  playbackRate,
  onTogglePlayback,
  onSeek,
  onToggleMuted,
  onVolumeChange,
  onPlaybackRateChange,
  onToggleFullscreen,
}: VideoPlaybackControlsProps) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const current = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  const safeCurrentTime = safeDuration ? Math.min(current, safeDuration) : 0;
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
      data-video-playback-controls="true"
      role="group"
      aria-label="视频播放控件"
      className="flex min-w-0 items-center gap-2 px-3 py-2"
    >
      <button
        type="button"
        aria-label={playing ? '暂停视频' : '播放视频'}
        disabled={!ready}
        onClick={onTogglePlayback}
        className={buttonClass}
      >
        {playing ? '暂停' : '播放'}
      </button>

      <span className="w-[72px] shrink-0 text-center font-mono text-[11px] tabular-nums text-slate-400">
        {formatVideoTime(safeCurrentTime)} / {formatVideoTime(safeDuration)}
      </span>

      <input
        type="range"
        aria-label="视频播放进度"
        min={0}
        max={safeDuration || 1}
        step={0.01}
        value={safeCurrentTime}
        disabled={!ready || safeDuration === 0}
        onChange={(event) =>
          onSeek(Number(event.target.value))
        }
        className="h-1 min-w-16 flex-1 cursor-pointer accent-indigo-400 disabled:cursor-not-allowed disabled:opacity-35"
      />

      <button
        type="button"
        aria-label={muted ? '取消静音' : '静音'}
        disabled={!ready}
      onClick={onToggleMuted}
      className={buttonClass}
    >
        {muted ? '取消静音' : '静音'}
      </button>

      <input
        type="range"
        aria-label="视频音量"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        disabled={!ready}
        onChange={(event) =>
          onVolumeChange(Number(event.target.value))
        }
        className="h-1 w-20 cursor-pointer accent-indigo-400 disabled:cursor-not-allowed disabled:opacity-35"
      />

      <button
        type="button"
        aria-label={`播放速度 ${playbackRate} 倍，点击切换`}
        disabled={!ready}
        onClick={() => onPlaybackRateChange(nextPlaybackRate)}
        className={buttonClass}
      >
        {playbackRate}×
      </button>

      <button
        type="button"
        aria-label="切换全屏"
        disabled={!ready}
        onClick={onToggleFullscreen}
        className={buttonClass}
      >
        全屏
      </button>
    </div>
  );
}
