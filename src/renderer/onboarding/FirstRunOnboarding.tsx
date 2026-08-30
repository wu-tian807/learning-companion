import { useState } from 'react';

import {
  isAppSetupSnapshot,
  type AppSetupSnapshot,
} from '../../shared/app-setup';
import { userMessageFromError } from '../../shared/ipc-error';
import { ErrorDialog } from '../components/ErrorDialog';
import { ExternalLibrariesSection } from '../external-libraries/ExternalLibrariesSection';
import { ExternalLibraryConfirmationPanels } from '../external-libraries/ExternalLibraryConfirmationPanels';
import { ExternalLibraryLocationSection } from '../external-libraries/ExternalLibraryLocationSection';
import { ExternalLibraryMigrationConflictDialog } from '../external-libraries/ExternalLibraryMigrationConflictDialog';
import {
  externalLibraryStore,
  type ExternalLibraryStore,
} from '../external-libraries/external-library-store';
import { isExternalLibraryInstalling } from '../external-libraries/external-library-view';
import { useExternalLibraryManagement } from '../external-libraries/use-external-library-management';

export interface FirstRunOnboardingApi {
  completeExternalLibraryOnboarding(): Promise<AppSetupSnapshot>;
}

const defaultApi: FirstRunOnboardingApi = {
  completeExternalLibraryOnboarding: () =>
    window.learningCompanion.completeExternalLibraryOnboarding(),
};

interface FirstRunOnboardingProps {
  readonly onCompleted: (setup: AppSetupSnapshot) => void;
  readonly store?: ExternalLibraryStore;
  readonly api?: FirstRunOnboardingApi;
}

export function FirstRunOnboarding({
  onCompleted,
  store = externalLibraryStore,
  api = defaultApi,
}: FirstRunOnboardingProps) {
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
    cancelMigration,
    installLibrary,
    removeLibrary,
    cancelInstallation,
    migrate,
    selectMigrationTarget,
    reload,
  } = useExternalLibraryManagement(store);
  const [working, setWorking] = useState(false);
  const [completionError, setCompletionError] = useState<
    string | null
  >(null);
  const installationActive = libraries.some(({ status }) =>
    isExternalLibraryInstalling(status),
  );
  const actionOverlayOpen =
    pendingInstall !== null ||
    pendingRemove !== null ||
    migrationConflicts.length > 0;

  const completeOnboarding = async () => {
    setWorking(true);
    setCompletionError(null);

    try {
      const setup = await api.completeExternalLibraryOnboarding();

      if (!isAppSetupSnapshot(setup)) {
        throw new Error('首次运行引导状态响应无效');
      }

      onCompleted(setup);
    } catch (operationError) {
      setCompletionError(
        userMessageFromError(
          operationError,
          '无法保存首次运行设置，请重试。',
        ) ?? null,
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-[#0c1016]/88 p-6 backdrop-blur-md">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-title"
        className="relative flex max-h-[min(760px,calc(100vh-48px))] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-white/[0.12] bg-[#252a32] shadow-[0_34px_100px_rgba(0,0,0,0.6)]"
      >
        <header className="border-b border-white/[0.08] px-7 py-6">
          <span className="inline-flex rounded-full border border-indigo-200/15 bg-indigo-300/[0.06] px-3 py-1 text-[11px] font-medium text-indigo-200">
            首次设置
          </span>
          <h1
            id="first-run-title"
            className="mt-4 text-2xl font-semibold text-slate-100"
          >
            准备本地功能组件
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
            文档预览、视频与音频字幕、人声克隆配音都由下方按需组件提供。你可以现在安装，也可以先进入应用后在设置中安装。
          </p>
        </header>

        <div className="overflow-y-auto px-7 py-6">
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
            onInstall={setPendingInstall}
            onRemove={setPendingRemove}
            onCancel={(library) => {
              void cancelInstallation(library);
            }}
            onReload={() => {
              void reload();
            }}
          />
        </div>

        <footer className="flex items-center justify-end border-t border-white/[0.08] px-7 py-5">
          <button
            type="button"
            disabled={working || blockingBusy || actionOverlayOpen}
            onClick={() => {
              void completeOnboarding();
            }}
            className="ui-primary-button h-10 rounded-full bg-slate-50 px-5 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {working
              ? '正在保存…'
              : installationActive
                ? '进入应用，后台继续'
                : '开始使用'}
          </button>
        </footer>

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

      {(completionError || error) && (
        <ErrorDialog
          message={completionError ?? error ?? ''}
          onClose={() => {
            setCompletionError(null);
            clearError();
          }}
        />
      )}
    </div>
  );
}
