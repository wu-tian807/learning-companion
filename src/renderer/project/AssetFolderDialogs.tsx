import { useState } from 'react';

import { ASSET_FOLDER_NAME_MAX_LENGTH } from '../../shared/asset-folders';
import { SelectMenu } from '../components/SelectMenu';

interface AssetFolderNameDialogProps {
  readonly title: string;
  readonly initialName?: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (name: string) => Promise<boolean>;
}

export function AssetFolderNameDialog({
  title,
  initialName = '',
  busy,
  onClose,
  onSubmit,
}: AssetFolderNameDialogProps) {
  const [name, setName] = useState(initialName);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#282d35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(name).then((succeeded) => {
            if (succeeded) onClose();
          });
        }}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <input
          autoFocus
          value={name}
          maxLength={ASSET_FOLDER_NAME_MAX_LENGTH}
          disabled={busy}
          placeholder="文件夹名称"
          onChange={(event) => setName(event.target.value)}
          className="mt-5 h-11 w-full rounded-xl border border-white/[0.12] bg-black/15 px-3 text-sm outline-none focus:border-indigo-300/45"
        />
        <p className="mt-2 text-[10px] text-slate-500">
          名称会在 Windows 与 macOS 上保持一致。
        </p>
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

interface AssetFolderDestinationDialogProps {
  readonly title: string;
  readonly description: string;
  readonly destinations: readonly {
    readonly label: string;
    readonly path: string | null;
  }[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (path: string | null) => Promise<boolean>;
}

export function AssetFolderDestinationDialog({
  title,
  description,
  destinations,
  busy,
  onClose,
  onSubmit,
}: AssetFolderDestinationDialogProps) {
  const [value, setValue] = useState<string | null>(
    destinations[0]?.path ?? null,
  );
  const encodedValue = value ?? '';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#282d35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-xs leading-5 text-slate-400">{description}</p>
        <SelectMenu
          ariaLabel="目标文件夹"
          value={encodedValue}
          options={destinations.map((destination) => ({
            value: destination.path ?? '',
            label: destination.label,
          }))}
          onChange={(nextValue) => setValue(nextValue || null)}
          disabled={busy}
          className="mt-5"
        />
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
            disabled={busy || destinations.length === 0}
            onClick={() => {
              void onSubmit(value || null).then((succeeded) => {
                if (succeeded) onClose();
              });
            }}
            className="ui-primary-button rounded-full bg-slate-50 px-5 py-2 text-xs font-semibold text-slate-900 disabled:opacity-40"
          >
            {busy ? '移动中…' : '移动'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface AssetFolderDeleteDialogProps {
  readonly folderName: string;
  readonly assetCount: number;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<boolean>;
}

export function AssetFolderDeleteDialog({
  folderName,
  assetCount,
  busy,
  onClose,
  onConfirm,
}: AssetFolderDeleteDialogProps) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="删除资料文件夹"
        className="w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#282d35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
      >
        <h2 className="text-lg font-semibold">删除“{folderName}”？</h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          此文件夹、所有子文件夹和其中 {assetCount} 份资料会一起移除。
          复制到 Project 的文件会被删除，链接的外部原文件会保留。
        </p>
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
            onClick={() => {
              void onConfirm().then((succeeded) => {
                if (succeeded) onClose();
              });
            }}
            className="ui-danger-button rounded-full bg-rose-500 px-5 py-2 text-xs font-semibold"
          >
            {busy ? '删除中…' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
