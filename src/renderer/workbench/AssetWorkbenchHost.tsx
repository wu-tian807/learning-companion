import { useEffect, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  isWorkbenchBootstrap,
  type WorkbenchBootstrap,
} from '../../shared/workbench/protocol';
import { unsupportedRendererWorkbenchModule } from '../../workbenches/unsupported/renderer';
import { AttachmentHost } from './AttachmentHost';
import { RendererWorkbenchRegistry } from './renderer-workbench-registry';

interface AssetWorkbenchHostProps {
  readonly asset: AssetSnapshot | undefined;
  readonly mediaLabel: (mediaType: string) => string;
  readonly onRelink: () => void;
  readonly onRefresh: () => void;
  readonly onError: (message: string) => void;
}

type SettledWorkbenchHostState =
  | {
      readonly kind: 'ready';
      readonly assetKey: string;
      readonly bootstrap: WorkbenchBootstrap;
    }
  | {
      readonly kind: 'failed';
      readonly assetKey: string;
      readonly message: string;
    };

const defaultRegistry = new RendererWorkbenchRegistry(
  unsupportedRendererWorkbenchModule,
);

export function AssetWorkbenchHost({
  asset,
  mediaLabel,
  onRelink,
  onRefresh,
  onError,
}: AssetWorkbenchHostProps) {
  const [settledState, setSettledState] =
    useState<SettledWorkbenchHostState>();
  const assetId = asset?.id;
  const checkedTime = asset?.contentStatus.checkedTime;
  const mediaType = asset?.mediaType;
  const assetKey =
    assetId && checkedTime !== undefined && mediaType
      ? `${assetId}:${checkedTime}:${mediaType}`
      : undefined;

  useEffect(() => {
    let active = true;
    let openedSessionId: string | undefined;

    if (!assetId || !assetKey) {
      return () => {
        active = false;
      };
    }

    void window.learningCompanion
      .openWorkbench({ assetId })
      .then(async (bootstrap) => {
        if (!isWorkbenchBootstrap(bootstrap)) {
          throw new Error('Workbench Bootstrap 响应无效');
        }

        openedSessionId = bootstrap.sessionId;

        if (!active) {
          await window.learningCompanion.closeWorkbench({
            sessionId: bootstrap.sessionId,
          });
          return;
        }

        setSettledState({ kind: 'ready', assetKey, bootstrap });
      })
      .catch((openError: unknown) => {
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
      });

    return () => {
      active = false;

      if (openedSessionId) {
        void window.learningCompanion
          .closeWorkbench({ sessionId: openedSessionId })
          .catch((closeError: unknown) => {
            const message = userMessageFromError(
              closeError,
              '无法正确关闭资料工作台。',
            );
            if (message) {
              console.error(message, closeError);
            }
          });
      }
    };
  }, [assetId, assetKey, onError]);

  const state =
    assetKey === undefined
      ? { kind: 'idle' as const }
      : settledState?.assetKey === assetKey
        ? settledState
        : { kind: 'opening' as const };

  const module =
    state.kind === 'ready'
      ? defaultRegistry.resolve(state.bootstrap.workbenchId)
      : undefined;

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
  } else if (asset && state.kind === 'ready' && module) {
    const View = module.View;
    content = (
      <>
        <View
          asset={asset}
          bootstrap={state.bootstrap}
          onRelink={onRelink}
          onRefresh={onRefresh}
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
            <button
              type="button"
              disabled
              aria-label="资料工作台操作"
              className="grid h-[26px] min-w-[30px] place-items-center rounded-lg border border-white/[0.08] px-2 text-xs tracking-[0.08em] text-slate-400"
            >
              •••
            </button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">{content}</div>
    </article>
  );
}
