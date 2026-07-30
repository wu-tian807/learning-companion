import { useEffect, useMemo, useState } from 'react';

import {
  isExternalLibrarySnapshot,
  type ExternalLibraryMigrationConflict,
  type ExternalLibraryMigrationConflictResolution,
  type ExternalLibrarySnapshot,
} from '../../shared/external-libraries';
import { userMessageFromError } from '../../shared/ipc-error';

interface SettingsDialogProps {
  readonly onClose: () => void;
}

const activeStatuses = new Set<ExternalLibrarySnapshot['status']>([
  'discovering',
  'downloading',
  'verifying',
  'installing',
  'migrating',
]);

const statusLabels: Record<ExternalLibrarySnapshot['status'], string> = {
  'not-installed': '尚未安装',
  discovering: '正在检查',
  downloading: '正在下载',
  verifying: '正在校验',
  installing: '正在安装',
  available: '可用',
  invalid: '安装异常',
  migrating: '正在迁移',
  failed: '操作失败',
};

function formatExternalLibrarySize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 100 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

function updateLibrary(
  libraries: readonly ExternalLibrarySnapshot[],
  snapshot: ExternalLibrarySnapshot,
): ExternalLibrarySnapshot[] {
  const index = libraries.findIndex(({ id }) => id === snapshot.id);

  if (index < 0) {
    return [...libraries, snapshot];
  }

  return libraries.map((library, libraryIndex) =>
    libraryIndex === index ? snapshot : library,
  );
}

function CloseIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

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

interface MigrationConflictPanelProps {
  readonly targetPath: string;
  readonly conflicts: readonly ExternalLibraryMigrationConflict[];
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onResolve: (
    resolution: ExternalLibraryMigrationConflictResolution,
  ) => void;
}

function MigrationConflictPanel({
  targetPath,
  conflicts,
  busy,
  onCancel,
  onResolve,
}: MigrationConflictPanelProps) {
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

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [libraries, setLibraries] = useState<
    readonly ExternalLibrarySnapshot[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] =
    useState<ExternalLibrarySnapshot | null>(null);
  const [pendingRemove, setPendingRemove] =
    useState<ExternalLibrarySnapshot | null>(null);
  const [migrationTarget, setMigrationTarget] = useState<string | null>(
    null,
  );
  const [migrationConflicts, setMigrationConflicts] = useState<
    readonly ExternalLibraryMigrationConflict[]
  >([]);
  const [operationBusy, setOperationBusy] = useState(false);
  const rootPath = libraries[0]?.rootPath;
  const hasActiveTask = useMemo(
    () => libraries.some(({ status }) => activeStatuses.has(status)),
    [libraries],
  );

  useEffect(() => {
    let active = true;
    const dispose = window.learningCompanion.onExternalLibraryChanged(
      (snapshot) => {
        if (active) {
          setLibraries((current) => updateLibrary(current, snapshot));
        }
      },
    );

    void window.learningCompanion
      .listExternalLibraries()
      .then((snapshots) => {
        if (
          !Array.isArray(snapshots) ||
          !snapshots.every(isExternalLibrarySnapshot)
        ) {
          throw new Error('外部组件状态响应无效');
        }

        if (active) {
          setLibraries(snapshots);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            userMessageFromError(
              loadError,
              '无法读取外部组件状态，请重试。',
            ) ?? null,
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      dispose();
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !operationBusy &&
        !pendingInstall &&
        !pendingRemove &&
        migrationConflicts.length === 0
      ) {
        onClose();
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [
    migrationConflicts.length,
    onClose,
    operationBusy,
    pendingInstall,
    pendingRemove,
  ]);

  const runLibraryMutation = async (
    operation: () => Promise<ExternalLibrarySnapshot>,
    fallbackMessage: string,
  ) => {
    setOperationBusy(true);
    setError(null);

    try {
      const snapshot = await operation();

      if (!isExternalLibrarySnapshot(snapshot)) {
        throw new Error('外部组件状态响应无效');
      }

      setLibraries((current) => updateLibrary(current, snapshot));
    } catch (operationError) {
      setError(
        userMessageFromError(operationError, fallbackMessage) ?? null,
      );
    } finally {
      setOperationBusy(false);
    }
  };

  const installLibrary = (library: ExternalLibrarySnapshot) => {
    setPendingInstall(null);
    void runLibraryMutation(
      () =>
        window.learningCompanion.installExternalLibrary({
          libraryId: library.id,
        }),
      '外部组件安装失败，请重试。',
    );
  };

  const removeLibrary = (library: ExternalLibrarySnapshot) => {
    setPendingRemove(null);
    void runLibraryMutation(
      () =>
        window.learningCompanion.removeExternalLibrary({
          libraryId: library.id,
        }),
      '无法移除外部组件，请重试。',
    );
  };

  const cancelInstallation = async (
    library: ExternalLibrarySnapshot,
  ) => {
    setError(null);

    try {
      await window.learningCompanion.cancelExternalLibrary({
        libraryId: library.id,
      });
    } catch (cancelError) {
      setError(
        userMessageFromError(
          cancelError,
          '无法取消外部组件安装，请稍后重试。',
        ) ?? null,
      );
    }
  };

  const migrate = async (
    targetPath: string,
    conflictResolution?: ExternalLibraryMigrationConflictResolution,
  ) => {
    setOperationBusy(true);
    setError(null);

    try {
      const result =
        await window.learningCompanion.migrateExternalLibraries({
          targetPath,
          conflictResolution,
        });

      if (result.status === 'conflict') {
        setMigrationTarget(result.rootPath);
        setMigrationConflicts(result.conflicts);
        return;
      }

      setLibraries(result.libraries);
      setMigrationTarget(null);
      setMigrationConflicts([]);
    } catch (migrationError) {
      setError(
        userMessageFromError(
          migrationError,
          '外部组件迁移失败，应用仍将使用原位置。',
        ) ?? null,
      );
    } finally {
      setOperationBusy(false);
    }
  };

  const selectMigrationTarget = async () => {
    setError(null);

    try {
      const selected =
        await window.learningCompanion.selectExternalLibrariesDirectory();

      if (selected) {
        await migrate(selected);
      }
    } catch (selectionError) {
      setError(
        userMessageFromError(
          selectionError,
          '无法选择外部组件存储位置。',
        ) ?? null,
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !operationBusy &&
          !pendingInstall &&
          !pendingRemove &&
          migrationConflicts.length === 0
        ) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className="relative flex max-h-[min(760px,calc(100vh-48px))] w-full max-w-2xl flex-col overflow-hidden rounded-[22px] border border-white/[0.12] bg-[#252a32] shadow-[0_34px_100px_rgba(0,0,0,0.58)]"
      >
        <header className="flex items-start justify-between border-b border-white/[0.08] px-6 py-5">
          <div>
            <h2
              id="settings-dialog-title"
              className="text-xl font-semibold text-slate-100"
            >
              设置
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              管理可选的本地处理组件及其存储位置
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭设置"
            disabled={operationBusy}
            onClick={onClose}
            className="ui-icon-button grid size-9 place-items-center rounded-full text-slate-500 disabled:opacity-40"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5">
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
                disabled={
                  loading || operationBusy || hasActiveTask || !rootPath
                }
                onClick={() => {
                  void selectMigrationTarget();
                }}
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

          <div className="my-5 h-px bg-white/[0.08]" />

          <section>
            <h3 className="text-sm font-semibold text-slate-200">
              文档处理组件
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              仅在需要时下载；安装包来自组件官方网站并经过固定 SHA-256
              校验。
            </p>

            {loading && (
              <div className="mt-4 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
                <div className="h-4 w-28 rounded bg-white/[0.08]" />
                <div className="mt-4 h-2 w-full rounded bg-white/[0.05]" />
              </div>
            )}

            {!loading &&
              libraries.map((library) => {
                const active = activeStatuses.has(library.status);
                const progress = library.progress
                  ? Math.round(
                      (library.progress.completedBytes /
                        library.progress.totalBytes) *
                        100,
                    )
                  : undefined;

                return (
                  <article
                    key={library.id}
                    className="mt-4 rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4.5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-slate-100">
                            {library.displayName}
                          </h4>
                          <span className="rounded-full border border-white/[0.1] px-2 py-0.5 text-[10px] text-slate-500">
                            {library.version}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] ${
                              library.status === 'available'
                                ? 'bg-emerald-300/10 text-emerald-200'
                                : library.status === 'invalid' ||
                                    library.status === 'failed'
                                  ? 'bg-rose-300/10 text-rose-200'
                                  : 'bg-white/[0.06] text-slate-400'
                            }`}
                          >
                            {statusLabels[library.status]}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          用于将 DOC、DOCX、PPT 和 PPTX
                          转换为可分页、可选中文字的 PDF 预览。
                        </p>
                        <p className="mt-1 text-[11px] text-slate-600">
                          官方安装包约{' '}
                          {formatExternalLibrarySize(
                            library.expectedSize,
                          )}
                        </p>
                      </div>

                      <div className="shrink-0">
                        {library.status === 'available' ||
                        library.status === 'invalid' ? (
                          <button
                            type="button"
                            disabled={operationBusy || hasActiveTask}
                            onClick={() => setPendingRemove(library)}
                            className="ui-control h-9 rounded-full border border-white/[0.1] px-3.5 text-xs text-slate-400 disabled:opacity-40"
                          >
                            {library.status === 'invalid'
                              ? '清理异常安装'
                              : '移除'}
                          </button>
                        ) : active ? (
                          library.status === 'downloading' ||
                          library.status === 'verifying' ||
                          library.status === 'installing' ? (
                            <button
                              type="button"
                              onClick={() => {
                                void cancelInstallation(library);
                              }}
                              className="ui-control h-9 rounded-full border border-white/[0.1] px-3.5 text-xs text-slate-300"
                            >
                              取消
                            </button>
                          ) : null
                        ) : (
                          <button
                            type="button"
                            disabled={operationBusy || hasActiveTask}
                            onClick={() => setPendingInstall(library)}
                            className="ui-primary-button h-9 rounded-full bg-slate-50 px-4 text-xs font-semibold text-slate-900 disabled:opacity-40"
                          >
                            {library.status === 'failed'
                              ? '重新安装'
                              : '安装'}
                          </button>
                        )}
                      </div>
                    </div>

                    {active && (
                      <div className="mt-4">
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className={`h-full rounded-full bg-indigo-300/70 transition-[width] ${
                              progress === undefined ? 'w-1/3 animate-pulse' : ''
                            }`}
                            style={
                              progress === undefined
                                ? undefined
                                : { width: `${progress}%` }
                            }
                          />
                        </div>
                        <p className="mt-2 text-[11px] text-slate-500">
                          {statusLabels[library.status]}
                          {progress === undefined ? '' : ` · ${progress}%`}
                        </p>
                      </div>
                    )}
                  </article>
                );
              })}
          </section>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-rose-300/15 bg-rose-400/[0.05] px-3.5 py-3 text-xs leading-5 text-rose-200"
            >
              {error}
            </p>
          )}
        </div>

        {pendingInstall && (
          <ConfirmationPanel
            title={`安装 ${pendingInstall.displayName}？`}
            description={`将从官方网站下载约 ${formatExternalLibrarySize(
              pendingInstall.expectedSize,
            )} 的安装包，并安装到“${pendingInstall.rootPath}”。如需更换磁盘，请先取消并使用“更换位置”。`}
            confirmLabel="下载并安装"
            busy={operationBusy}
            onCancel={() => setPendingInstall(null)}
            onConfirm={() => installLibrary(pendingInstall)}
          />
        )}

        {pendingRemove && (
          <ConfirmationPanel
            title={`移除 ${pendingRemove.displayName}？`}
            description="这只会删除应用管理的外部组件，不会删除 Project、资料或已经生成的预览缓存。需要时可以重新下载。"
            confirmLabel="确认移除"
            danger
            busy={operationBusy}
            onCancel={() => setPendingRemove(null)}
            onConfirm={() => removeLibrary(pendingRemove)}
          />
        )}

        {migrationTarget && migrationConflicts.length > 0 && (
          <MigrationConflictPanel
            targetPath={migrationTarget}
            conflicts={migrationConflicts}
            busy={operationBusy}
            onCancel={() => {
              setMigrationTarget(null);
              setMigrationConflicts([]);
            }}
            onResolve={(resolution) => {
              void migrate(migrationTarget, resolution);
            }}
          />
        )}
      </section>
    </div>
  );
}
