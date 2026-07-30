import type {
  ExternalLibraryMigrationConflict,
  ExternalLibraryMigrationConflictResolution,
} from '../../shared/external-libraries';

interface ExternalLibraryMigrationConflictDialogProps {
  readonly targetPath: string;
  readonly conflicts: readonly ExternalLibraryMigrationConflict[];
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onResolve: (
    resolution: ExternalLibraryMigrationConflictResolution,
  ) => void;
}

export function ExternalLibraryMigrationConflictDialog({
  targetPath,
  conflicts,
  busy,
  onCancel,
  onResolve,
}: ExternalLibraryMigrationConflictDialogProps) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-[22px] bg-[#20242b]/94 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[18px] border border-amber-200/15 bg-[#2a2f37] p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-100">
          目标位置已有同名组件
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {conflicts.map(({ displayName }) => displayName).join('、')}
          的目标目录已经存在。保留目标会跳过这些组件，并留下原目录中的文件；替换目标会使用当前已验证的组件。
        </p>
        <p className="mt-3 break-all rounded-xl bg-black/15 px-3 py-2 text-[11px] leading-5 text-slate-500">
          {targetPath}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="ui-control h-9 rounded-full border border-white/[0.12] px-4 text-xs text-slate-300 disabled:opacity-40"
          >
            取消迁移
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onResolve('keep-target')}
            className="ui-control h-9 rounded-full border border-white/[0.12] px-4 text-xs text-slate-200 disabled:opacity-40"
          >
            保留目标并跳过
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onResolve('replace-target')}
            className="ui-primary-button h-9 rounded-full bg-slate-50 px-4 text-xs font-semibold text-slate-900 disabled:opacity-50"
          >
            {busy ? '迁移中…' : '替换目标'}
          </button>
        </div>
      </div>
    </div>
  );
}
