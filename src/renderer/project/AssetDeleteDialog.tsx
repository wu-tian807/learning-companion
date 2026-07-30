import type { AssetSnapshot } from '../../shared/assets';

interface AssetDeleteDialogProps {
  readonly asset: AssetSnapshot;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function AssetDeleteDialog({
  asset,
  busy,
  error,
  onClose,
  onConfirm,
}: AssetDeleteDialogProps) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#282d35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]">
        <h2 className="text-lg font-semibold">
          从 Project 中移除 Asset？
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          “{asset.name}”的记录将从当前 Project 中移除，本地原文件不会被删除。
        </p>
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="ui-danger-button rounded-full bg-rose-500 px-5 py-2 text-xs font-semibold"
          >
            {busy ? '移除中…' : '确认移除'}
          </button>
        </div>
      </div>
    </div>
  );
}
