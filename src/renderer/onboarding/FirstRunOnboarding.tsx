import { useMemo, useState } from 'react';
import { useStore } from 'zustand';

import {
  isAppSetupSnapshot,
  type AppSetupSnapshot,
} from '../../shared/app-setup';
import type {
  ExternalLibraryMigrationConflict,
  ExternalLibraryMigrationConflictResolution,
} from '../../shared/external-libraries';
import { userMessageFromError } from '../../shared/ipc-error';
import { ErrorDialog } from '../components/ErrorDialog';
import { ExternalLibraryMigrationConflictDialog } from '../external-libraries/ExternalLibraryMigrationConflictDialog';
import {
  externalLibraryStore,
  type ExternalLibraryStore,
} from '../external-libraries/external-library-store';
import {
  externalLibraryProgressPercent,
  externalLibraryStatusLabels,
  formatExternalLibrarySize,
  isExternalLibraryActive,
  isExternalLibraryInstalling,
} from '../external-libraries/external-library-view';
import {
  OnboardingDecisionError,
  runOnboardingDecision,
  type OnboardingDecision,
} from './onboarding-decision';

const RECOMMENDED_LIBRARY_ID = 'libreoffice';

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

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="size-4"
      aria-hidden="true"
    >
      <path d="M2.5 5.5h5l1.4 1.6h8.6v8.4h-15Z" />
      <path d="M2.5 7.1V4.5h5l1.4 1" />
    </svg>
  );
}

export function FirstRunOnboarding({
  onCompleted,
  store = externalLibraryStore,
  api = defaultApi,
}: FirstRunOnboardingProps) {
  const librariesById = useStore(
    store,
    (state) => state.librariesById,
  );
  const loading = useStore(store, (state) => state.loading);
  const loadError = useStore(store, (state) => state.loadError);
  const migrationPending = useStore(
    store,
    (state) => state.migrationPending,
  );
  const library = librariesById.get(RECOMMENDED_LIBRARY_ID);
  const [working, setWorking] = useState(false);
  const [installationAccepted, setInstallationAccepted] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrationTarget, setMigrationTarget] = useState<string | null>(
    null,
  );
  const [migrationConflicts, setMigrationConflicts] = useState<
    readonly ExternalLibraryMigrationConflict[]
  >([]);
  const progress = library
    ? externalLibraryProgressPercent(library)
    : undefined;
  const active = library
    ? isExternalLibraryActive(library.status)
    : false;
  const installing = library
    ? isExternalLibraryInstalling(library.status)
    : false;
  const primaryLabel = useMemo(() => {
    if (!library) {
      return loading ? '正在检查组件…' : '组件状态不可用';
    }
    if (library.status === 'available') {
      return '开始使用';
    }
    if (library.status === 'unsupported') {
      return '开始使用';
    }
    if (installing || installationAccepted) {
      return '进入应用，后台继续';
    }
    if (library.status === 'failed') {
      return '重新安装推荐组件';
    }
    if (library.status === 'invalid') {
      return '请稍后在设置中处理';
    }
    if (library.status === 'discovering') {
      return '正在检查组件…';
    }
    if (library.status === 'migrating') {
      return '正在迁移组件…';
    }

    return '安装推荐组件';
  }, [installationAccepted, installing, library, loading]);
  const primaryDisabled =
    working ||
    migrationPending ||
    !library ||
    library.status === 'discovering' ||
    library.status === 'migrating' ||
    library.status === 'invalid';

  const completeChoice = async (decision: OnboardingDecision) => {
    setWorking(true);
    setError(null);

    try {
      const result = await runOnboardingDecision({
        decision,
        libraryStatus: library?.status,
        installationAccepted,
        startInstallation: async () => {
          await store
            .getState()
            .startInstallation(RECOMMENDED_LIBRARY_ID);
        },
        completeOnboarding: async () => {
          const setup =
            await api.completeExternalLibraryOnboarding();

          if (!isAppSetupSnapshot(setup)) {
            throw new Error('首次运行引导状态响应无效');
          }

          return setup;
        },
      });

      setInstallationAccepted(result.installationAccepted);
      onCompleted(result.setup);
    } catch (decisionError) {
      if (decisionError instanceof OnboardingDecisionError) {
        setInstallationAccepted(
          decisionError.installationAccepted,
        );
        const details =
          userMessageFromError(
            decisionError.cause,
            decisionError.stage === 'start-installation'
              ? '无法开始推荐组件安装，请重试。'
              : '无法保存首次运行设置，请重试。',
          ) ?? '操作未完成，请重试。';

        setError(
          decisionError.stage === 'persist-completion' &&
            decisionError.installationAccepted
            ? `组件已在后台继续安装，但引导状态未能保存。${details}`
            : details,
        );
      } else {
        setError(
          userMessageFromError(
            decisionError,
            '无法完成首次运行设置，请重试。',
          ) ?? null,
        );
      }
    } finally {
      setWorking(false);
    }
  };

  const migrate = async (
    targetPath: string,
    conflictResolution?: ExternalLibraryMigrationConflictResolution,
  ) => {
    setError(null);

    try {
      const result = await store
        .getState()
        .migrateLibraries(targetPath, conflictResolution);

      if (result.status === 'conflict') {
        setMigrationTarget(result.rootPath);
        setMigrationConflicts(result.conflicts);
        return;
      }

      setMigrationTarget(null);
      setMigrationConflicts([]);
    } catch (migrationError) {
      setError(
        userMessageFromError(
          migrationError,
          '外部组件位置更改失败，仍将使用原位置。',
        ) ?? null,
      );
    }
  };

  const selectLocation = async () => {
    setError(null);

    try {
      const selected = await store.getState().selectDirectory();

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
            准备本地文档处理组件
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
            提前安装后，DOC、DOCX、PPT 和 PPTX
            可以直接转换为可分页、可选择文字的预览。安装会在后台继续，不会锁住应用。
          </p>
        </header>

        <div className="overflow-y-auto px-7 py-6">
          <article className="rounded-[18px] border border-white/[0.09] bg-white/[0.025] p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-100">
                    LibreOffice
                  </h2>
                  {library && (
                    <>
                      <span className="rounded-full border border-white/[0.1] px-2 py-0.5 text-[10px] text-slate-500">
                        {library.version}
                      </span>
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-slate-400">
                        {externalLibraryStatusLabels[library.status]}
                      </span>
                    </>
                  )}
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  官方来源 · 固定版本与 SHA-256 校验 · 仅供 Learning
                  Companion 本地文档转换使用
                </p>
                <p className="mt-1 text-[11px] text-slate-600">
                  {library?.expectedSize === undefined
                    ? library?.status === 'unsupported'
                      ? '当前平台没有可下载的安装包'
                      : '正在读取安装包信息…'
                    : `预计下载 ${formatExternalLibrarySize(
                        library.expectedSize,
                      )}`}
                </p>
              </div>
            </div>

            {(active || loading) && (
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
                  {library
                    ? externalLibraryStatusLabels[library.status]
                    : '正在读取组件状态'}
                  {progress === undefined ? '' : ` · ${progress}%`}
                </p>
              </div>
            )}

            {loadError && (
              <div
                role="alert"
                className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-rose-300/15 bg-rose-400/[0.05] px-3.5 py-3 text-xs leading-5 text-rose-200"
              >
                <span>{loadError}</span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    void store.getState().reload();
                  }}
                  className="ui-control h-8 shrink-0 rounded-full border border-rose-200/15 px-3 text-xs disabled:opacity-40"
                >
                  重试
                </button>
              </div>
            )}
          </article>

          <section className="mt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">
                  存储位置
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  之后仍可在设置中迁移到其他磁盘。
                </p>
              </div>
              <button
                type="button"
                disabled={
                  working ||
                  migrationPending ||
                  active ||
                  !library
                }
                onClick={() => {
                  void selectLocation();
                }}
                className="ui-control flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/[0.12] px-3.5 text-xs text-slate-300 disabled:opacity-40"
              >
                <FolderIcon />
                更改位置
              </button>
            </div>
            <p className="mt-3 break-all rounded-xl border border-white/[0.07] bg-black/15 px-3.5 py-3 text-xs leading-5 text-slate-400">
              {library?.rootPath ??
                (loading ? '正在读取…' : '暂时无法读取路径')}
            </p>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2.5 border-t border-white/[0.08] px-7 py-5">
          <button
            type="button"
            disabled={working || migrationPending}
            onClick={() => {
              void completeChoice('skip');
            }}
            className="ui-control h-10 rounded-full border border-white/[0.12] px-4 text-sm text-slate-300 disabled:opacity-40"
          >
            暂不安装
          </button>
          <button
            type="button"
            disabled={primaryDisabled}
            onClick={() => {
              void completeChoice('install');
            }}
            className="ui-primary-button h-10 rounded-full bg-slate-50 px-5 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {working ? '正在保存…' : primaryLabel}
          </button>
        </footer>

        {migrationTarget && migrationConflicts.length > 0 && (
          <ExternalLibraryMigrationConflictDialog
            targetPath={migrationTarget}
            conflicts={migrationConflicts}
            busy={migrationPending}
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

      {error && (
        <ErrorDialog message={error} onClose={() => setError(null)} />
      )}
    </div>
  );
}
