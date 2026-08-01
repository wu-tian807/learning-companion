import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react';

export type MindMapNodeData = {
  readonly title: string;
  readonly focus: string;
  readonly isRoot: boolean;
  readonly childCount: number;
  readonly hiddenDescendantCount: number;
  readonly referenceCount: number;
  readonly linkCount: number;
  readonly growthDelayMs?: number;
  readonly onCollapse: () => void;
};

export type MindMapFlowNode = Node<MindMapNodeData, 'mindmap'>;

function CollapseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 6 5 5 5-5" />
    </svg>
  );
}

function MindMapNodeCard({
  data,
  selected,
}: NodeProps<MindMapFlowNode>) {
  const collapsed = data.hiddenDescendantCount > 0;

  return (
    <div
      className={`mindmap-node-card group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border px-4 py-3 shadow-[0_16px_42px_rgba(0,0,0,0.28)] transition-[border-color,background-color,box-shadow] duration-150 ${
        data.growthDelayMs === undefined
          ? ''
          : 'mindmap-node-card--growing'
      } ${
        selected
          ? 'border-indigo-300/60 bg-[#292f3b] shadow-[0_18px_48px_rgba(41,47,59,0.48)]'
          : data.isRoot
            ? 'border-indigo-300/28 bg-[#242a34]'
            : 'border-white/[0.09] bg-[#20262e] hover:border-white/[0.16] hover:bg-[#242a32]'
      }`}
      style={
        data.growthDelayMs === undefined
          ? undefined
          : { animationDelay: `${data.growthDelayMs}ms` }
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!size-2 !border-0 !bg-indigo-300/70 opacity-0"
      />

      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={`mt-1 size-2 shrink-0 rounded-full ${
            data.isRoot
              ? 'bg-indigo-300 shadow-[0_0_14px_rgba(165,180,252,0.72)]'
              : 'bg-slate-500'
          }`}
        />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[13px] font-semibold leading-[18px] text-slate-100">
            {data.title}
          </h3>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-400">
            {data.focus}
          </p>
        </div>
      </div>

      <div className="mt-auto flex min-h-5 items-end justify-between gap-2 pt-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[9px] text-slate-500">
          {data.referenceCount > 0 && (
            <span className="rounded-md bg-white/[0.045] px-1.5 py-0.5">
              {data.referenceCount} 来源
            </span>
          )}
          {data.linkCount > 0 && (
            <span className="rounded-md bg-indigo-300/[0.07] px-1.5 py-0.5 text-indigo-200/65">
              {data.linkCount} 派生
            </span>
          )}
        </div>

        {data.childCount > 0 && !collapsed && (
          <button
            type="button"
            aria-label="收起子节点"
            title="收起子节点"
            className="nodrag nopan ui-icon-button flex h-6 shrink-0 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.035] px-1.5 text-[9px] text-slate-400"
            onClick={(event) => {
              event.stopPropagation();
              data.onCollapse();
            }}
          >
            <CollapseIcon />
            {data.childCount}
          </button>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!size-2 !border-0 !bg-indigo-300/70 opacity-0"
      />
    </div>
  );
}

export const mindMapNodeTypes = {
  mindmap: MindMapNodeCard,
};
