import type { RefObject } from 'react';

import type { ExternalLibrarySnapshot } from '../../shared/external-libraries';
import {
  externalLibraryProgressPercent,
  externalLibraryStatusLabels,
  formatExternalLibrarySize,
  isExternalLibraryActive,
} from '../external-libraries/external-library-view';
import type { SettingsTarget } from './settings-target';
import type { PendingExternalLibraryInstall } from './use-external-library-settings';

interface ExternalLibrariesSettingsSectionProps {
  readonly libraries: readonly ExternalLibrarySnapshot[];
  readonly loading: boolean;
  readonly loadError: string | undefined;
  readonly migrationPending: boolean;
  readonly hasActiveTask: boolean;
  readonly requestPendingById: ReadonlySet<string>;
  readonly target: SettingsTarget | undefined;
  readonly targetedLibraryRef: RefObject<HTMLElement | null>;
  readonly onInstall: (request: PendingExternalLibraryInstall) => void;
  readonly onRemove: (library: ExternalLibrarySnapshot) => void;
  readonly onCancel: (library: ExternalLibrarySnapshot) => void;
  readonly onReload: () => void;
}

export function ExternalLibrariesSettingsSection({
  libraries,
  loading,
  loadError,
  migrationPending,
  hasActiveTask,
  requestPendingById,
  target,
  targetedLibraryRef,
  onInstall,
  onRemove,
  onCancel,
  onReload,
}: ExternalLibrariesSettingsSectionProps) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-200">
        外部组件
      </h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        仅在需要时下载；文件来自组件官方来源并经过固定 SHA-256
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
          const active = isExternalLibraryActive(library.status);
          const targeted =
            target?.section === 'external-libraries' &&
            target.libraryId === library.id;
          const progress = externalLibraryProgressPercent(library);
          const requestInstallation = () => {
            if (library.expectedSize === undefined) return;
            onInstall({
              library,
              expectedSize: library.expectedSize,
            });
          };

          return (
            <article
              key={library.id}
              ref={targeted ? targetedLibraryRef : undefined}
              className={`mt-4 rounded-2xl border bg-white/[0.025] p-4.5 transition ${
                targeted
                  ? 'border-indigo-300/35 ring-2 ring-indigo-300/10'
                  : 'border-white/[0.09]'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-slate-100">
                      {library.displayName}
                    </h4>
                    <span className="rounded-full border border-white/[0.1] px-2 py-0.5 text-[10px] text-slate-500">
                      {library.category === 'document' ? '文档' : '媒体'}
                    </span>
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
                      {externalLibraryStatusLabels[library.status]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {library.description}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-600">
                    {library.expectedSize === undefined
                      ? '当前平台没有可下载的安装包'
                      : `下载内容约 ${formatExternalLibrarySize(
                          library.expectedSize,
                        )}`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {library.status === 'available' ||
                  library.status === 'invalid' ? (
                    <button
                      type="button"
                      disabled={
                        migrationPending ||
                        hasActiveTask ||
                        requestPendingById.has(library.id)
                      }
                      onClick={() => onRemove(library)}
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
                        disabled={requestPendingById.has(library.id)}
                        onClick={() => onCancel(library)}
                        className="ui-control h-9 rounded-full border border-white/[0.1] px-3.5 text-xs text-slate-300 disabled:opacity-40"
                      >
                        {requestPendingById.has(library.id)
                          ? '取消中…'
                          : '取消'}
                      </button>
                    ) : null
                  ) : library.status === 'unsupported' ? null : (
                    <button
                      type="button"
                      disabled={
                        migrationPending ||
                        hasActiveTask ||
                        requestPendingById.has(library.id)
                      }
                      onClick={requestInstallation}
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
                        progress === undefined
                          ? 'w-1/3 animate-pulse'
                          : ''
                      }`}
                      style={
                        progress === undefined
                          ? undefined
                          : { width: `${progress}%` }
                      }
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {externalLibraryStatusLabels[library.status]}
                    {progress === undefined
                      ? ''
                      : ` · ${progress}%`}
                  </p>
                </div>
              )}
            </article>
          );
        })}

      {loadError && (
        <div
          role="alert"
          className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-rose-300/15 bg-rose-400/[0.05] px-3.5 py-3 text-xs leading-5 text-rose-200"
        >
          <span>{loadError}</span>
          <button
            type="button"
            disabled={loading}
            onClick={onReload}
            className="ui-control h-8 shrink-0 rounded-full border border-rose-200/15 px-3 text-xs disabled:opacity-40"
          >
            重试
          </button>
        </div>
      )}
    </section>
  );
}
