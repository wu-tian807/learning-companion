import { useEffect, useState } from 'react';

import { ErrorDialog } from '../components/ErrorDialog';
import { ExternalLibrariesSection } from '../external-libraries/ExternalLibrariesSection';
import { ExternalLibraryConfirmationPanels } from '../external-libraries/ExternalLibraryConfirmationPanels';
import { ExternalLibraryLocationSection } from '../external-libraries/ExternalLibraryLocationSection';
import { ExternalLibraryMigrationConflictDialog } from '../external-libraries/ExternalLibraryMigrationConflictDialog';
import {
  externalLibraryStore,
  type ExternalLibraryStore,
} from '../external-libraries/external-library-store';
import { useExternalLibraryManagement } from '../external-libraries/use-external-library-management';
import { AgentProviderSettingsSection } from './AgentProviderSettingsSection';
import type { SettingsTarget } from './settings-target';

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
  } = useExternalLibraryManagement(
    store,
    target?.section === 'external-libraries'
      ? target.libraryId
      : undefined,
  );

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
              <ExternalLibraryLocationSection
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

              <ExternalLibrariesSection
                libraries={libraries}
                loading={loading}
                loadError={loadError}
                migrationPending={migrationPending}
                hasActiveTask={hasActiveTask}
                requestPendingById={requestPendingById}
                targetedLibraryId={
                  target?.section === 'external-libraries'
                    ? target.libraryId
                    : undefined
                }
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

        <ExternalLibraryConfirmationPanels
          pendingInstall={pendingInstall}
          pendingRemove={pendingRemove}
          requestPendingById={requestPendingById}
          onCancelInstall={() => setPendingInstall(null)}
          onConfirmInstall={(request) => {
            void installLibrary(request);
          }}
          onCancelRemove={() => setPendingRemove(null)}
          onConfirmRemove={(library) => {
            void removeLibrary(library);
          }}
        />

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
