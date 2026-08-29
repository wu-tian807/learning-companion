import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateAttachmentWithContentInput } from '../../../main/attachments/attachment-service';

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
    readonly question?: string;
    readonly commitAnswer?: boolean;
    readonly conversationId?: string;
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
      conversationId: input.conversationId ?? 'conversation-1',
      question: input.question ?? '解释这里',
      ...(selection ? { context: selection } : {}),
      commitAnswer: input.commitAnswer ?? false,
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
    readonly touchAssetOnCreate?: boolean;
  } = {},
) {
  const close = vi.fn(async () => undefined);
  let assetUpdatedTime = 100;
  const asset = {
    id: 'asset-1',
    projectId: 'project-1',
    mediaType: 'video/mp4',
    updatedTime: 100,
  };
  const assets = {
    get: vi.fn(() => ({
      ...asset,
      updatedTime: assetUpdatedTime,
    })),
    resolveContent: vi.fn(async () => ({
      contentStatus: {
        availability: input.availability ?? 'available',
        checkedTime: 1,
      },
      observedUpdatedTime: Number(input.currentRevision ?? '100'),
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
  const attachments = {
    listByAsset: vi.fn(async () => []),
    createWithContent: vi.fn(
      async (request: CreateAttachmentWithContentInput) => {
        if (input.touchAssetOnCreate) assetUpdatedTime = 999;
        return {
          id: 'attachment-1',
          projectId: request.projectId,
          assetId: request.assetId,
          typeId: request.typeId,
          typeVersion: request.typeVersion,
          target: request.target,
          metadata: request.metadata,
          content: {
            ref: {
              kind: 'local-file' as const,
              base: 'project-workspace' as const,
              path:
                '.learning-companion/attachments/attachment-1/answer.md',
            },
            mediaType: request.content.mediaType,
          },
          createdTime: 1,
          updatedTime: 1,
        };
      },
    ),
  };
  return {
    provider: new VideoConversationContextProvider(
      assets as never,
      attachments as never,
      runtime as never,
      projects as never,
      { read: readSubtitles } as never,
      { run } as never,
    ),
    assets,
    attachments,
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

  it('stores the initial frame question as one revision-bound Attachment and reuses it on replay', async () => {
    const { provider, attachments } = setup();
    const context = processContext('C:\\workspace', {
      question: '这段代码在做什么？',
      commitAnswer: true,
    });

    await expect(
      provider.commitAnswer(context, { answer: '它在更新模型参数。' }),
    ).resolves.toEqual({ attachmentId: 'attachment-1' });
    expect(attachments.createWithContent).toHaveBeenCalledWith(
      expect.objectContaining({
        target,
        metadata: {
          format: 'learning-companion/video-explanation',
          version: 1,
          sourceRevision: '100',
          question: '这段代码在做什么？',
          conversationId: 'conversation-1',
        },
        content: expect.objectContaining({
          mediaType: 'text/markdown',
          data: '它在更新模型参数。\n',
        }),
      }),
    );

    attachments.listByAsset.mockResolvedValueOnce([
      {
        id: 'attachment-existing',
        typeId: 'video.ai-explanation',
        typeVersion: 1,
        target,
        metadata: {
          format: 'learning-companion/video-explanation',
          version: 1,
          sourceRevision: '100',
          question: '这段代码在做什么？',
          conversationId: 'conversation-1',
        },
        content: { mediaType: 'text/markdown' },
      },
    ] as never);
    await expect(
      provider.commitAnswer(context, { answer: '重复执行' }),
    ).resolves.toEqual({ attachmentId: 'attachment-existing' });
    expect(attachments.createWithContent).toHaveBeenCalledOnce();
  });

  it('does not deduplicate a different question at the same video anchor', async () => {
    const { provider, attachments } = setup();
    attachments.listByAsset.mockResolvedValueOnce([
      {
        id: 'attachment-existing',
        typeId: 'video.ai-explanation',
        typeVersion: 1,
        target,
        metadata: {
          format: 'learning-companion/video-explanation',
          version: 1,
          sourceRevision: '100',
          question: '原来的问题',
          conversationId: 'conversation-1',
        },
        content: { mediaType: 'text/markdown' },
      },
    ] as never);

    await provider.commitAnswer(
      processContext('C:\\workspace', {
        question: '新的问题',
        commitAnswer: true,
      }),
      { answer: '新的回答' },
    );

    expect(attachments.createWithContent).toHaveBeenCalledOnce();
  });

  it('does not reuse a marker created by another conversation', async () => {
    const { provider, attachments } = setup();
    attachments.listByAsset.mockResolvedValueOnce([
      {
        id: 'attachment-existing',
        typeId: 'video.ai-explanation',
        typeVersion: 1,
        target,
        metadata: {
          format: 'learning-companion/video-explanation',
          version: 1,
          sourceRevision: '100',
          question: '解释这里',
          conversationId: 'conversation-1',
        },
        content: { mediaType: 'text/markdown' },
      },
    ] as never);

    await provider.commitAnswer(
      processContext('C:\\workspace', {
        commitAnswer: true,
        conversationId: 'conversation-2',
      }),
      { answer: '另一个对话的回答' },
    );

    expect(attachments.createWithContent).toHaveBeenCalledOnce();
  });

  it('keeps the frame revision valid when saving an Attachment only touches Asset activity', async () => {
    await withDirectory(async (directory) => {
      const { provider, assets } = setup({ touchAssetOnCreate: true });
      const context = processContext(directory, {
        question: '解释这个区域',
        commitAnswer: true,
      });

      await expect(
        provider.commitAnswer(context, { answer: '区域解释' }),
      ).resolves.toEqual({ attachmentId: 'attachment-1' });
      expect(assets.get()).toMatchObject({ updatedTime: 999 });

      await expect(provider.prepare(context)).resolves.toMatchObject({
        purpose: 'video-frame-conversation',
      });
    });
  });

  it('refuses to attach an answer after the video revision changed', async () => {
    const { provider, attachments } = setup({ currentRevision: '101' });

    await expect(
      provider.commitAnswer(
        processContext('C:\\workspace', { commitAnswer: true }),
        { answer: '过期回答' },
      ),
    ).rejects.toMatchObject({ code: 'CONTENT_CHANGED_EXTERNALLY' });
    expect(attachments.createWithContent).not.toHaveBeenCalled();
  });
});
