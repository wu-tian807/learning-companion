import type { AssetSnapshot } from '../../shared/assets';
import { findTextSelectionInput } from '../../shared/workbench/selection';
import { isWorkbenchActionEnabled } from '../workbench/actions/workbench-action';
import {
  useWorkbenchRuntime,
  useWorkbenchRuntimeSelector,
} from '../workbench/runtime/workbench-runtime-context';
import { summarizeSelection } from './generation-center-model';

export interface GenerationCenterProps {
  readonly asset: AssetSnapshot | undefined;
  readonly mediaLabel: (mediaType: string) => string;
}

const applicationTools = [
  '思维导图',
  '学习提纲',
  '知识卡片',
  '摘要',
] as const;

export function GenerationCenter({
  asset,
  mediaLabel,
}: GenerationCenterProps) {
  const runtime = useWorkbenchRuntime();
  const identity = useWorkbenchRuntimeSelector(
    (state) => state.identity,
  );
  const interaction = useWorkbenchRuntimeSelector(
    (state) => state.interaction,
  );
  const busyActionIds = useWorkbenchRuntimeSelector(
    (state) => state.busyActionIds,
  );
  const contributionRevision = useWorkbenchRuntimeSelector(
    (state) => state.contributionRevision,
  );
  const connected =
    asset !== undefined && identity?.assetId === asset.id;
  const tools = connected
    ? runtime
        .contributions('generation-center')
        .filter(
          (entry) =>
            entry.contribution.presentation.kind ===
            'generation-tool',
        )
    : [];
  const selection = connected
    ? findTextSelectionInput(interaction)
    : undefined;
  const selectionSummary = selection
    ? summarizeSelection(selection.text)
    : undefined;
  void contributionRevision;

  return (
    <aside
      aria-label="生成中心"
      className="flex min-w-0 flex-col overflow-hidden rounded-[17px] border border-white/[0.055] bg-[#20252c] shadow-[0_20px_50px_rgba(5,8,12,0.16)]"
    >
      <div className="flex h-[54px] shrink-0 items-center border-b border-white/[0.075] px-[17px]">
        <h2 className="text-sm font-semibold">生成中心</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        <p className="text-[11px] font-semibold text-slate-300">
          生成新的 Asset
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {applicationTools.map((name) => (
            <button
              key={name}
              type="button"
              disabled
              title="生成能力尚未接入"
              className="min-h-[70px] rounded-[11px] border border-white/[0.07] bg-indigo-300/[0.07] p-2.5 text-left text-[10px] text-slate-400 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {name}
            </button>
          ))}
        </div>

        <p className="mt-5 text-[11px] font-semibold text-slate-300">
          当前资料上下文
        </p>
        <div className="mt-2 rounded-[10px] border border-white/[0.055] p-3">
          {!asset ? (
            <p className="text-[10px] leading-5 text-slate-600">
              选择 Asset 后显示对应上下文。
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] font-medium text-slate-300">
                  {asset.name}
                </span>
                <span
                  title={identity?.workbenchId}
                  className="shrink-0 text-[9px] text-slate-600"
                >
                  {connected
                    ? mediaLabel(asset.mediaType)
                    : '正在装载'}
                </span>
              </div>
              {selectionSummary ? (
                <div className="mt-2 rounded-lg bg-indigo-300/[0.055] px-2.5 py-2">
                  <p className="text-[9px] font-medium text-indigo-200/75">
                    已选择 {selectionSummary.characterCount} 个字符
                  </p>
                  <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-slate-400">
                    {selectionSummary.preview}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[10px] leading-5 text-slate-600">
                  在资料中选择内容后，工具可以使用当前选区。
                </p>
              )}
            </>
          )}
        </div>

        <p className="mt-5 text-[11px] font-semibold text-slate-300">
          当前 Asset 工具
        </p>
        <div className="mt-2 grid gap-1.5">
          {tools.map((entry) => {
            const presentation = entry.contribution.presentation;
            const busy = busyActionIds.has(entry.action.id);
            const disabled =
              !isWorkbenchActionEnabled(entry.action) || busy;

            if (presentation.kind !== 'generation-tool') {
              return null;
            }

            return (
              <button
                key={`${entry.ownerId}:${entry.contribution.id}`}
                type="button"
                disabled={disabled}
                title={
                  disabled
                    ? presentation.disabledReason
                    : presentation.description
                }
                onClick={() => {
                  void runtime.invokeCurrent(
                    entry.action.id,
                    'generation-center',
                  );
                }}
                className="ui-control rounded-[10px] border border-white/[0.065] p-3 text-left disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="block text-[10px] font-medium text-slate-300">
                  {presentation.label}
                </span>
                <span className="mt-1 block text-[9px] leading-4 text-slate-600">
                  {presentation.description}
                </span>
              </button>
            );
          })}
          {tools.length === 0 && (
            <p className="rounded-[10px] border border-white/[0.055] p-3 text-[10px] leading-5 text-slate-600">
              {!asset
                ? '选择 Asset 后显示对应工具。'
                : !connected
                  ? '正在装载当前资料工作台。'
                  : `当前 ${mediaLabel(asset.mediaType)} 工作台尚未提供专属工具。`}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
