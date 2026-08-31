import { SelectMenu } from '../../renderer/components/SelectMenu';
import type {
  MediaSubtitleDisplayMode,
  MediaSubtitleSnapshot,
} from './presentation';
import type { MediaDubbingSnapshot } from '../media-dubbing/contracts';
import { isMediaDubbingPlaybackAvailable } from '../media-dubbing/media-dubbing-playback';
import { resolveMediaDubbingReadiness } from '../media-dubbing/media-dubbing-readiness';

const ALL_SUBTITLE_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'source', label: '原文' },
  { value: 'translated', label: '译文' },
  { value: 'bilingual', label: '双语' },
] as const;

const SOURCE_ONLY_SUBTITLE_OPTIONS = ALL_SUBTITLE_OPTIONS.slice(0, 2);

export interface MediaLanguageControlsProps {
  readonly mediaLabel: '视频' | '音频';
  readonly subtitleMode: MediaSubtitleDisplayMode;
  readonly subtitleSnapshot: MediaSubtitleSnapshot;
  readonly dubbingSnapshot: MediaDubbingSnapshot;
  readonly dubbingEnabled: boolean;
  readonly dubbingPlaybackActive: boolean;
  readonly onSelectSubtitleMode: (mode: MediaSubtitleDisplayMode) => void;
  readonly onRetrySubtitles: () => void;
  readonly onStartDubbing: () => void;
  readonly onSelectDubbingEnabled: (enabled: boolean) => void;
  readonly onRetryDubbing: () => void;
  readonly onOpenSettings?: () => void;
}

function isSubtitleMode(value: string): value is MediaSubtitleDisplayMode {
  return ALL_SUBTITLE_OPTIONS.some((option) => option.value === value);
}

const compactButtonClass =
  'ui-control h-8 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-[11px] text-slate-300 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-45';

export function MediaLanguageControls({
  mediaLabel,
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
}: MediaLanguageControlsProps) {
  const subtitleHasSource = subtitleSnapshot.source !== undefined;
  const subtitleOptions =
    subtitleSnapshot.source?.language === 'unknown'
      ? SOURCE_ONLY_SUBTITLE_OPTIONS
      : ALL_SUBTITLE_OPTIONS;
  const dubbingPlaybackAvailable =
    isMediaDubbingPlaybackAvailable(dubbingSnapshot);
  const dubbingReadiness = resolveMediaDubbingReadiness(
    subtitleSnapshot,
    dubbingSnapshot,
  );
  const dubbingRunning =
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
  } else if (subtitleSnapshot.phase === 'provider-required') {
    subtitleControl = (
      <button
        type="button"
        title={subtitleSnapshot.message ?? '需要配置“低智能”翻译连接'}
        disabled={!onOpenSettings}
        onClick={onOpenSettings}
        className={compactButtonClass}
      >
        配置翻译 AI
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
        {subtitleSnapshot.source?.language === 'unknown' && (
          <span
            title={
              subtitleSnapshot.message ??
              '未检测到明确的中文或英文，因此暂时只提供原文字幕。'
            }
            className="shrink-0 text-[10px] text-amber-200/65"
          >
            仅原文
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      data-media-language-controls="true"
      aria-label={`${mediaLabel}字幕与配音`}
      className="flex shrink-0 items-center gap-1 border-l border-white/[0.08] px-2"
    >
      {subtitleControl}
      {showTrackSwitch ? (
        <div
          role="group"
          aria-label={`${mediaLabel}声音`}
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
      ) : dubbingSnapshot.phase !== 'failed' &&
        dubbingSnapshot.phase !== 'interrupted' ? (
        <span
          className="shrink-0"
          title={
            dubbingReadiness.message ??
            '字幕、译文与 VoxCPM2 配音组件均已就绪。'
          }
        >
          <button
            type="button"
            disabled={!dubbingReadiness.ready}
            onClick={onStartDubbing}
            className={compactButtonClass}
          >
            配音
          </button>
        </span>
      ) : null}
      {(dubbingSnapshot.phase === 'interrupted' ||
        dubbingSnapshot.phase === 'failed') && (
        <span
          className="shrink-0"
          title={
            dubbingReadiness.message ??
            dubbingSnapshot.message ??
            '从持久断点继续生成剩余配音'
          }
        >
          <button
            type="button"
            disabled={!dubbingReadiness.ready}
            onClick={onRetryDubbing}
            className={compactButtonClass}
          >
            继续配音
          </button>
        </span>
      )}
    </div>
  );
}
