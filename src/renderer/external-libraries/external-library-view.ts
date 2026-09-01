import type {
  ExternalLibrarySnapshot,
  ExternalLibraryStatus,
} from '../../shared/external-libraries';

export const externalLibraryStatusLabels: Record<
  ExternalLibraryStatus,
  string
> = {
  'not-installed': '尚未安装',
  discovering: '正在检查',
  downloading: '正在下载',
  verifying: '正在校验',
  installing: '正在安装',
  available: '可用',
  invalid: '安装异常',
  migrating: '正在迁移',
  failed: '操作失败',
  unsupported: '当前平台暂不支持',
};

const activeStatuses = new Set<ExternalLibraryStatus>([
  'discovering',
  'downloading',
  'verifying',
  'installing',
  'migrating',
]);

const installationStatuses = new Set<ExternalLibraryStatus>([
  'downloading',
  'verifying',
  'installing',
]);

export function isExternalLibraryActive(
  status: ExternalLibraryStatus,
): boolean {
  return activeStatuses.has(status);
}

export function isExternalLibraryInstalling(
  status: ExternalLibraryStatus,
): boolean {
  return installationStatuses.has(status);
}

export function formatExternalLibrarySize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024) {
    const gigabytes = megabytes / 1024;
    return `${gigabytes >= 10 ? gigabytes.toFixed(0) : gigabytes.toFixed(1)} GB`;
  }
  return `${megabytes >= 100 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

export function externalLibraryStorageSummary(
  snapshot: Pick<
    ExternalLibrarySnapshot,
    'expectedSize' | 'estimatedInstalledSize' | 'recommendedFreeSpace'
  >,
): string {
  if (snapshot.expectedSize === undefined) {
    return '当前平台没有可下载的安装包';
  }
  const download = `下载约 ${formatExternalLibrarySize(snapshot.expectedSize)}`;
  if (
    snapshot.estimatedInstalledSize === undefined ||
    snapshot.recommendedFreeSpace === undefined
  ) {
    return download;
  }
  return `${download} · 安装后约 ${formatExternalLibrarySize(
    snapshot.estimatedInstalledSize,
  )} · 建议预留 ${formatExternalLibrarySize(
    snapshot.recommendedFreeSpace,
  )} 可用空间`;
}

export function externalLibraryProgressPercent(
  snapshot: ExternalLibrarySnapshot,
): number | undefined {
  return snapshot.progress
    ? Math.round(
        (snapshot.progress.completedBytes /
          snapshot.progress.totalBytes) *
          100,
      )
    : undefined;
}
