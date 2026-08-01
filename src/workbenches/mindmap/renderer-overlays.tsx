import { Panel } from '@xyflow/react';

import type { MindMapDocumentV1 } from './document';

export const MIND_MAP_RENDERER_STYLES = `
  .learning-mindmap-workbench .react-flow__node-mindmap {
    transition: transform 340ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes mindmap-branch-grow {
    0% {
      opacity: 0.08;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
    }
    72% {
      opacity: 0.88;
    }
    100% {
      opacity: 1;
      stroke-dasharray: 1;
      stroke-dashoffset: 0;
    }
  }
  @keyframes mindmap-node-sprout {
    0% {
      opacity: 0;
      filter: blur(1.8px);
      transform: translateX(-28px) scale(0.84);
    }
    68% {
      opacity: 1;
      filter: blur(0);
      transform: translateX(2px) scale(1.015);
    }
    100% {
      opacity: 1;
      filter: blur(0);
      transform: translateX(0) scale(1);
    }
  }
  .learning-mindmap-workbench .mindmap-edge-path--growing {
    animation: mindmap-branch-grow 340ms cubic-bezier(0.22, 1, 0.36, 1) both;
    will-change: stroke-dashoffset, opacity;
  }
  .learning-mindmap-workbench .mindmap-node-card--growing {
    animation: mindmap-node-sprout 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
    transform-origin: left center;
    will-change: transform, opacity, filter;
  }
  .learning-mindmap-workbench .react-flow__controls {
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    background: rgba(28, 33, 40, 0.92);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
  }
  .learning-mindmap-workbench .react-flow__controls-button {
    border: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    background: transparent;
    fill: #94a3b8;
  }
  .learning-mindmap-workbench .react-flow__controls-button:hover {
    background: rgba(255, 255, 255, 0.07);
  }
  .learning-mindmap-workbench .react-flow__minimap {
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 12px;
    background: rgba(18, 23, 29, 0.88);
  }
  @media (prefers-reduced-motion: reduce) {
    .learning-mindmap-workbench .react-flow__node-mindmap {
      transition: none;
    }
    .learning-mindmap-workbench .mindmap-edge-path--growing,
    .learning-mindmap-workbench .mindmap-node-card--growing {
      animation: none;
    }
  }
`;

export interface MindMapRendererOverlaysProps {
  readonly document: MindMapDocumentV1;
  readonly collapsedCount: number;
  readonly staleAssociationCount: number;
  readonly onExpandAll: () => void;
}

export function MindMapRendererOverlays({
  document,
  collapsedCount,
  staleAssociationCount,
  onExpandAll,
}: MindMapRendererOverlaysProps) {
  const frameCount = Object.keys(document.frames).length;

  return (
    <>
      <Panel position="top-left">
        <div className="pointer-events-none rounded-xl border border-white/[0.07] bg-[#171c22]/88 px-3 py-2 shadow-lg backdrop-blur-md">
          <p className="max-w-[320px] truncate text-xs font-semibold text-slate-200">
            {document.title}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            {Object.keys(document.nodes).length} 个节点
            {frameCount > 0 ? ` · ${frameCount} 个范围` : ''}
          </p>
        </div>
      </Panel>

      {collapsedCount > 0 && (
        <Panel position="top-right">
          <button
            type="button"
            className="ui-control rounded-xl border border-white/[0.08] bg-[#171c22]/90 px-3 py-2 text-[10px] text-slate-400 shadow-lg backdrop-blur-md"
            onClick={onExpandAll}
          >
            展开全部 · {collapsedCount}
          </button>
        </Panel>
      )}

      {staleAssociationCount > 0 && (
        <Panel position="bottom-center">
          <div className="pointer-events-none rounded-full border border-amber-200/10 bg-amber-200/[0.06] px-3 py-1.5 text-[10px] text-amber-100/60 backdrop-blur-md">
            {staleAssociationCount} 个资料关联已失效，导图内容仍可正常阅读
          </div>
        </Panel>
      )}
    </>
  );
}
