import type { ExternalLibrarySnapshot } from '../../shared/external-libraries';
import { formatExternalLibrarySize } from './external-library-view';
import type { PendingExternalLibraryInstall } from './use-external-library-management';

interface ConfirmationPanelProps {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly danger?: boolean;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function ConfirmationPanel({
  title,
  description,
  confirmLabel,
  danger = false,
  busy,
  onCancel,
  onConfirm,
}: ConfirmationPanelProps) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-[22px] bg-[#20242b]/92 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[18px] border border-white/[0.12] bg-[#2a2f37] p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {description}
        </p>
        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="ui-control h-9 rounded-full border border-white/[0.12] px-4 text-xs text-slate-300 disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`h-9 rounded-full px-4 text-xs font-semibold disabled:cursor-wait disabled:opacity-50 ${
              danger
                ? 'ui-danger-button bg-rose-500 text-white'
                : 'ui-primary-button bg-slate-50 text-slate-900'
            }`}
          >
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ExternalLibraryConfirmationPanelsProps {
  readonly pendingInstall: PendingExternalLibraryInstall | null;
  readonly pendingRemove: ExternalLibrarySnapshot | null;
  readonly requestPendingById: ReadonlySet<string>;
  readonly onCancelInstall: () => void;
  readonly onConfirmInstall: (
    request: PendingExternalLibraryInstall,
  ) => void;
  readonly onCancelRemove: () => void;
  readonly onConfirmRemove: (
    library: ExternalLibrarySnapshot,
  ) => void;
}

export function ExternalLibraryConfirmationPanels({
  pendingInstall,
  pendingRemove,
  requestPendingById,
  onCancelInstall,
  onConfirmInstall,
  onCancelRemove,
  onConfirmRemove,
}: ExternalLibraryConfirmationPanelsProps) {
  return (
    <>
      {pendingInstall && (
        <ConfirmationPanel
          title={`安装 ${pendingInstall.library.displayName}？`}
          description={`固定组件资源约 ${formatExternalLibrarySize(
            pendingInstall.expectedSize,
          )}。${pendingInstall.library.description} 安装时会在“${pendingInstall.library.rootPath}”内完成全部运行环境与校验；如需更换磁盘，请先取消并使用“更换位置”。`}
          confirmLabel="下载并安装"
          busy={requestPendingById.has(pendingInstall.library.id)}
          onCancel={onCancelInstall}
          onConfirm={() => onConfirmInstall(pendingInstall)}
        />
      )}

      {pendingRemove && (
        <ConfirmationPanel
          title={`移除 ${pendingRemove.displayName}？`}
          description="这只会删除应用管理的外部组件，不会删除 Project、资料或已经生成的预览缓存。需要时可以重新下载。"
          confirmLabel="确认移除"
          danger
          busy={requestPendingById.has(pendingRemove.id)}
          onCancel={onCancelRemove}
          onConfirm={() => onConfirmRemove(pendingRemove)}
        />
      )}
    </>
  );
}
