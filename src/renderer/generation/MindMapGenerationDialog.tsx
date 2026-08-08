import { useEffect, useRef, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import {
  createMindMapGenerationDraft,
  type MindMapGenerationDraft,
} from './mind-map-generation-draft';

interface MindMapGenerationDialogProps {
  readonly projectId: string;
  readonly sourceAssets: readonly AssetSnapshot[];
  readonly mediaLabel: (mediaType: string) => string;
  readonly onClose: () => void;
  readonly onSubmit: (
    draft: MindMapGenerationDraft,
  ) => Promise<void> | void;
}

export function MindMapGenerationDialog({
  projectId,
  sourceAssets,
  mediaLabel,
  onClose,
  onSubmit,
}: MindMapGenerationDialogProps) {
  const [additionalInstructions, setAdditionalInstructions] =
    useState('');
  const [submitting, setSubmitting] = useState(false);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    instructionsRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-[3px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="mind-map-generation-title"
        aria-describedby="mind-map-generation-description"
        className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-xl flex-col overflow-hidden rounded-[20px] border border-white/[0.12] bg-[#282d35] shadow-[0_28px_80px_rgba(0,0,0,0.55)]"
        onSubmit={(event) => {
          event.preventDefault();
          if (submitting) {
            return;
          }

          setSubmitting(true);
          void Promise.resolve(
            onSubmit(
              createMindMapGenerationDraft({
                projectId,
                sourceAssetIds: sourceAssets.map((asset) => asset.id),
                additionalInstructions,
              }),
            ),
          )
            .catch(() => undefined)
            .finally(() => setSubmitting(false));
        }}
      >
        <div className="border-b border-white/[0.08] px-5 py-5 sm:px-6">
          <h2
            id="mind-map-generation-title"
            className="text-lg font-semibold text-slate-100"
          >
            生成思维导图
          </h2>
          <p
            id="mind-map-generation-description"
            className="mt-2 text-xs leading-5 text-slate-400"
          >
            确认用于生成的学习资料，并可补充你的要求。
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-slate-200">
              已选资料
            </h3>
            <span className="text-[11px] text-slate-500">
              {sourceAssets.length} 项
            </span>
          </div>
          <ul className="mt-2.5 max-h-52 space-y-1.5 overflow-y-auto rounded-[13px] border border-white/[0.08] bg-black/10 p-2">
            {sourceAssets.map((asset) => (
              <li
                key={asset.id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-[9px] px-3 py-2.5 hover:bg-white/[0.035]"
              >
                <span className="truncate text-xs font-medium text-slate-200">
                  {asset.name}
                </span>
                <span className="shrink-0 rounded-full border border-white/[0.08] px-2 py-1 text-[9px] text-slate-500">
                  {mediaLabel(asset.mediaType)}
                </span>
              </li>
            ))}
          </ul>

          <label
            htmlFor="mind-map-additional-instructions"
            className="mt-5 block text-xs font-semibold text-slate-200"
          >
            补充要求
            <span className="ml-1 font-normal text-slate-500">
              （可选）
            </span>
          </label>
          <textarea
            ref={instructionsRef}
            id="mind-map-additional-instructions"
            value={additionalInstructions}
            rows={5}
            placeholder="例如：重点梳理不同概念之间的因果关系"
            onChange={(event) =>
              setAdditionalInstructions(event.target.value)
            }
            className="mt-2.5 min-h-28 w-full resize-y rounded-[13px] border border-white/[0.1] bg-black/15 px-3.5 py-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-300/45"
          />
        </div>

        <div className="flex shrink-0 justify-end gap-2.5 border-t border-white/[0.08] px-5 py-4 sm:px-6">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="ui-control h-10 rounded-full border border-white/[0.12] px-4 text-sm text-slate-300"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="ui-primary-button h-10 rounded-full bg-slate-50 px-5 text-sm font-semibold text-slate-900"
          >
            {submitting ? '正在创建…' : '确认生成'}
          </button>
        </div>
      </form>
    </div>
  );
}
