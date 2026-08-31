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

function createStore(snapshot: ExternalLibrarySnapshot) {
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
    librariesById: new Map([[snapshot.id, snapshot]]),
    initialized: true,
  });
}

describe('FirstRunOnboarding', () => {
  it('offers a clear background installation or explicit skip', () => {
    const markup = renderToStaticMarkup(
      <FirstRunOnboarding
        store={createStore(createSnapshot('not-installed'))}
        api={{ completeExternalLibraryOnboarding: vi.fn() }}
        onCompleted={vi.fn()}
      />,
    );

    expect(markup).toContain('准备本地文档处理组件');
    expect(markup).toContain('官方来源');
    expect(markup).toContain('预计下载 286 MB');
    expect(markup).toContain('安装推荐组件');
    expect(markup).toContain('暂不安装');
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
    expect(markup).toContain('暂不安装');
  });
});
