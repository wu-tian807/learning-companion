import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isAgentFunctionToolContentResult,
  type AgentFunctionToolExecutionContext,
} from '../../../main/agents/function-tools/agent-function-tool';
import { ExternalCommandRunner } from '../../../main/external-libraries/external-command-runner';
import type {
  MediaSubtitleRuntime,
  MediaSubtitleRuntimeResolverApi,
} from '../../media-subtitles/external-libraries/media-subtitle-runtime';
import { createVideoFunctionTool } from './video-function-tool';

const ffmpegPath = process.env.LC_VIDEO_TOOL_TEST_FFMPEG;
const ffprobePath = process.env.LC_VIDEO_TOOL_TEST_FFPROBE;
const enabled =
  process.platform === 'win32' &&
  typeof ffmpegPath === 'string' &&
  isAbsolute(ffmpegPath) &&
  typeof ffprobePath === 'string' &&
  isAbsolute(ffprobePath);

function executionContext(
  workspacePath: string,
): AgentFunctionToolExecutionContext {
  return {
    taskId: 'video-tool-integration',
    projectId: 'project',
    workspaces: {
      primary: {
        key: 'generation-mindmap',
        instanceKey: 'video-tool-integration',
        path: workspacePath,
        permissions: { read: true, write: false },
      },
      secondary: [],
    },
  };
}

describe.skipIf(!enabled)('workspace video tool Windows integration', () => {
  it(
    'inspects and renders a real generated MP4 through ffprobe and ffmpeg',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'lc-video-tool-real-'));

      try {
        const inputPath = join(directory, 'fixture.mp4');
        const commands = new ExternalCommandRunner();
        await commands.run({
          command: resolve(ffmpegPath!),
          args: [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            'color=c=blue:s=320x180:d=2',
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=1000:duration=2',
            '-shortest',
            '-c:v',
            'mpeg4',
            '-c:a',
            'aac',
            '-y',
            inputPath,
          ],
          timeoutMs: 60_000,
        });
        const runtime: MediaSubtitleRuntime = {
          decoder: {
            ffmpegPath: resolve(ffmpegPath!),
            ffprobePath: resolve(ffprobePath!),
          },
          transcription: {
            kind: 'sensevoice',
            executablePath: 'unused',
            vadExecutablePath: 'unused',
            modelPath: 'unused',
            vadModelPath: 'unused',
          },
          speakerDiarization: {
            executablePath: 'unused',
            segmentationModelPath: 'unused',
            embeddingModelPath: 'unused',
          },
        };
        const resolver = {
          withRuntime: async (
            _signal: AbortSignal | undefined,
            operation: (
              activeRuntime: MediaSubtitleRuntime,
              signal: AbortSignal,
            ) => Promise<unknown>,
          ) => operation(runtime, new AbortController().signal),
        } as unknown as MediaSubtitleRuntimeResolverApi;
        const tool = createVideoFunctionTool(resolver, { commands });
        const inspected = await tool.execute(
          { operation: 'inspect', path: 'fixture.mp4' },
          executionContext(directory),
        );
        const rendered = await tool.execute(
          {
            operation: 'render_frames',
            path: 'fixture.mp4',
            timestampsSeconds: [1],
          },
          executionContext(directory),
        );

        expect(inspected).toEqual(expect.stringContaining('duration'));
        expect(isAgentFunctionToolContentResult(rendered)).toBe(true);
        if (!isAgentFunctionToolContentResult(rendered)) {
          throw new Error('Expected a model-visible video frame');
        }
        expect(rendered.items.some(({ type }) => type === 'image')).toBe(true);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
