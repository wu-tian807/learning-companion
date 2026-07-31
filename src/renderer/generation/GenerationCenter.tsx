import type { AssetSnapshot } from '../../shared/assets';
import { AssetList } from '../project/AssetList';
import { isWorkbenchActionEnabled } from '../workbench/actions/workbench-action';
import {
  useWorkbenchRuntime,
  useWorkbenchRuntimeSelector,
} from '../workbench/runtime/workbench-runtime-context';

export interface GenerationCenterProps {
  readonly asset: AssetSnapshot | undefined;
  readonly generatedAssets: readonly AssetSnapshot[];
  readonly selectedAssetId: string | null;
  readonly busy: boolean;
  readonly now: number;
  readonly mediaLabel: (mediaType: string) => string;
  readonly onSelect: (assetId: string) => void;
  readonly onRename: (asset: AssetSnapshot) => void;
  readonly onReveal: (asset: AssetSnapshot) => void;
  readonly onRelink: (asset: AssetSnapshot) => void;
  readonly onDelete: (asset: AssetSnapshot) => void;
}

const applicationTools = [
  {
    label: '思维导图',
    description: '梳理主题与知识关系',
  },
  {
    label: '学习提纲',
    description: '提炼章节与复习路径',
  },
  {
    label: '知识卡片',
    description: '生成适合回顾的卡片',
  },
  {
    label: '摘要',
    description: '形成跨资料重点摘要',
  },
] as const;

export function GenerationCenter({
  asset,
  generatedAssets,
  selectedAssetId,
  busy,
  now,
  mediaLabel,
  onSelect,
  onRename,
  onReveal,
  onRelink,
  onDelete,
}: GenerationCenterProps) {
  const runtime = useWorkbenchRuntime();
  const identity = useWorkbenchRuntimeSelector(
    (state) => state.identity,
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
  void contributionRevision;

  return (
    <aside
      id="project-generation-center"
      aria-label="生成中心"
      className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[17px] border border-white/[0.055] bg-[#20252c] shadow-[0_20px_50px_rgba(5,8,12,0.16)]"
    >
      <div className="flex h-[54px] shrink-0 items-center justify-between border-b border-white/[0.075] px-[17px]">
        <h2 className="text-sm font-semibold">生成中心</h2>
        <span className="text-[11px] text-slate-500">
          {generatedAssets.length} 个内容
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold text-slate-300">
            通用生成工具
          </p>
          <span className="text-[9px] text-slate-600">
            基于 Project 资料
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {applicationTools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              disabled
              title="生成能力尚未接入"
              className="min-h-[76px] rounded-[11px] border border-white/[0.08] bg-indigo-300/[0.075] p-3 text-left disabled:cursor-not-allowed disabled:opacity-65"
            >
              <span className="block text-[11px] font-semibold text-slate-300">
                {tool.label}
              </span>
              <span className="mt-1.5 block text-[9px] leading-4 text-slate-500">
                {tool.description}
              </span>
            </button>
          ))}
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

        <div className="my-5 h-px bg-white/[0.075]" />

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold text-slate-300">
            生成内容
          </p>
          <span className="text-[9px] text-slate-500">
            最近使用 ↓
          </span>
        </div>
        <div className="mt-2">
          <AssetList
            assets={generatedAssets}
            selectedAssetId={selectedAssetId}
            busy={busy}
            now={now}
            emptyState={
              <div className="rounded-[11px] border border-dashed border-white/[0.08] px-4 py-8 text-center">
                <p className="text-[10px] font-medium text-slate-400">
                  还没有生成内容
                </p>
                <p className="mt-1.5 text-[9px] leading-4 text-slate-600">
                  思维导图、讲义等生成结果会出现在这里
                </p>
              </div>
            }
            onSelect={onSelect}
            onRename={onRename}
            onReveal={onReveal}
            onRelink={onRelink}
            onDelete={onDelete}
          />
        </div>
      </div>
    </aside>
  );
}
