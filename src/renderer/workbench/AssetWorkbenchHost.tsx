import { useCallback, useEffect, useRef, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  isWorkbenchBootstrap,
  type WorkbenchCommand,
  type WorkbenchCommandResult,
  type WorkbenchBootstrap,
} from '../../shared/workbench/protocol';
import type {
  WorkbenchSelectionEnvelope,
  WorkbenchSelectionSnapshot,
} from '../../shared/workbench/selection';
import { IMAGE_WORKBENCH_ID } from '../../workbenches/image/shared';
import { MARKDOWN_WORKBENCH_ID } from '../../workbenches/markdown/shared';
import { PDF_WORKBENCH_ID } from '../../workbenches/pdf/shared';
import { PLAIN_TEXT_WORKBENCH_ID } from '../../workbenches/plain-text/shared';
import { unsupportedRendererWorkbenchModule } from '../../workbenches/unsupported/renderer';
import { AttachmentHost } from './AttachmentHost';
import {
  RendererWorkbenchRegistry,
  type RendererWorkbenchModule,
} from './renderer-workbench-registry';
import { WorkbenchLifecycleCoordinator } from './workbench-lifecycle';

interface AssetWorkbenchHostProps {
  readonly asset: AssetSnapshot | undefined;
  readonly mediaLabel: (mediaType: string) => string;
  readonly onRelink: () => void;
  readonly onRefresh: () => void;
  readonly onReveal: () => Promise<void> | void;
  readonly onSelectionChange: (
    event: WorkbenchSelectionEnvelope,
  ) => void;
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
defaultRegistry.registerLoader(PLAIN_TEXT_WORKBENCH_ID, async () => {
  const { plainTextRendererWorkbenchModule } = await import(
    '../../workbenches/plain-text/renderer'
  );

  return plainTextRendererWorkbenchModule;
});
defaultRegistry.registerLoader(IMAGE_WORKBENCH_ID, async () => {
  const { imageRendererWorkbenchModule } = await import(
    '../../workbenches/image/renderer'
  );

  return imageRendererWorkbenchModule;
});
defaultRegistry.registerLoader(MARKDOWN_WORKBENCH_ID, async () => {
  const { markdownRendererWorkbenchModule } = await import(
    '../../workbenches/markdown/renderer'
  );

  return markdownRendererWorkbenchModule;
});
defaultRegistry.registerLoader(PDF_WORKBENCH_ID, async () => {
  const { default: pdfRendererWorkbenchModule } = await import(
    '../../workbenches/pdf/renderer'
  );

  return pdfRendererWorkbenchModule;
});

export function AssetWorkbenchHost({
  asset,
  mediaLabel,
  onRelink,
  onRefresh,
  onReveal,
  onSelectionChange,
  onLifecycleTaskChange,
  onError,
}: AssetWorkbenchHostProps) {
  const [settledState, setSettledState] =
    useState<SettledWorkbenchHostState>();
  const [headerActionsTarget, setHeaderActionsTarget] =
    useState<HTMLDivElement | null>(null);
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
  const reportSelection = useCallback(
    (selection: WorkbenchSelectionSnapshot | undefined) => {
      if (
        !assetId ||
        !readySessionId ||
        activeSessionIdRef.current !== readySessionId
      ) {
        return;
      }

      onSelectionChange({
        assetId,
        sessionId: readySessionId,
        selection,
      });
    },
    [assetId, onSelectionChange, readySessionId],
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
      if (assetId) {
        onSelectionChange({
          assetId,
          sessionId,
          selection: undefined,
        });
      }
      // React may run the Host cleanup before the active View cleanup.
      // Yield once so a View can synchronously enqueue its final state command.
      await Promise.resolve();
      await commandTail;
      await window.learningCompanion.closeWorkbench({ sessionId });
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
    onSelectionChange,
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
      <>
        <View
          asset={asset}
          bootstrap={state.bootstrap}
          headerActionsTarget={headerActionsTarget}
          executeCommand={state.executeCommand}
          onRelink={onRelink}
          onRefresh={onRefresh}
          onReveal={onReveal}
          onSelectionChange={reportSelection}
          onOpenExternal={openExternal}
          onError={onError}
        />
        <AttachmentHost attachments={[]} />
      </>
    );
  }

  return (
    <article
      aria-label="Asset 资料工作台"
      className="flex min-w-0 flex-col overflow-hidden rounded-[17px] border border-white/[0.055] bg-[#1c2127] shadow-[0_20px_50px_rgba(5,8,12,0.16)]"
    >
      <div className="flex h-[54px] shrink-0 items-center justify-between gap-4 border-b border-white/[0.075] px-[17px]">
        <h2 className="truncate text-sm font-semibold text-slate-100">
          {asset?.name ?? '资料工作台'}
        </h2>
        {asset && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="rounded-lg border border-white/[0.08] px-2 py-1 text-[10px] text-slate-400">
              {mediaLabel(asset.mediaType)}
            </span>
            <div
              ref={setHeaderActionsTarget}
              className="flex shrink-0 items-center empty:hidden"
            />
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">{content}</div>
    </article>
  );
}
