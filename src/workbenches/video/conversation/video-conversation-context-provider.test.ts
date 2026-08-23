import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../main/conversation/visual-region-input-preparer', () => ({
  prepareVisualRegionInputs: vi.fn(async () => ({
    overviewPath: 'C:\\prepared\\overview.png',
    markedOverviewPath: 'C:\\prepared\\marked.png',
    cropPath: 'C:\\prepared\\crop.png',
  })),
}));

import { WorkbenchConversationInstruction } from '../../../main/conversation/workbench-conversation-instruction';
import { prepareVisualRegionInputs } from '../../../main/conversation/visual-region-input-preparer';
import { createVideoFrameRegionTarget } from '../shared';
import {
  createVideoConversationContext,
  VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
} from './video-conversation-context';
import { VideoConversationContextProvider } from './video-conversation-context-provider';

const target = createVideoFrameRegionTarget({
  timeSeconds: 12.345,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  sourceWidth: 1920,
  sourceHeight: 1080,
});

async function withDirectory(
  action: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'lc-video-conversation-'));
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function processContext(
  workspacePath: string,
  input: {
    readonly withSelection?: boolean;
    readonly sourceRevision?: string;
    readonly signal?: AbortSignal;
  } = {},
) {
  const selection =
    input.withSelection === false
      ? undefined
      : createVideoConversationContext(target, input.sourceRevision ?? '100');
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    instruction: new WorkbenchConversationInstruction({
      contextProviderId: VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: '解释这里',
      ...(selection ? { context: selection } : {}),
    }),
    workspaces: {
      primary: { path: workspacePath },
      secondary: [],
    },
    assetReferences: {},
    ...(input.signal ? { signal: input.signal } : {}),
    reportStatus: vi.fn(),
  } as never;
}

function setup(
  input: {
    readonly currentRevision?: string;
    readonly availability?: 'available' | 'missing';
    readonly run?: ReturnType<typeof vi.fn>;
    readonly readSubtitles?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const close = vi.fn(async () => undefined);
  const asset = {
    id: 'asset-1',
    projectId: 'project-1',
    mediaType: 'video/mp4',
    updatedTime: 100,
  };
  const assets = {
    get: vi.fn(() => ({
      ...asset,
      updatedTime: Number(input.currentRevision ?? '100'),
    })),
    resolveContent: vi.fn(async () => ({
      contentStatus: {
        availability: input.availability ?? 'available',
        checkedTime: 1,
      },
      ...(input.availability === 'missing'
        ? {}
        : {
            location: {
              kind: 'local-file' as const,
              absolutePath: 'C:\\media\\video.mp4',
            },
          }),
      handle: { close },
    })),
  };
  const runtime = {
    requireMediaDecoder: vi.fn(async () => ({
      ffmpegPath: 'C:\\runtime\\ffmpeg.exe',
      ffprobePath: 'C:\\runtime\\ffprobe.exe',
    })),
  };
  const run = input.run ?? vi.fn(async () => ({ stdout: '', stderr: '' }));
  const projects = {
    get: vi.fn(() => ({
      id: 'project-1',
      workspacePath: 'C:\\projects\\project-1',
    })),
  };
  const readSubtitles = input.readSubtitles ?? vi.fn(async () => undefined);
  return {
    provider: new VideoConversationContextProvider(
      assets as never,
      runtime as never,
      projects as never,
      { read: readSubtitles } as never,
      { run } as never,
    ),
    assets,
    runtime,
    run,
    projects,
    readSubtitles,
    close,
  };
}

describe('Video conversation context provider', () => {
  beforeEach(() => {
    vi.mocked(prepareVisualRegionInputs).mockClear();
  });

  it('extracts one exact frame and supplies overview, marked and crop images', async () => {
    await withDirectory(async (directory) => {
      const { provider, assets, runtime, run, close } = setup();
      const prepared = await provider.prepare(processContext(directory));

      expect(assets.resolveContent).toHaveBeenCalledWith('asset-1');
      expect(runtime.requireMediaDecoder).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'C:\\runtime\\ffmpeg.exe',
          args: expect.arrayContaining([
            '-ss',
            '12.345000',
            '-i',
            'C:\\media\\video.mp4',
            '-frames:v',
            '1',
          ]),
        }),
      );
      expect(prepareVisualRegionInputs).toHaveBeenCalledWith(
        expect.stringMatching(/frame\.png$/u),
        target.anchorPayload,
        expect.stringMatching(/visual-region$/u),
      );
      expect(prepared.userMessage.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'local-image',
            path: 'C:\\prepared\\overview.png',
          }),
          expect.objectContaining({
            type: 'local-image',
            path: 'C:\\prepared\\marked.png',
          }),
          expect.objectContaining({
            type: 'local-image',
            path: 'C:\\prepared\\crop.png',
          }),
        ]),
      );
      expect(prepared.userMessage.content).not.toContainEqual(
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('字幕 Cue'),
        }),
      );
      expect(close).toHaveBeenCalledOnce();
    });
  });

  it('continues the Agent Session without extracting or copying the video again', async () => {
    const { provider, assets, runtime, run, readSubtitles } = setup();
    const prepared = await provider.prepare(
      processContext('C:\\workspace', { withSelection: false }),
    );
    expect(prepared.userMessage.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('同一 Agent Session'),
      }),
    ]);
    expect(assets.resolveContent).not.toHaveBeenCalled();
    expect(runtime.requireMediaDecoder).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(readSubtitles).not.toHaveBeenCalled();
  });

  it('adds nearby original and translated cached subtitles to the frame message', async () => {
    await withDirectory(async (directory) => {
      const readSubtitles = vi.fn(async () => ({
        source: {
          version: 1 as const,
          kind: 'subtitle-source' as const,
          sourceRevision: 'hash-1',
          language: 'en' as const,
          origin: 'asr' as const,
          engine: {
            id: 'whisper',
            version: '1',
            model: 'large-v3-turbo',
            backend: 'cuda',
          },
          generatedTime: 1,
          cues: [
            {
              id: 'cue-1',
              startMs: 11_000,
              endMs: 13_000,
              text: 'Original sentence.',
              sourceCueIds: ['raw-1'],
            },
          ],
        },
        translation: {
          version: 1 as const,
          kind: 'subtitle-translation' as const,
          sourceTrackRevision: 'track-hash-1',
          sourceLanguage: 'en' as const,
          targetLanguage: 'zh-Hans' as const,
          profile: 'quality' as const,
          engine: {
            id: 'hymt',
            version: '1',
            model: 'hymt',
            backend: 'llama.cpp',
          },
          generatedTime: 2,
          cues: [{ sourceCueId: 'cue-1', text: '翻译句子。' }],
        },
      }));
      const { provider } = setup({ readSubtitles });
      const prepared = await provider.prepare(processContext(directory));
      expect(readSubtitles).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: 'asset-1',
          workspacePath: 'C:\\projects\\project-1',
          contentVersion: '100',
        }),
      );
      expect(prepared.userMessage.content).toContainEqual(
        expect.objectContaining({
          type: 'text',
          text: expect.stringMatching(
            /原文（英文）：Original sentence\.[\s\S]*译文（简体中文）：翻译句子。/u,
          ),
        }),
      );
    });
  });

  it('keeps frame Q&A available when optional cached subtitle data is invalid', async () => {
    await withDirectory(async (directory) => {
      const warning = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        const { provider } = setup({
          readSubtitles: vi.fn(async () => {
            throw new Error('invalid subtitle artifact');
          }),
        });
        const prepared = await provider.prepare(processContext(directory));
        expect(prepared.userMessage.content).toContainEqual(
          expect.objectContaining({ type: 'local-image' }),
        );
        expect(warning).toHaveBeenCalledWith(
          '读取视频字幕上下文失败，继续仅分析画面',
          expect.objectContaining({ assetId: 'asset-1' }),
        );
      } finally {
        warning.mockRestore();
      }
    });
  });

  it('rejects stale or unavailable video content and always closes the handle', async () => {
    await withDirectory(async (directory) => {
      const stale = setup({ currentRevision: '101' });
      await expect(
        stale.provider.prepare(processContext(directory)),
      ).rejects.toMatchObject({ code: 'CONTENT_CHANGED_EXTERNALLY' });
      expect(stale.runtime.requireMediaDecoder).not.toHaveBeenCalled();
      expect(stale.close).toHaveBeenCalledOnce();

      const missing = setup({ availability: 'missing' });
      await expect(
        missing.provider.prepare(processContext(directory)),
      ).rejects.toMatchObject({ code: 'ASSET_UNAVAILABLE' });
      expect(missing.runtime.requireMediaDecoder).not.toHaveBeenCalled();
      expect(missing.close).toHaveBeenCalledOnce();
    });
  });

  it('forwards cancellation to frame extraction and stops before image preparation', async () => {
    await withDirectory(async (directory) => {
      const controller = new AbortController();
      const run = vi.fn(async (request: { readonly signal?: AbortSignal }) => {
        expect(request.signal).toBe(controller.signal);
        controller.abort();
        return { stdout: '', stderr: '' };
      });
      const { provider, close } = setup({ run });
      await expect(
        provider.prepare(
          processContext(directory, { signal: controller.signal }),
        ),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(prepareVisualRegionInputs).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
    });
  });
});
