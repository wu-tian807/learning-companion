import { useEffect, useState } from 'react';

import { ErrorDialog } from '../components/ErrorDialog';
import { ExternalLibraryMigrationConflictDialog } from '../external-libraries/ExternalLibraryMigrationConflictDialog';
import {
  externalLibraryStore,
  type ExternalLibraryStore,
} from '../external-libraries/external-library-store';
import {
  formatExternalLibrarySize,
} from '../external-libraries/external-library-view';
import { AgentProviderSettingsSection } from './AgentProviderSettingsSection';
import { ExternalLibrariesSettingsSection } from './ExternalLibrariesSettingsSection';
import { GeneralSettingsSection } from './GeneralSettingsSection';
import type { SettingsTarget } from './settings-target';
import { useExternalLibrarySettings } from './use-external-library-settings';

interface SettingsDialogProps {
  readonly onClose: () => void;
  readonly target?: SettingsTarget;
  readonly store?: ExternalLibraryStore;
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

export function SettingsDialog({
  onClose,
  target,
  store = externalLibraryStore,
}: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<
    'general' | 'agent-providers'
  >(
    target?.section === 'agent-providers'
      ? 'agent-providers'
      : 'general',
  );
  const {
    libraries,
    loading,
    loadError,
    requestPendingById,
    migrationPending,
    rootPath,
    hasActiveTask,
    blockingBusy,
    error,
    clearError,
    pendingInstall,
    setPendingInstall,
    pendingRemove,
    setPendingRemove,
    migrationTarget,
    migrationConflicts,
    targetedLibraryRef,
    cancelMigration,
    installLibrary,
    removeLibrary,
    cancelInstallation,
    migrate,
    selectMigrationTarget,
    reload,
  } = useExternalLibrarySettings(store, target);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !blockingBusy &&
        !pendingInstall &&
        !pendingRemove &&
        migrationConflicts.length === 0
      ) {
        onClose();
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () =>
      document.removeEventListener('keydown', closeOnEscape);
  }, [
    migrationConflicts.length,
    onClose,
    blockingBusy,
    pendingInstall,
    pendingRemove,
  ]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !blockingBusy &&
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
          </div>
          <button
            type="button"
            aria-label="关闭设置"
            disabled={blockingBusy}
            onClick={onClose}
            className="ui-icon-button grid size-9 place-items-center rounded-full text-slate-500 disabled:opacity-40"
          >
            <CloseIcon />
          </button>
        </header>

        <nav
          aria-label="设置分类"
          className="flex gap-1 border-b border-white/[0.08] px-6 py-2"
        >
          {[
            ['general', '常规'],
            ['agent-providers', 'AI Provider'],
          ].map(([section, label]) => (
            <button
              key={section}
              type="button"
              aria-current={
                activeSection === section ? 'page' : undefined
              }
              onClick={() =>
                setActiveSection(
                  section as 'general' | 'agent-providers',
                )
              }
              className={`ui-control rounded-lg px-3 py-2 text-xs ${
                activeSection === section
                  ? 'bg-white/[0.08] text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="overflow-y-auto px-6 py-5">
          {activeSection === 'general' ? (
            <>
              <GeneralSettingsSection
                rootPath={rootPath}
                loading={loading}
                changeDisabled={
                  loading ||
                  migrationPending ||
                  hasActiveTask ||
                  !rootPath
                }
                onSelectDirectory={() => {
                  void selectMigrationTarget();
                }}
              />

              <div className="my-5 h-px bg-white/[0.08]" />

              <ExternalLibrariesSettingsSection
                libraries={libraries}
                loading={loading}
                loadError={loadError}
                migrationPending={migrationPending}
                hasActiveTask={hasActiveTask}
                requestPendingById={requestPendingById}
                target={target}
                targetedLibraryRef={targetedLibraryRef}
                onInstall={setPendingInstall}
                onRemove={setPendingRemove}
                onCancel={(library) => {
                  void cancelInstallation(library);
                }}
                onReload={() => {
                  void reload();
                }}
              />
            </>
          ) : (
            <AgentProviderSettingsSection />
          )}
        </div>

        {pendingInstall && (
            <ConfirmationPanel
              title={`安装 ${pendingInstall.library.displayName}？`}
              description={`固定组件资源约 ${formatExternalLibrarySize(
                pendingInstall.expectedSize,
              )}。${pendingInstall.library.description} 安装时会在“${pendingInstall.library.rootPath}”内完成全部运行环境与校验；如需更换磁盘，请先取消并使用“更换位置”。`}
              confirmLabel="下载并安装"
              busy={requestPendingById.has(
                pendingInstall.library.id,
              )}
              onCancel={() => setPendingInstall(null)}
              onConfirm={() => {
                void installLibrary(pendingInstall);
              }}
            />
          )}

        {pendingRemove && (
          <ConfirmationPanel
            title={`移除 ${pendingRemove.displayName}？`}
            description="这只会删除应用管理的外部组件，不会删除 Project、资料或已经生成的预览缓存。需要时可以重新下载。"
            confirmLabel="确认移除"
            danger
            busy={requestPendingById.has(pendingRemove.id)}
            onCancel={() => setPendingRemove(null)}
            onConfirm={() => {
              void removeLibrary(pendingRemove);
            }}
          />
        )}

        {migrationTarget && migrationConflicts.length > 0 && (
          <ExternalLibraryMigrationConflictDialog
            targetPath={migrationTarget}
            conflicts={migrationConflicts}
            busy={migrationPending}
            onCancel={cancelMigration}
            onResolve={(resolution) => {
              void migrate(migrationTarget, resolution);
            }}
          />
        )}
      </section>
      {error && (
        <ErrorDialog message={error} onClose={clearError} />
      )}
    </div>
  );
}
