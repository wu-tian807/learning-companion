import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ExternalLibrarySnapshot } from '../../shared/external-libraries';
import {
  createExternalLibraryStore,
  type ExternalLibraryRendererApi,
} from '../external-libraries/external-library-store';
import { FirstRunOnboarding } from './FirstRunOnboarding';

function createSnapshot(
  status: ExternalLibrarySnapshot['status'],
): ExternalLibrarySnapshot {
  if (status === 'unsupported') {
    return {
      id: 'libreoffice',
      displayName: 'LibreOffice',
      description: 'Office preview',
      category: 'document',
      version: '26.2.5',
      rootPath: '/Users/student/Documents/Learning Companion/externalLib',
      status,
    };
  }

  return {
    id: 'libreoffice',
    displayName: 'LibreOffice',
    description: 'Office preview',
    category: 'document',
    version: '26.2.5',
    expectedSize: 300_000_000,
    estimatedInstalledSize: 1_100 * 1024 * 1024,
    recommendedFreeSpace: 2_000 * 1024 * 1024,
    rootPath: '/Users/student/Documents/Learning Companion/externalLib',
    status,
    ...(status === 'downloading'
      ? {
          progress: {
            completedBytes: 150_000_000,
            totalBytes: 300_000_000,
          },
        }
      : {}),
  };
}

function createStore(...snapshots: ExternalLibrarySnapshot[]) {
  const api = {
    listExternalLibraries: vi.fn(async () => []),
    refreshExternalLibrary: vi.fn(),
    startExternalLibraryInstallation: vi.fn(),
    cancelExternalLibrary: vi.fn(),
    removeExternalLibrary: vi.fn(),
    selectExternalLibrariesDirectory: vi.fn(),
    migrateExternalLibraries: vi.fn(),
    onExternalLibraryChanged: vi.fn(() => () => undefined),
  } satisfies ExternalLibraryRendererApi;

  return createExternalLibraryStore(api, {
    librariesById: new Map(
      snapshots.map((snapshot) => [snapshot.id, snapshot]),
    ),
    initialized: true,
  });
}

describe('FirstRunOnboarding', () => {
  it('shows every registered external library instead of a separate hard-coded list', () => {
    const markup = renderToStaticMarkup(
      <FirstRunOnboarding
        store={createStore(
          createSnapshot('not-installed'),
          {
            id: 'media-subtitles',
            displayName: '视频/音频字幕组件',
            description: '生成视频与音频字幕',
            category: 'media',
            version: '2026.08.28',
            expectedSize: 1_292_000_000,
            rootPath:
              '/Users/student/Documents/Learning Companion/externalLib',
            status: 'not-installed',
          },
          {
            id: 'video-dubbing-voxcpm2',
            displayName: 'VoxCPM2 视频/音频配音组件',
            description: '生成 one-shot 人声克隆配音',
            category: 'media',
            version: '2026.08.29',
            expectedSize: 4_832_000_000,
            rootPath:
              '/Users/student/Documents/Learning Companion/externalLib',
            status: 'not-installed',
          },
        )}
        api={{ completeExternalLibraryOnboarding: vi.fn() }}
        onCompleted={vi.fn()}
      />,
    );

    expect(markup).toContain('LibreOffice');
    expect(markup).toContain('视频/音频字幕组件');
    expect(markup).toContain('VoxCPM2 视频/音频配音组件');
    expect(markup).toContain('生成视频与音频字幕');
    expect(markup).toContain('生成 one-shot 人声克隆配音');
  });

  it('offers the shared per-library installation controls without blocking entry', () => {
    const markup = renderToStaticMarkup(
      <FirstRunOnboarding
        store={createStore(createSnapshot('not-installed'))}
        api={{ completeExternalLibraryOnboarding: vi.fn() }}
        onCompleted={vi.fn()}
      />,
    );

    expect(markup).toContain('准备本地功能组件');
    expect(markup).toContain('官方来源');
    expect(markup).toContain('下载约 286 MB');
    expect(markup).toContain('安装后约 1.1 GB');
    expect(markup).toContain('建议预留 2.0 GB 可用空间');
    expect(markup).toContain('安装');
    expect(markup).toContain('开始使用');
    expect(markup).not.toContain('aria-label="关闭');
  });

  it('explains that an active installation continues in the background', () => {
    const markup = renderToStaticMarkup(
      <FirstRunOnboarding
        store={createStore(createSnapshot('downloading'))}
        api={{ completeExternalLibraryOnboarding: vi.fn() }}
        onCompleted={vi.fn()}
      />,
    );

    expect(markup).toContain('正在下载');
    expect(markup).toContain('50%');
    expect(markup).toContain('进入应用，后台继续');
  });

  it('never traps users on an unsupported platform', () => {
    const markup = renderToStaticMarkup(
      <FirstRunOnboarding
        store={createStore(createSnapshot('unsupported'))}
        api={{ completeExternalLibraryOnboarding: vi.fn() }}
        onCompleted={vi.fn()}
      />,
    );

    expect(markup).toContain('当前平台没有可下载的安装包');
    expect(markup).toContain('开始使用');
  });
});
