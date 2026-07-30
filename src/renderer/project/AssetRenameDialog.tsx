import { useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';

interface AssetRenameDialogProps {
  readonly asset: AssetSnapshot;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (name: string) => void;
}

export function AssetRenameDialog({
  asset,
  busy,
  error,
  onClose,
  onSubmit,
}: AssetRenameDialogProps) {
  const [name, setName] = useState(asset.name);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]">
      <form
        className="w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#282d35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(name);
        }}
      >
        <h2 className="text-lg font-semibold">编辑 Asset 标题</h2>
        <input
          autoFocus
          value={name}
          maxLength={160}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          className="mt-5 h-11 w-full rounded-xl border border-white/[0.12] bg-black/15 px-3 text-sm outline-none focus:border-indigo-300/45"
        />
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
            type="submit"
            disabled={busy || name.trim().length === 0}
            className="ui-primary-button rounded-full bg-slate-50 px-5 py-2 text-xs font-semibold text-slate-900 disabled:opacity-40"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}
