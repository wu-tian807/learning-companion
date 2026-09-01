import {
  lstat,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  AgentFunctionToolExecutionError,
  type AgentFunctionToolContentResult,
  type AgentFunctionToolDefinition,
  type AgentFunctionToolExecutionContext,
} from '../../../main/agents/function-tools/agent-function-tool';
import {
  optionalWorkspaceToolString,
  requireWorkspaceToolObject,
  resolveReadableWorkspaceToolPath,
} from '../../../main/agents/function-tools/workspace/workspace-tool-paths';
import { AppError } from '../../../main/errors/app-error';
import {
  ExternalCommandRunner,
  type ExternalCommandRunnerApi,
} from '../../../main/external-libraries/external-command-runner';
import type { MediaSubtitleRuntimeResolverApi } from '../../media-subtitles/external-libraries/media-subtitle-runtime';

export const VIDEO_READ_FUNCTION_TOOL_ID = 'workspace_read_video';

const supportedVideoExtensions = new Set([
  '.mp4',
  '.webm',
  '.ogg',
  '.ogv',
  '.mov',
  '.m4v',
]);
const maximumFramesPerCall = 6;
const maximumTimestampSeconds = 7 * 24 * 60 * 60;

type VideoOperation = 'inspect' | 'render_frames';

export interface VideoFunctionToolDependencies {
  readonly commands: ExternalCommandRunnerApi;
}

function requireOperation(
  input: Readonly<Record<string, unknown>>,
): VideoOperation {
  const operation = optionalWorkspaceToolString(input, 'operation');

  if (operation !== 'inspect' && operation !== 'render_frames') {
    throw new AgentFunctionToolExecutionError(
      'operation 必须是 inspect 或 render_frames。',
    );
  }

  return operation;
}

function requireTimestamps(
  input: Readonly<Record<string, unknown>>,
): readonly number[] {
  const value = input.timestampsSeconds;

  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maximumFramesPerCall ||
    value.some(
      (timestamp) =>
        typeof timestamp !== 'number' ||
        !Number.isFinite(timestamp) ||
        timestamp < 0 ||
        timestamp > maximumTimestampSeconds,
    )
  ) {
    throw new AgentFunctionToolExecutionError(
      `timestampsSeconds 必须包含 1 到 ${maximumFramesPerCall} 个、范围在 0 到 ${maximumTimestampSeconds} 秒的数字。`,
    );
  }

  if (new Set(value).size !== value.length) {
    throw new AgentFunctionToolExecutionError(
      'timestampsSeconds 不能包含重复时间点。',
    );
  }

  return Object.freeze([...value] as number[]);
}

function describeToolFailure(error: unknown): never {
  if (
    error instanceof AgentFunctionToolExecutionError ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    throw error;
  }

  if (
    error instanceof AppError &&
    error.code === 'EXTERNAL_LIBRARY_NOT_INSTALLED'
  ) {
    throw new AgentFunctionToolExecutionError(
      '视频查看组件尚未安装。请先在 Learning Companion 设置中安装视频/音频字幕组件。',
    );
  }

  throw new AgentFunctionToolExecutionError(
    '视频无法处理；文件可能已损坏、编码不受支持，或请求的时间点超出视频范围。',
  );
}

export function createVideoFunctionTool(
  runtimes: MediaSubtitleRuntimeResolverApi,
  dependencies: Partial<VideoFunctionToolDependencies> = {},
): AgentFunctionToolDefinition {
  const commands = dependencies.commands ?? new ExternalCommandRunner();

  return Object.freeze({
    id: VIDEO_READ_FUNCTION_TOOL_ID,
    version: 1,
    description:
      'Inspect a video or render model-visible frames from explicit timestamps inside an authorized Learning Companion workspace. Start with inspect to learn duration and stream metadata, then use render_frames on a small set of relevant timestamps. Frame sampling does not transcribe speech; read the source Asset artifacts listed beside the video when subtitles are available.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['inspect', 'render_frames'],
          description:
            'inspect returns duration and stream metadata; render_frames returns one visible PNG per requested timestamp.',
        },
        workspaceKey: {
          type: 'string',
          description: 'Workspace key. Omit to use the primary workspace.',
        },
        path: {
          type: 'string',
          description: 'Relative video file path.',
        },
        timestampsSeconds: {
          type: 'array',
          minItems: 1,
          maxItems: maximumFramesPerCall,
          uniqueItems: true,
          items: {
            type: 'number',
            minimum: 0,
            maximum: maximumTimestampSeconds,
          },
          description:
            'Required by render_frames. Explicit video timestamps in seconds, with at most 6 frames per call.',
        },
      },
      required: ['operation', 'path'],
      additionalProperties: false,
    },
    deferLoading: true,
    async execute(
      value: JsonValue,
      context: AgentFunctionToolExecutionContext,
    ) {
      const input = requireWorkspaceToolObject(value);
      const operation = requireOperation(input);
      const target = await resolveReadableWorkspaceToolPath(context, input);
      const stats = await lstat(target.absolutePath);

      if (
        !stats.isFile() ||
        !supportedVideoExtensions.has(
          extname(target.relativePath).toLocaleLowerCase('en-US'),
        )
      ) {
        throw new AgentFunctionToolExecutionError(
          'workspace_read_video 的 path 必须指向受支持的视频文件。',
        );
      }

      try {
        if (operation === 'inspect') {
          return await runtimes.withRuntime(
            context.signal,
            async (runtime, signal) => {
              const result = await commands.run({
                command: runtime.decoder.ffprobePath,
                args: [
                  '-v',
                  'error',
                  '-show_entries',
                  'format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels',
                  '-of',
                  'json',
                  target.absolutePath,
                ],
                timeoutMs: 30_000,
                signal,
              });
              let metadata: unknown;

              try {
                metadata = JSON.parse(result.stdout);
              } catch {
                throw new AgentFunctionToolExecutionError(
                  '视频元数据无法解析。',
                );
              }

              return [
                `workspace=${target.workspace.key} path=${target.relativePath} operation=inspect`,
                JSON.stringify(metadata, undefined, 2),
              ].join('\n');
            },
          );
        }

        const timestamps = requireTimestamps(input);
        return await runtimes.withRuntime(
          context.signal,
          async (runtime, signal) => {
            const directory = await mkdtemp(
              join(tmpdir(), 'learning-companion-video-tool-'),
            );

            try {
              const items: AgentFunctionToolContentResult['items'][number][] = [
                {
                  type: 'text',
                  text: `workspace=${target.workspace.key} path=${target.relativePath} operation=render_frames frames=${timestamps.length}`,
                },
              ];

              for (const [index, timestamp] of timestamps.entries()) {
                signal.throwIfAborted();
                const outputPath = join(
                  directory,
                  `frame-${String(index + 1).padStart(4, '0')}.png`,
                );
                await commands.run({
                  command: runtime.decoder.ffmpegPath,
                  args: [
                    '-nostdin',
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-ss',
                    timestamp.toFixed(3),
                    '-i',
                    target.absolutePath,
                    '-map',
                    '0:v:0',
                    '-frames:v',
                    '1',
                    '-vf',
                    'scale=1600:1600:force_original_aspect_ratio=decrease',
                    '-an',
                    '-sn',
                    '-dn',
                    '-y',
                    outputPath,
                  ],
                  timeoutMs: 60_000,
                  signal,
                });
                signal.throwIfAborted();
                const image = await readFile(outputPath);
                items.push(
                  {
                    type: 'text',
                    text: `--- timestamp ${timestamp.toFixed(3)}s ---`,
                  },
                  {
                    type: 'image',
                    url: `data:image/png;base64,${image.toString('base64')}`,
                  },
                );
              }

              return { kind: 'content' as const, items };
            } finally {
              await rm(directory, { recursive: true, force: true });
            }
          },
        );
      } catch (error) {
        return describeToolFailure(error);
      }
    },
  });
}
