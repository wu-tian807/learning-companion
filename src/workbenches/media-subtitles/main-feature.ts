import type { MainWorkbenchContribution } from '../catalog/register-main-workbenches';
import {
  createMediaSubtitleSuiteDefinition,
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
} from './external-libraries/definitions';

export const mediaSubtitlesMainFeature = Object.freeze({
  id: 'builtin.media-subtitles',
  registerExternalLibraries({ libraries, hardware }): void {
    libraries.register(
      createMediaSubtitleSuiteDefinition(
        hardware.nvidiaGpuAvailable
          ? MEDIA_SUBTITLE_NVIDIA_VARIANT_ID
          : MEDIA_SUBTITLE_CPU_VARIANT_ID,
      ),
    );
  },
} satisfies MainWorkbenchContribution);
