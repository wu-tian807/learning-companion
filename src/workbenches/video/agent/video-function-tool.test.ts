import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isAgentFunctionToolContentResult,
  type AgentFunctionToolExecutionContext,
} from '../../../main/agents/function-tools/agent-function-tool';
import { AppError } from '../../../main/errors/app-error';
import type { ExternalCommandRunnerApi } from '../../../main/external-libraries/external-command-runner';
import type {
  MediaSubtitleRuntime,
  MediaSubtitleRuntimeResolverApi,
} from '../../media-subtitles/external-libraries/media-subtitle-runtime';
import { createVideoFunctionTool } from './video-function-tool';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function executionContext(
  workspacePath: string,
): AgentFunctionToolExecutionContext {
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    workspaces: {
      primary: {
        key: 'generation-mindmap',
        instanceKey: 'task-1',
        path: workspacePath,
        permissions: { read: true, write: false },
      },
      secondary: [],
    },
  };
}

function runtimeResolver() {
  const runtime: MediaSubtitleRuntime = {
    decoder: {
      ffmpegPath: 'C:\\tools\\ffmpeg.exe',
      ffprobePath: 'C:\\tools\\ffprobe.exe',
    },
    transcription: {
      kind: 'sensevoice',
      profile: 'cpu',
      executablePath: 'unused.exe',
      vadExecutablePath: 'unused-vad.exe',
      modelPath: 'unused.gguf',
      vadModelPath: 'unused-vad.gguf',
      speakerDiarizationExecutablePath: 'unused-diarization.exe',
      speakerSegmentationModelPath: 'unused-segmentation.onnx',
      speakerEmbeddingModelPath: 'unused-embedding.onnx',
    },
  };
  const withRuntime = vi.fn(
    async (
      _signal: AbortSignal | undefined,
      operation: (
        runtime: MediaSubtitleRuntime,
        signal: AbortSignal,
      ) => Promise<unknown>,
    ) => operation(runtime, new AbortController().signal),
  );

  return {
    resolver: {
      requireMediaDecoder: vi.fn(),
      requireTranscription: vi.fn(),
      withRuntime,
    } as unknown as MediaSubtitleRuntimeResolverApi,
    withRuntime,
  };
}

describe('workspace video function tool', () => {
  it('inspects video metadata while holding the media runtime for one call', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lc-workspace-video-'));
    temporaryDirectories.push(root);
    await writeFile(join(root, 'lesson.mp4'), 'video bytes');
    const { resolver, withRuntime } = runtimeResolver();
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async (request) => {
      expect(request.command).toBe('C:\\tools\\ffprobe.exe');
      expect(request.args.at(-1)).toBe(join(root, 'lesson.mp4'));
      return {
        stdout: JSON.stringify({ format: { duration: '12.5' }, streams: [] }),
        stderr: '',
      };
    });
    const tool = createVideoFunctionTool(resolver, {
      commands: { run },
    });

    const result = await tool.execute(
      { operation: 'inspect', path: 'lesson.mp4' },
      executionContext(root),
    );

    expect(result).toEqual(expect.stringContaining('duration'));
    expect(result).toEqual(expect.stringContaining('12.5'));
    expect(withRuntime).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it('renders one model-visible PNG per explicit timestamp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lc-workspace-video-'));
    temporaryDirectories.push(root);
    await writeFile(join(root, 'lesson.mp4'), 'video bytes');
    const { resolver } = runtimeResolver();
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async (request) => {
      const outputPath = request.args.at(-1)!;
      await writeFile(outputPath, Buffer.from([137, 80, 78, 71]));
      return { stdout: '', stderr: '' };
    });
    const tool = createVideoFunctionTool(resolver, {
      commands: { run },
    });

    const result = await tool.execute(
      {
        operation: 'render_frames',
        path: 'lesson.mp4',
        timestampsSeconds: [0, 2.5],
      },
      executionContext(root),
    );

    expect(isAgentFunctionToolContentResult(result)).toBe(true);
    if (!isAgentFunctionToolContentResult(result)) {
      throw new Error('Expected model-visible video frames');
    }
    expect(result.items.filter(({ type }) => type === 'image')).toHaveLength(2);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0].args).toContain('2.500');
  });

  it('does not install a missing media runtime and returns a recoverable model message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lc-workspace-video-'));
    temporaryDirectories.push(root);
    await writeFile(join(root, 'lesson.mp4'), 'video bytes');
    const resolver = {
      withRuntime: vi.fn(async () => {
        throw new AppError('EXTERNAL_LIBRARY_NOT_INSTALLED');
      }),
    } as unknown as MediaSubtitleRuntimeResolverApi;
    const tool = createVideoFunctionTool(resolver, {
      commands: { run: vi.fn() },
    });

    await expect(
      tool.execute(
        { operation: 'inspect', path: 'lesson.mp4' },
        executionContext(root),
      ),
    ).rejects.toThrow('尚未安装');
  });

  it('rejects paths and timestamp batches outside the declared boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lc-workspace-video-'));
    temporaryDirectories.push(root);
    await writeFile(join(root, 'lesson.mp4'), 'video bytes');
    const { resolver } = runtimeResolver();
    const tool = createVideoFunctionTool(resolver, {
      commands: { run: vi.fn() },
    });

    await expect(
      tool.execute(
        { operation: 'inspect', path: '../lesson.mp4' },
        executionContext(root),
      ),
    ).rejects.toThrow('相对路径');
    await expect(
      tool.execute(
        {
          operation: 'render_frames',
          path: 'lesson.mp4',
          timestampsSeconds: [0, 1, 2, 3, 4, 5, 6],
        },
        executionContext(root),
      ),
    ).rejects.toThrow('1 到 6');
  });
});
