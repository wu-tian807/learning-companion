import { SelectMenu } from '../../renderer/components/SelectMenu';
import type {
  VideoDubbingSnapshot,
  VideoSubtitleDisplayMode,
  VideoSubtitleSnapshot,
} from './shared';
import { isVideoDubbingPlaybackAvailable } from './dubbing/video-dubbing-playback';

const ALL_SUBTITLE_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'source', label: '原文' },
  { value: 'translated', label: '译文' },
  { value: 'bilingual', label: '双语' },
] as const;

const SOURCE_ONLY_SUBTITLE_OPTIONS = ALL_SUBTITLE_OPTIONS.slice(0, 2);

export interface VideoLanguageControlsProps {
  readonly subtitleMode: VideoSubtitleDisplayMode;
  readonly subtitleSnapshot: VideoSubtitleSnapshot;
  readonly dubbingSnapshot: VideoDubbingSnapshot;
  readonly dubbingEnabled: boolean;
  readonly dubbingPlaybackActive: boolean;
  readonly onSelectSubtitleMode: (mode: VideoSubtitleDisplayMode) => void;
  readonly onRetrySubtitles: () => void;
  readonly onStartDubbing: () => void;
  readonly onSelectDubbingEnabled: (enabled: boolean) => void;
  readonly onRetryDubbing: () => void;
  readonly onOpenSettings?: () => void;
}

function isSubtitleMode(value: string): value is VideoSubtitleDisplayMode {
  return ALL_SUBTITLE_OPTIONS.some((option) => option.value === value);
}

const compactButtonClass =
  'ui-control h-8 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-[11px] text-slate-300 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-45';

export function VideoLanguageControls({
  subtitleMode,
  subtitleSnapshot,
  dubbingSnapshot,
  dubbingEnabled,
  dubbingPlaybackActive,
  onSelectSubtitleMode,
  onRetrySubtitles,
  onStartDubbing,
  onSelectDubbingEnabled,
  onRetryDubbing,
  onOpenSettings,
}: VideoLanguageControlsProps) {
  const subtitleHasSource = subtitleSnapshot.source !== undefined;
  const subtitleOptions =
    subtitleSnapshot.source?.language === 'unknown'
      ? SOURCE_ONLY_SUBTITLE_OPTIONS
      : ALL_SUBTITLE_OPTIONS;
  const dubbingPlaybackAvailable =
    isVideoDubbingPlaybackAvailable(dubbingSnapshot);
  const dubbingRunning =
    dubbingSnapshot.phase === 'awaiting-translation' ||
    dubbingSnapshot.phase === 'preparing-runtime' ||
    dubbingSnapshot.phase === 'separating' ||
    dubbingSnapshot.phase === 'cloning' ||
    dubbingSnapshot.phase === 'mixing';
  const showTrackSwitch =
    dubbingRunning ||
    dubbingSnapshot.phase === 'ready' ||
    ((dubbingSnapshot.phase === 'interrupted' ||
      dubbingSnapshot.phase === 'failed') &&
      dubbingPlaybackAvailable);

  let subtitleControl;
  if (subtitleSnapshot.phase === 'runtime-required') {
    subtitleControl = (
      <button
        type="button"
        title={subtitleSnapshot.message ?? '需要安装字幕组件'}
        disabled={!onOpenSettings}
        onClick={onOpenSettings}
        className={compactButtonClass}
      >
        安装字幕
      </button>
    );
  } else if (subtitleSnapshot.phase === 'failed') {
    subtitleControl = (
      <button
        type="button"
        title={subtitleSnapshot.message ?? '重新处理字幕'}
        onClick={onRetrySubtitles}
        className={compactButtonClass}
      >
        重试字幕
      </button>
    );
  } else if (!subtitleHasSource) {
    subtitleControl = (
      <button
        type="button"
        title={
          subtitleSnapshot.phase === 'idle'
            ? '字幕尚未开始处理'
            : '正在准备字幕'
        }
        disabled
        className={compactButtonClass}
      >
        字幕准备中
      </button>
    );
  } else {
    subtitleControl = (
      <div className="flex shrink-0 items-center gap-1">
        <span className="shrink-0 text-[11px] text-slate-500">字幕</span>
        <SelectMenu
          ariaLabel="字幕显示模式"
          value={subtitleMode}
          options={subtitleOptions}
          onChange={(value) => {
            if (isSubtitleMode(value)) onSelectSubtitleMode(value);
          }}
          className="w-[112px] shrink-0 whitespace-nowrap"
        />
      </div>
    );
  }

  return (
    <div
      data-video-language-controls="true"
      aria-label="视频字幕与配音"
      className="flex shrink-0 items-center gap-1 border-l border-white/[0.08] px-2"
    >
      {subtitleControl}
      {showTrackSwitch ? (
        <div
          role="group"
          aria-label="视频声音"
          className="flex shrink-0 rounded-lg bg-black/15 p-0.5"
        >
          <button
            type="button"
            aria-pressed={!dubbingEnabled}
            onClick={() => onSelectDubbingEnabled(false)}
            className={`${compactButtonClass} px-2 ${
              !dubbingEnabled ? 'bg-white/[0.08] text-white' : ''
            }`}
          >
            原声
          </button>
          <button
            type="button"
            aria-pressed={dubbingEnabled}
            disabled={!dubbingPlaybackAvailable}
            title={
              dubbingPlaybackAvailable
                ? '播放已经完成的翻译配音段落'
                : '首段配音完成后即可切换'
            }
            onClick={() => onSelectDubbingEnabled(true)}
            className={`${compactButtonClass} px-2 ${
              dubbingEnabled || dubbingPlaybackActive
                ? 'bg-indigo-400/20 text-indigo-100'
                : ''
            }`}
          >
            配音
          </button>
        </div>
      ) : dubbingSnapshot.phase === 'runtime-required' ? (
        <button
          type="button"
          title={dubbingSnapshot.message ?? '需要安装 VoxCPM2 视频配音组件'}
          disabled={!onOpenSettings}
          onClick={onOpenSettings}
          className={compactButtonClass}
        >
          安装配音
        </button>
      ) : dubbingSnapshot.phase === 'unsupported' ? (
        <button
          type="button"
          title={dubbingSnapshot.message ?? '当前设备不支持视频配音'}
          disabled
          className={compactButtonClass}
        >
          配音不可用
        </button>
      ) : dubbingSnapshot.phase !== 'failed' &&
        dubbingSnapshot.phase !== 'interrupted' ? (
        <button
          type="button"
          title="生成翻译配音"
          onClick={onStartDubbing}
          className={compactButtonClass}
        >
          配音
        </button>
      ) : null}
      {(dubbingSnapshot.phase === 'interrupted' ||
        dubbingSnapshot.phase === 'failed') && (
        <button
          type="button"
          title={dubbingSnapshot.message ?? '从持久断点继续生成剩余配音'}
          onClick={onRetryDubbing}
          className={compactButtonClass}
        >
          继续配音
        </button>
      )}
    </div>
  );
}
