import { describe, expect, it, vi } from 'vitest';

import { createAbsoluteLocalFileContentRef } from '../../main/content/content-ref';
import { createAssetSnapshot } from '../../main/assets/asset';
import { WorkbenchActionRegistry } from '../../main/workbench/workbench-action-registry';
import { MIND_MAP_ASSET_MEDIA_TYPE } from '../../shared/asset-media-types';
import { createDraftLearningOutline } from './shared';
import { learningOutlineActions } from './shared';
import type { LearningOutlineServiceApi } from './service/learning-outline-service';
import { LearningOutlineWorkbenchProvider } from './main';
import { learningOutlineMainWorkbenchContribution } from './main-contribution';

describe('LearningOutlineWorkbenchProvider', () => {
  it('starts brief recovery before opening a draft', async () => {
    const document = createDraftLearningOutline('学习目标', 100);
    const service = {
      subscribe: vi.fn(() => () => undefined),
      startBriefMonitor: vi.fn(async () => undefined),
      readDocument: vi.fn(async () => document),
      getBriefState: vi.fn(() => ({ valid: false })),
    } as unknown as LearningOutlineServiceApi;
    const provider = new LearningOutlineWorkbenchProvider(service);

    const opened = await provider.open({
      asset: {
        id: 'outline-1',
        projectId: 'project-1',
        name: '学习目标',
        mediaType: 'application/vnd.learning-companion.learning-outline',
        creationKind: 'generated',
        contentRef: { kind: 'project-workspace', path: 'outline.outline' },
        createdTime: 100,
        updatedTime: 100,
      },
      selectionReason: 'matched',
    } as never);

    expect(service.startBriefMonitor).toHaveBeenCalledWith(
      'project-1',
      'outline-1',
    );
    expect(opened.payload).toMatchObject({ document, brief: { valid: false } });
  });

  it('forwards brief changes only while the matching session is open', async () => {
    const document = createDraftLearningOutline('学习目标', 100);
    let listener: ((event: never) => void) | undefined;
    const service = {
      subscribe: vi.fn((next: (event: never) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
      startBriefMonitor: vi.fn(async () => undefined),
      readDocument: vi.fn(async () => document),
      getBriefState: vi.fn(() => ({ valid: false })),
    } as unknown as LearningOutlineServiceApi;
    const publish = vi.fn();
    const provider = new LearningOutlineWorkbenchProvider(service, { publish } as never);
    const context = {
      sessionId: 'session-1',
      asset: {
        id: 'outline-1',
        projectId: 'project-1',
        name: '学习目标',
        mediaType: 'application/vnd.learning-companion.learning-outline',
        creationKind: 'generated',
        contentRef: { kind: 'project-workspace', path: 'outline.outline' },
        createdTime: 100,
        updatedTime: 100,
      },
      selectionReason: 'matched',
    } as never;

    await provider.open(context);
    listener?.({
      type: 'brief-changed',
      projectId: 'project-1',
      assetId: 'outline-1',
      state: { valid: true, ready: true, revision: 'r1' },
    } as never);
    expect(publish).toHaveBeenCalledWith({
      sessionId: 'session-1',
      type: 'brief-changed',
      payload: expect.objectContaining({ assetId: 'outline-1' }),
    });

    await provider.close(context);
    expect(listener).toBeUndefined();
  });
});

describe('Learning Outline contribution lifecycle', () => {
  it('creates the draft Asset and bound intake conversation through its action', async () => {
    const asset = createAssetSnapshot({
      id: 'outline-1',
      projectId: 'project-1',
      name: '学习大纲',
      mediaType: 'application/vnd.learning-companion.learning-outline',
      creationKind: 'generated',
      contentRef: createAbsoluteLocalFileContentRef('/tmp/outline.outline'),
      createdTime: 1,
      updatedTime: 1,
    });
    const sourceAsset = createAssetSnapshot({
      id: 'mindmap-1',
      projectId: 'project-1',
      name: '知识导图',
      mediaType: MIND_MAP_ASSET_MEDIA_TYPE,
      creationKind: 'generated',
      contentRef: createAbsoluteLocalFileContentRef('/tmp/mindmap.json'),
      createdTime: 1,
      updatedTime: 1,
    });
    const pdfAsset = createAssetSnapshot({
      id: 'pdf-1',
      projectId: 'project-1',
      name: '课程讲义.pdf',
      mediaType: 'application/pdf',
      creationKind: 'imported',
      contentRef: createAbsoluteLocalFileContentRef('/tmp/lesson.pdf'),
      createdTime: 1,
      updatedTime: 1,
    });
    const conversation = {
      id: 'conversation-1',
      modeId: 'learning-outline.intake',
      boundAssetId: 'outline-1',
      title: '新对话',
      messages: [],
      createdTime: 1,
      updatedTime: 1,
    };
    const dependencies = {
      associationService: { ensureReference: vi.fn() },
      assetService: {
        get: vi.fn((assetId: string) =>
          assetId === sourceAsset.id
            ? sourceAsset
            : assetId === pdfAsset.id
              ? pdfAsset
              : undefined,
        ),
        stageGeneratedFile: vi.fn(async () => ({ asset, created: true })),
        delete: vi.fn(async () => undefined),
      },
      attachmentService: {},
      projectConversationService: {
        getOrCreateBoundConversation: vi.fn(() => conversation),
        requireBoundConversation: vi.fn(() => conversation),
      },
      projectLookup: { get: vi.fn(() => ({ id: 'project-1' })) },
      agentWorkspaces: {},
    };
    const provider = learningOutlineMainWorkbenchContribution.createProvider?.({
      ...dependencies,
      artifactRegistry: {},
      artifactService: {},
      contentResourceService: {},
      externalLibraryService: {},
      generationTasks: {},
      stateDatabase: {},
      stateDataDatabase: {},
      sandboxFrameScripts: {},
      workbenchEvents: {},
    } as never);
    const actions = new WorkbenchActionRegistry();
    const feature = learningOutlineMainWorkbenchContribution.features?.find(
      ({ registerActions }) => registerActions,
    );
    feature?.registerActions?.({
      actions,
      provider,
    });

    await expect(
      actions.invoke(learningOutlineActions.createDraft, 'project-1', {
        title: '机器学习路线',
        sourceAssetIds: [sourceAsset.id],
      }),
    ).resolves.toMatchObject({
      asset: { id: 'outline-1' },
      conversation: { id: 'conversation-1', boundAssetId: 'outline-1' },
    });
    expect(dependencies.assetService.stageGeneratedFile).toHaveBeenCalledOnce();
    expect(
      dependencies.projectConversationService.getOrCreateBoundConversation,
    ).toHaveBeenCalledWith('project-1', 'outline-1', 'learning-outline.intake');
    await expect(
      actions.invoke(learningOutlineActions.createDraft, 'project-1', {
        sourceAssetIds: [pdfAsset.id],
      }),
    ).rejects.toThrow('ASSET_NOT_FOUND');
    await expect(
      actions.invoke(learningOutlineActions.createDraft, 'project-1', {
        sourceAssetIds: [],
      }),
    ).rejects.toThrow('INVALID_IPC_REQUEST');
  });

  it('owns the service shutdown and disposal through the contribution runtime', async () => {
    const provider = learningOutlineMainWorkbenchContribution.createProvider?.({
      associationService: {} as never,
      assetService: {} as never,
      artifactRegistry: {} as never,
      artifactService: {} as never,
      contentResourceService: {} as never,
      externalLibraryService: {} as never,
      generationTasks: {} as never,
      attachmentService: {} as never,
      projectConversationService: {} as never,
      agentWorkspaces: {} as never,
      projectLookup: {} as never,
      stateDatabase: {} as never,
      stateDataDatabase: {} as never,
      sandboxFrameScripts: {} as never,
      workbenchEvents: {} as never,
    });
    expect(provider).toBeDefined();

    const service = (provider as LearningOutlineWorkbenchProvider)
      .learningOutlineService;
    const shutdown = vi.spyOn(service, 'shutdown');
    const dispose = vi.spyOn(service, 'dispose');
    const runtime = learningOutlineMainWorkbenchContribution.start?.({
      provider,
    } as never);

    expect(runtime).toBeDefined();
    await runtime!.shutdown?.();
    runtime!.dispose();

    expect(shutdown).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
