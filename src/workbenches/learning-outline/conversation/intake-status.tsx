import { useEffect, useState } from 'react';

import type { ConversationModeStatusProps } from '../../../renderer/conversation/conversation-mode';
import { getLearningBriefMissingFields, isLearningBriefComplete, isLearningOutlineBriefState, learningOutlineActions } from '../shared';
import type { LearningOutlineBriefState } from '../shared';
import { LearningBriefCompletion } from './brief-completion';

const initialState: LearningOutlineBriefState = Object.freeze({ valid: false });

function briefLabel(state: LearningOutlineBriefState): string {
  if (!state.valid) return state.brief ? '当前文件无效' : '尚未保存';
  if (state.brief && isLearningBriefComplete(state.brief)) return '必填项已齐 · 已保存';
  if (
    state.brief &&
    (state.brief.goal || state.brief.scope || state.brief.roadmap.length > 0)
  ) {
    return '收集中 · 已保存';
  }
  return '已保存模板 · 等待收集';
}

export function LearningOutlineIntakeStatus({
  projectId,
  boundAssetId,
  refreshKey,
}: ConversationModeStatusProps) {
  const identity = JSON.stringify([projectId, boundAssetId]);
  const [snapshot, setSnapshot] = useState<{ identity: string; state: LearningOutlineBriefState }>();
  const state = snapshot?.identity === identity ? snapshot.state : initialState;
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!boundAssetId) return;
    let active = true;
    setLoading(true);
    void window.learningCompanion
      .invokeWorkbenchAction({
        actionId: learningOutlineActions.getBriefState,
        projectId,
        payload: { assetId: boundAssetId },
      })
      .then((result) => {
        if (active && isLearningOutlineBriefState(result)) setSnapshot({ identity, state: result });
        else if (active) setSnapshot({ identity, state: { valid: false, error: '无法读取学习需求保存状态。' } });
      })
      .catch(() => {
        if (active)
          setSnapshot({ identity, state: { valid: false, error: '无法读取学习需求保存状态。' } });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [boundAssetId, projectId, identity, refreshKey]);

  if (!boundAssetId) return null;
  return (
    <section
      aria-label="学习需求保存状态"
      className="mt-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="text-slate-500">学习需求</span>
        <span className={state.valid ? 'text-emerald-300' : 'text-amber-200'}>
          {loading ? '正在检查…' : briefLabel(state)}
        </span>
      </div>
      {state.error && (
        <p className="mt-1 text-[9px] leading-4 text-rose-200">{state.error}</p>
      )}
      {state.revision && (
        <p className="mt-1 truncate font-mono text-[9px] text-slate-600">
          revision {state.revision.slice(0, 12)}
          {state.updatedTime
            ? ` · ${new Date(state.updatedTime).toLocaleString('zh-CN')}`
            : ''}
        </p>
      )}
      {state.valid && state.brief && getLearningBriefMissingFields(state.brief).length > 0 && (
        <p className="mt-1 text-[10px] leading-4 text-slate-400">
          待确认：{getLearningBriefMissingFields(state.brief).join('、')}
        </p>
      )}
      {state.brief && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[9px] text-slate-500">
            查看最近有效需求
          </summary>
          <div className="mt-1.5 space-y-1 text-[9px] leading-4 text-slate-400">
            <p>目标：{state.brief.goal || '未填写'}</p>
            <p>范围：{state.brief.scope || '未填写'}</p>
            <p>
              路线：
              {state.brief.roadmap.map((item) => item.title).join('、') ||
                '未填写'}
            </p>
            {state.brief.detailed && <p className="whitespace-pre-wrap">额外补充：{state.brief.detailed}</p>}
          </div>
        </details>
      )}
      <LearningBriefCompletion state={state} />
    </section>
  );
}
