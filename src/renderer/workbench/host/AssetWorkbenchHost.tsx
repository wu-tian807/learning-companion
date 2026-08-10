import { useCallback, useEffect, useRef, useState } from 'react';

import type { AssetSnapshot } from '../../../shared/assets';
import type { AssetAttachment } from '../../../shared/workbench/attachment';
import { userMessageFromError } from '../../../shared/ipc-error';
import {
  isWorkbenchBootstrap,
  type WorkbenchCommand,
  type WorkbenchCommandResult,
  type WorkbenchBootstrap,
} from '../../../shared/workbench/protocol';
import {
  EMPTY_WORKBENCH_INTERACTION,
  type WorkbenchInteractionSnapshot,
} from '../../../shared/workbench/interaction';
import { registerRendererWorkbenches } from '../../../workbenches/catalog/register-renderer-workbenches';
import { unsupportedRendererWorkbenchModule } from '../../../workbenches/unsupported/renderer';
import { AttachmentHost } from './AttachmentHost';
import { AiChatPanelHost } from '../ai-chat/AiChatPanelHost';
import { getGlobalAiChatStore } from '../ai-chat/chat-store';
import { WorkbenchContextMenuHost } from './WorkbenchContextMenuHost';
import { WorkbenchOverflowHost } from './WorkbenchOverflowHost';
import { WorkbenchViewErrorBoundary } from './WorkbenchViewErrorBoundary';
import {
  assertRendererWorkbenchCompatibility,
  RendererWorkbenchRegistry,
  type RendererWorkbenchModule,
} from '../renderer-workbench-registry';
import { WorkbenchLifecycleCoordinator } from '../workbench-lifecycle';
import { closeWorkbenchSession } from '../workbench-session-cleanup';
import { useWorkbenchRuntime } from '../runtime/workbench-runtime-context';

interface AssetWorkbenchHostProps {
  readonly projectId: string;
  readonly asset: AssetSnapshot | undefined;
  readonly mediaLabel: (mediaType: string) => string;
  readonly onRelink: () => void;
  readonly onRefresh: () => void;
  readonly onReveal: () => Promise<void> | void;
  readonly onOpenSettings: () => void;
  readonly onLifecycleTaskChange: (task: Promise<void>) => void;
  readonly onError: (message: string) => void;
}

type SettledWorkbenchHostState =
  | {
      readonly kind: 'ready';
      readonly assetKey: string;
      readonly bootstrap: WorkbenchBootstrap;
      readonly module: RendererWorkbenchModule;
      readonly executeCommand: (
        command: WorkbenchCommand,
      ) => Promise<WorkbenchCommandResult>;
    }
  | {
      readonly kind: 'failed';
      readonly assetKey: string;
      readonly message: string;
    };

const defaultRegistry = new RendererWorkbenchRegistry(
  unsupportedRendererWorkbenchModule,
);
registerRendererWorkbenches(defaultRegistry);

export function AssetWorkbenchHost({
  projectId,
  asset,
  mediaLabel,
  onRelink,
  onRefresh,
  onReveal,
  onOpenSettings,
  onLifecycleTaskChange,
  onError,
}: AssetWorkbenchHostProps) {
  const runtime = useWorkbenchRuntime();
  const [settledState, setSettledState] =
    useState<SettledWorkbenchHostState>();
  const [attachments, setAttachments] = useState<
    readonly AssetAttachment[]
  >([]);
  const activeSessionIdRef = useRef<string | undefined>(undefined);
  const lifecycleRef = useRef(new WorkbenchLifecycleCoordinator());
  const assetId = asset?.id;
  const checkedTime = asset?.contentStatus.checkedTime;
  const mediaType = asset?.mediaType;
  const assetKey =
    assetId && checkedTime !== undefined && mediaType
      ? `${assetId}:${checkedTime}:${mediaType}`
      : undefined;
  const readySessionId =
    settledState?.kind === 'ready' &&
    settledState.assetKey === assetKey
      ? settledState.bootstrap.sessionId
      : undefined;
  const reportInteraction = useCallback(
    (interaction: WorkbenchInteractionSnapshot) => {
      if (
        !assetId ||
        !readySessionId ||
        activeSessionIdRef.current !== readySessionId
      ) {
        return;
      }

      runtime.publishInteraction(readySessionId, interaction);
    },
    [assetId, readySessionId, runtime],
  );
  const openExternal = useCallback(
    async (url: string) => {
      try {
        await window.learningCompanion.openExternal({ url });
      } catch (openError) {
        const message = userMessageFromError(
          openError,
          '无法打开外部链接。',
        );

        if (message) {
          onError(message);
        }
      }
    },
    [onError],
  );

  const refreshAttachments = useCallback(async () => {
    if (!projectId || !assetId) {
      return;
    }

    try {
      const list =
        await window.learningCompanion.listAttachments({
          projectId,
          assetId,
        });
      setAttachments(list);
    } catch (loadError) {
      const message = userMessageFromError(
        loadError,
        '无法读取文档标注。',
      );
      if (message) {
        console.error(message, loadError);
      }
    }
  }, [assetId, projectId]);

  useEffect(() => {
    if (!readySessionId) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshAttachments();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [readySessionId, refreshAttachments]);

  useEffect(() => {
    let active = true;
    let openedSessionId: string | undefined;
    let commandTail: Promise<void> = Promise.resolve();
    const lease = lifecycleRef.current.acquire();

    onLifecycleTaskChange(lease.completed);

    const closeOpenedSession = async () => {
      const sessionId = openedSessionId;

      if (!sessionId) {
        return;
      }

      openedSessionId = undefined;
      if (activeSessionIdRef.current === sessionId) {
        activeSessionIdRef.current = undefined;
      }
      runtime.publishInteraction(
        sessionId,
        EMPTY_WORKBENCH_INTERACTION,
      );
      // React may run the Host cleanup before the active View cleanup.
      // Yield once so a View can synchronously enqueue its final state command.
      await Promise.resolve();
      await closeWorkbenchSession(
        () => window.learningCompanion.closeWorkbench({ sessionId }),
        commandTail,
      );
      runtime.deactivate(sessionId);
    };
    const reportCloseError = (closeError: unknown) => {
      const message = userMessageFromError(
        closeError,
        '无法正确关闭资料工作台。',
      );
      if (message) {
        console.error(message, closeError);
      }
    };

    const openingTask = (async () => {
      await lease.previous;

      if (!active || !assetId || !assetKey) {
        return;
      }

      try {
        const bootstrap =
          await window.learningCompanion.openWorkbench({ assetId });

        if (!isWorkbenchBootstrap(bootstrap)) {
          throw new Error('Workbench Bootstrap 响应无效');
        }

        openedSessionId = bootstrap.sessionId;
        const module = await defaultRegistry.resolve(
          bootstrap.workbenchId,
        );

        assertRendererWorkbenchCompatibility(module, bootstrap);
        const executeCommand = (
          command: WorkbenchCommand,
        ): Promise<WorkbenchCommandResult> => {
          const execution = commandTail.then(() =>
            window.learningCompanion.commandWorkbench({
              sessionId: bootstrap.sessionId,
              command,
            }),
          );
          commandTail = execution.then(
            () => undefined,
            () => undefined,
          );
          return execution;
        };

        if (!active) {
          return;
        }

        runtime.activate(
          {
            projectId,
            assetId,
            workbenchId: bootstrap.workbenchId,
            sessionId: bootstrap.sessionId,
          },
          module.manifest,
        );
        activeSessionIdRef.current = bootstrap.sessionId;
        setSettledState({
          kind: 'ready',
          assetKey,
          bootstrap,
          module,
          executeCommand,
        });
      } catch (openError: unknown) {
        await closeOpenedSession().catch(reportCloseError);

        if (!active) {
          return;
        }

        const message = userMessageFromError(
          openError,
          '无法打开资料工作台，请重试。',
        );

        if (!message) {
          return;
        }

        console.error('打开资料工作台失败', openError);
        setSettledState({ kind: 'failed', assetKey, message });
        onError(message);
      }
    })();

    return () => {
      active = false;
      if (openedSessionId) {
        runtime.publishInteraction(
          openedSessionId,
          EMPTY_WORKBENCH_INTERACTION,
        );
      }
      runtime.closeContextMenu();
      void openingTask
        .then(closeOpenedSession)
        .catch(reportCloseError)
        .finally(() => {
          lease.release();
        });
    };
  }, [
    assetId,
    assetKey,
    onError,
    onLifecycleTaskChange,
    projectId,
    runtime,
  ]);

  const state =
    assetKey === undefined
      ? { kind: 'idle' as const }
      : settledState?.assetKey === assetKey
        ? settledState
        : { kind: 'opening' as const };

  let content = (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <p className="text-sm font-medium text-slate-400">
          选择一份资料开始学习
        </p>
        <p className="mt-2 text-xs text-slate-600">
          资料工作台会显示在这里
        </p>
      </div>
    </div>
  );

  if (asset && state.kind === 'opening') {
    content = (
      <div className="grid h-full place-items-center text-xs text-slate-500">
        正在打开资料工作台…
      </div>
    );
  } else if (asset && state.kind === 'failed') {
    content = (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-rose-300">{state.message}</p>
      </div>
    );
  } else if (asset && state.kind === 'ready') {
    const View = state.module.View;

    content = (
      <div className="relative flex h-full min-h-0 min-w-0 overflow-clip">
        <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
          <WorkbenchViewErrorBoundary onError={onError}>
            <View
              asset={asset}
              bootstrap={state.bootstrap}
              executeCommand={state.executeCommand}
              onRelink={onRelink}
              onRefresh={onRefresh}
              onReveal={onReveal}
              onOpenSettings={onOpenSettings}
              onInteractionChange={reportInteraction}
              onOpenExternal={openExternal}
              onError={onError}
            />
          </WorkbenchViewErrorBoundary>
        </div>
        <AiChatPanelHost
          projectId={projectId}
          assetId={asset.id}
          onAttachAnswer={async (
            _messageId,
            text,
            anchor,
          ) => {
            const session = getGlobalAiChatStore().getSession(asset.id);
            const answerMessage = session?.messages.find(
              (message) => message.id === _messageId,
            );
            const userMessage = session?.messages.find(
              (message) =>
                message.id === answerMessage?.replyToMessageId,
            );

            try {
              const target = anchor?.target ?? {
                scope: 'content' as const,
                anchorType: 'pdf.page' as const,
                anchorVersion: 1,
                anchorPayload: { pageNumber: anchor?.pageNumber ?? 1 },
              };
              await window.learningCompanion.createAttachment({
                projectId,
                assetId: asset.id,
                typeId: 'ai.annotation',
                typeVersion: 1,
                target,
                metadata: {
                  question: userMessage?.content ?? '',
                  answer: answerMessage?.content ?? text,
                  selectedAnswer: text,
                  ...(answerMessage?.modelInfo
                    ? { modelInfo: answerMessage.modelInfo }
                    : {}),
                  timestamp: Date.now(),
                },
              });
              await refreshAttachments();
            } catch (attachError) {
              const message = userMessageFromError(
                attachError,
                '无法保存 AI 标注到文档。',
              );
              if (message) {
                onError(message);
              }
              throw attachError;
            }
          }}
        />
        <AttachmentHost
          attachments={attachments}
          onDeleteAttachment={async (attachmentId) => {
            try {
              await window.learningCompanion.deleteAttachment({
                projectId,
                attachmentId,
              });
              await refreshAttachments();
            } catch (deleteError) {
              const message = userMessageFromError(
                deleteError,
                '无法删除附着内容，请重试。',
              );
              if (message) {
                onError(message);
              }
              throw deleteError;
            }
          }}
        />
      </div>
    );
  }

  return (
    <article
      aria-label="Asset 资料工作台"
      className="relative h-full w-full min-w-0 overflow-hidden rounded-[17px] border border-white/[0.055] bg-[#1c2127] shadow-[0_20px_50px_rgba(5,8,12,0.16)]"
    >
      <div className="absolute inset-x-0 top-0 z-10 flex h-[54px] items-center justify-between gap-4 border-b border-white/[0.075] px-[17px]">
        <h2 className="truncate text-sm font-semibold text-slate-100">
          {asset?.name ?? '资料工作台'}
        </h2>
        {asset && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="rounded-lg border border-white/[0.08] px-2 py-1 text-[10px] text-slate-400">
              {mediaLabel(asset.mediaType)}
            </span>
            <WorkbenchOverflowHost />
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 top-[54px] min-h-0 overflow-hidden">
        {content}
      </div>
      <WorkbenchContextMenuHost />
    </article>
  );
}
