import { useCallback, useEffect, useMemo, useState } from 'react';

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
  const [payload, setPayload] = useState<LearningOutlineWorkbenchPayload>(
    () => {
      if (!isLearningOutlineWorkbenchPayload(bootstrap.payload)) {
        throw new Error('学习大纲 Workbench 数据无效');
      }
      return bootstrap.payload;
    },
  );
  const progress = useMemo(
    () =>
      new Map(
        payload.document.progress.map((entry) => [entry.unitId, entry.status]),
      ),
    [payload.document.progress],
  );
  useEffect(() => {
    if (!subscribeEvent) return;
    return subscribeEvent((event) => {
      if (event.type !== 'brief-changed') return;
      const changed = event.payload;
      if (!isLearningOutlineChangedEvent(changed)) return;
      if (changed.type !== 'brief-changed' || changed.assetId !== asset.id) {
        return;
      }
      setPayload((current) => ({
        ...current,
        brief: changed.state,
      }));
    });
  }, [asset.id, subscribeEvent]);
  const [openingConversation, setOpeningConversation] = useState(false);
  const openIntakeConversation = useCallback(async () => {
    if (openingConversation) return;
    setOpeningConversation(true);
    try {
      const conversation =
        await window.learningCompanion.getOrCreateBoundProjectConversation({
          projectId: asset.projectId,
          boundAssetId: asset.id,
          modeId: LEARNING_OUTLINE_INTAKE_MODE_ID,
        });
      await conversationRuntime.openAndWait({
        conversationId: conversation.id,
        modeId: LEARNING_OUTLINE_INTAKE_MODE_ID,
        boundAssetId: asset.id,
      });
    } catch (error: unknown) {
      onError(
        userMessageFromError(error, '无法打开学习大纲需求对话。') ??
          '无法打开学习大纲需求对话。',
      );
    } finally {
      setOpeningConversation(false);
    }
  }, [
    asset.id,
    asset.projectId,
    conversationRuntime,
    onError,
    openingConversation,
  ]);
  const brief = payload.brief.brief;
  const briefStatus = !payload.brief.valid
    ? brief
      ? '当前文件无效，保留上次已保存需求'
      : '需求尚未保存'
    : payload.brief.ready
      ? '需求已整理并保存'
      : brief && (brief.goal || brief.scope || brief.roadmap.length > 0)
        ? '需求收集中，已保存最新版本'
        : '已保存结构化模板，等待收集需求';
  return (
    <section className="flex h-full min-h-0 flex-col overflow-auto bg-[#171b22] p-5 text-slate-100">
      <header className="mb-5 border-b border-white/10 pb-4">
        <p className="text-[10px] uppercase tracking-[0.18em] text-indigo-300/75">
          学习大纲 · {asset.name}
        </p>
        <h1 className="mt-2 text-xl font-semibold">{payload.document.title}</h1>
        <div className="mt-2 flex items-start justify-between gap-3">
          <p className="text-sm leading-6 text-slate-400">
            {payload.document.goal || '需求收集完成后，这里会显示学习目标。'}
          </p>
          {payload.document.status === 'draft' && (
            <button
              type="button"
              disabled={openingConversation}
              onClick={() => void openIntakeConversation()}
              className="shrink-0 rounded-lg border border-indigo-300/25 px-3 py-1.5 text-[10px] text-indigo-200 hover:bg-indigo-300/10 disabled:opacity-40"
            >
              {openingConversation ? '正在打开…' : '继续需求沟通'}
            </button>
          )}
        </div>
      </header>
      <section
        aria-label="学习需求状态"
        className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">需求收集状态</h2>
          <span
            className={
              payload.brief.valid
                ? 'text-[10px] text-emerald-300'
                : 'text-[10px] text-amber-200'
            }
          >
            {briefStatus}
          </span>
        </div>
        <p className="mt-2 text-[10px] leading-5 text-slate-500">
          正式来源：{payload.document.sourceAssetIds.length} 份思维导图
          {payload.brief.updatedTime
            ? ` · 最近保存 ${new Date(payload.brief.updatedTime).toLocaleString('zh-CN')}`
            : ''}
        </p>
        {payload.brief.error && (
          <p role="alert" className="mt-2 text-[10px] leading-5 text-rose-200">
            {payload.brief.error}
          </p>
        )}
        {brief && (
          <details className="mt-3 rounded-lg border border-white/[0.07] px-3 py-2">
            <summary className="cursor-pointer text-[10px] text-slate-300">
              查看最近一次有效需求
            </summary>
            <dl className="mt-3 grid gap-2 text-[10px] leading-5 text-slate-400">
              <div>
                <dt className="text-slate-600">学习目标</dt>
                <dd>{brief.goal || '未填写'}</dd>
              </div>
              <div>
                <dt className="text-slate-600">当前基础</dt>
                <dd>{brief.currentLevel || '未填写'}</dd>
              </div>
              <div>
                <dt className="text-slate-600">困难与约束</dt>
                <dd>
                  {[brief.difficulties, brief.constraints]
                    .filter(Boolean)
                    .join('；') || '未填写'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">范围</dt>
                <dd>{brief.scope || '未填写'}</dd>
              </div>
              <div>
                <dt className="text-slate-600">路线草案</dt>
                <dd>
                  {brief.roadmap.map((item) => item.title).join('、') ||
                    '未填写'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">待确认问题</dt>
                <dd>{brief.openQuestions.join('；') || '无'}</dd>
              </div>
            </dl>
          </details>
        )}
        {payload.brief.ready && (
          <p className="mt-3 text-[10px] text-indigo-200/80">
            需求已整理，可继续补充；正式章节生成功能待接入。
          </p>
        )}
      </section>
      {payload.document.chapters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-500">
          这是一份学习大纲草稿。请在关联的需求收集对话中继续完善目标，确认后再生成正式章节。
        </div>
      ) : (
        <div className="space-y-4">
          {payload.document.chapters.map((chapter, index) => (
            <article
              key={chapter.id}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <h2 className="font-medium">
                {index + 1}. {chapter.title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {chapter.summary}
              </p>
              <div className="mt-3 space-y-2">
                {chapter.units.map((unit) => {
                  const status = progress.get(unit.id) ?? 'not-started';
                  return (
                    <div
                      key={unit.id}
                      className="rounded-lg border border-white/[0.07] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm">{unit.title}</h3>
                          <p className="mt-1 text-xs text-slate-500">
                            {unit.objective}
                          </p>
                        </div>
                        <span className="shrink-0 text-[10px] text-slate-500">
                          {statusLabel(status)}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(
                          [
                            'not-started',
                            'learning',
                            'completed',
                            'skipped',
                          ] as const
                        ).map((nextStatus) => (
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
                              )
                                .then((result) => {
                                  if (
                                    !isLearningOutlineWorkbenchPayload(
                                      result.payload,
                                    )
                                  ) {
                                    throw new Error('学习大纲状态响应无效');
                                  }
                                  setPayload(result.payload);
                                })
                                .catch((error: unknown) => {
                                  onError(
                                    userMessageFromError(
                                      error,
                                      '无法更新学习进度。',
                                    ) ?? '无法更新学习进度。',
                                  );
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
