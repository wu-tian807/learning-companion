function FolderIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M2.5 5.5h5l1.4 1.6h8.6v8.4h-15Z" />
      <path d="M2.5 7.1V4.5h5l1.4 1" />
    </svg>
  );
}

interface GeneralSettingsSectionProps {
  readonly rootPath: string | undefined;
  readonly loading: boolean;
  readonly changeDisabled: boolean;
  readonly onSelectDirectory: () => void;
}

export function GeneralSettingsSection({
  rootPath,
  loading,
  changeDisabled,
  onSelectDirectory,
}: GeneralSettingsSectionProps) {
  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            外部组件位置
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            新组件会安装到这里；更换位置时会迁移已经安装的组件。
          </p>
        </div>
        <button
          type="button"
          disabled={changeDisabled}
          onClick={onSelectDirectory}
          className="ui-control flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/[0.12] px-3.5 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FolderIcon />
          更换位置
        </button>
      </div>
      <div className="mt-3 break-all rounded-xl border border-white/[0.07] bg-black/15 px-3.5 py-3 text-xs leading-5 text-slate-400">
        {rootPath ?? (loading ? '正在读取…' : '暂时无法读取路径')}
      </div>
    </section>
  );
}
