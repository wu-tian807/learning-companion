import {
  MediaLanguageControls,
  type MediaLanguageControlsProps,
} from '../media-subtitles/media-language-controls';

export type VideoLanguageControlsProps = Omit<
  MediaLanguageControlsProps,
  'mediaLabel'
>;

export function VideoLanguageControls(props: VideoLanguageControlsProps) {
  return <MediaLanguageControls mediaLabel="视频" {...props} />;
}
