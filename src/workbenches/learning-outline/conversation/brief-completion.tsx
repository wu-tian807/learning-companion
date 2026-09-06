import { useId } from 'react';

import { isLearningBriefComplete, type LearningOutlineBriefState } from '../shared';

/** Completion is available before the separate generation workflow is built. */
export function LearningBriefCompletion({ state }: { readonly state: LearningOutlineBriefState }) {
  const noteId = useId();
  if (!state.valid || !state.brief || !isLearningBriefComplete(state.brief)) return null;

  return (
    <div className="mt-3 space-y-2" role="status">
      <p className="text-xs leading-5 text-emerald-200">
        所有必填项已填写完成。你仍可以继续补充额外信息。
      </p>
      <div className="flex items-center gap-2">
        <button type="button" disabled aria-describedby={noteId}
          className="rounded-lg bg-indigo-500/30 px-3 py-1.5 text-xs text-indigo-100 disabled:cursor-not-allowed">
          生成大纲
        </button>
        <span id={noteId} className="text-[10px] text-slate-500">即将开放</span>
      </div>
    </div>
  );
}
