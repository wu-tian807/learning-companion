import {
  MediaPlaybackControls,
  type MediaPlaybackControlsProps,
} from '../../renderer/components/MediaPlaybackControls';
import { formatMediaTime } from '../../renderer/components/media-playback-time';

export const formatVideoTime = formatMediaTime;

export interface VideoPlaybackControlsProps extends Omit<
  MediaPlaybackControlsProps,
  'mediaLabel' | 'fullscreen' | 'onToggleFullscreen'
> {
  readonly fullscreen: boolean;
  readonly onToggleFullscreen: () => void;
}

export function VideoPlaybackControls(props: VideoPlaybackControlsProps) {
  return <MediaPlaybackControls mediaLabel="视频" {...props} />;
}
