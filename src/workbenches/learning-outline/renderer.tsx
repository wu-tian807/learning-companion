import { useEffect, useMemo, useState } from 'react';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  isLearningOutlineChangedEvent,
  LEARNING_OUTLINE_INTAKE_MODE_ID,
} from './shared';
import { useWorkbenchConversationRuntime } from '../../renderer/conversation/workbench-conversation-context';
import {
  createLearningOutlineSetUnitStatusCommand,
  isLearningOutlineWorkbenchPayload,
  learningOutlineWorkbenchManifest,
  type LearningOutlineWorkbenchPayload,
  type LearningUnitStatus,
} from './shared';

function statusLabel(status: LearningUnitStatus): string {
  return {
    'not-started': '未开始',
    learning: '学习中',
    completed: '已完成',
    skipped: '已跳过',
  }[status];
}

function OutlineView({
  asset,
  bootstrap,
  executeCommand,
  subscribeEvent,
  onError,
}: RendererWorkbenchViewProps) {
  const conversationRuntime = useWorkbenchConversationRuntime();
  const [payload, setPayload] = useState<LearningOutlineWorkbenchPayload>(() => {
    if (!isLearningOutlineWorkbenchPayload(bootstrap.payload)) {
      throw new Error('学习大纲 Workbench 数据无效');
    }
    return bootstrap.payload;
  });
  const progress = useMemo(
    () => new Map(payload.document.progress.map((entry) => [entry.unitId, entry.status])),
    [payload.document.progress],
  );
  useEffect(() => {
    if (!subscribeEvent) return;
    return subscribeEvent((event) => {
      if (event.type !== 'brief-changed') return;
      const changed = event.payload;
      if (!isLearningOutlineChangedEvent(changed)) return;
      if (
        changed.type !== 'brief-changed' ||
        changed.assetId !== asset.id
      ) {
        return;
      }
      setPayload((current) => ({
        ...current,
        brief: changed.state,
      }));
    });
  }, [asset.id, subscribeEvent]);
  useEffect(() => {
    if (payload.document.status !== 'draft') return;
    let active = true;
    void window.learningCompanion
      .getOrCreateBoundProjectConversation({
        projectId: asset.projectId,
        boundAssetId: asset.id,
        modeId: LEARNING_OUTLINE_INTAKE_MODE_ID,
      })
      .then((conversation) => {
        if (!active) return;
        conversationRuntime.open({
          conversationId: conversation.id,
          modeId: LEARNING_OUTLINE_INTAKE_MODE_ID,
          boundAssetId: asset.id,
        });
      })
      .catch((error: unknown) => {
        if (active) onError(userMessageFromError(error, '无法打开学习大纲需求对话。') ?? '无法打开学习大纲需求对话。');
      });
    return () => {
      active = false;
    };
  }, [asset.id, asset.projectId, conversationRuntime, onError, payload.document.status]);
  return (
    <section className="flex h-full min-h-0 flex-col overflow-auto bg-[#171b22] p-5 text-slate-100">
      <header className="mb-5 border-b border-white/10 pb-4">
        <p className="text-[10px] uppercase tracking-[0.18em] text-indigo-300/75">
          学习大纲 · {asset.name}
        </p>
        <h1 className="mt-2 text-xl font-semibold">{payload.document.title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {payload.document.goal || '需求收集完成后，这里会显示学习目标。'}
        </p>
      </header>
      {payload.document.chapters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-500">
          这是一份学习大纲草稿。请在关联的需求收集对话中继续完善目标，确认后再生成正式章节。
        </div>
      ) : (
        <div className="space-y-4">
          {payload.document.chapters.map((chapter, index) => (
            <article key={chapter.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h2 className="font-medium">{index + 1}. {chapter.title}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{chapter.summary}</p>
              <div className="mt-3 space-y-2">
                {chapter.units.map((unit) => {
                  const status = progress.get(unit.id) ?? 'not-started';
                  return (
                    <div key={unit.id} className="rounded-lg border border-white/[0.07] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm">{unit.title}</h3>
                          <p className="mt-1 text-xs text-slate-500">{unit.objective}</p>
                        </div>
                        <span className="shrink-0 text-[10px] text-slate-500">{statusLabel(status)}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(['not-started', 'learning', 'completed', 'skipped'] as const).map((nextStatus) => (
                          <button
                            key={nextStatus}
                            type="button"
                            className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/[0.06]"
                            onClick={() => {
                              void executeCommand(
                                createLearningOutlineSetUnitStatusCommand({
                                  unitId: unit.id,
                                  status: nextStatus,
                                }),
                              ).then((result) => {
                                if (!isLearningOutlineWorkbenchPayload(result.payload)) {
                                  throw new Error('学习大纲状态响应无效');
                                }
                                setPayload(result.payload);
                              }).catch((error: unknown) => {
                                onError(userMessageFromError(error, '无法更新学习进度。') ?? '无法更新学习进度。');
                              });
                            }}
                          >
                            {statusLabel(nextStatus)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export const learningOutlineRendererWorkbenchModule: RendererWorkbenchModule = {
  manifest: learningOutlineWorkbenchManifest,
  View: OutlineView,
};
