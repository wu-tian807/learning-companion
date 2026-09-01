import type { ExternalCommandRunnerApi } from '../../main/external-libraries/external-command-runner';
import type { SubtitleSpeakerSegmentV1 } from './contracts';
import type { SpeakerDiarizationRuntime } from './external-libraries/media-subtitle-runtime';
import { parseSherpaSpeakerDiarization } from './transcription-output-adapter';

const PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

export async function analyzeMediaSpeakers(input: {
  readonly runtime: SpeakerDiarizationRuntime;
  readonly audioPath: string;
  readonly commandRunner: ExternalCommandRunnerApi;
  readonly logicalCpuCount: number;
  readonly signal: AbortSignal;
}): Promise<readonly SubtitleSpeakerSegmentV1[]> {
  const threads = Math.max(1, Math.floor(input.logicalCpuCount / 2));
  const result = await input.commandRunner.run({
    command: input.runtime.executablePath,
    args: [
      '--clustering.cluster-threshold=0.7',
      `--segmentation.pyannote-model=${input.runtime.segmentationModelPath}`,
      `--embedding.model=${input.runtime.embeddingModelPath}`,
      `--segmentation.num-threads=${threads}`,
      `--embedding.num-threads=${threads}`,
      input.audioPath,
    ],
    timeoutMs: PROCESS_TIMEOUT_MS,
    signal: input.signal,
    outputLimit: 1024 * 1024,
  });
  return parseSherpaSpeakerDiarization(`${result.stdout}\n${result.stderr}`);
}
