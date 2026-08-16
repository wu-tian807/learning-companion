import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ExternalLibrarySnapshot } from '../../shared/external-libraries';
import {
  createExternalLibraryStore,
  type ExternalLibraryRendererApi,
} from '../external-libraries/external-library-store';
import { SettingsDialog } from './SettingsDialog';

function createSnapshot(
  status: ExternalLibrarySnapshot['status'],
): ExternalLibrarySnapshot {
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
            completedBytes: 100,
            totalBytes: 300_000_000,
          },
        }
      : {}),
  };
}

function createStore(
  snapshot?: ExternalLibrarySnapshot,
  loading = false,
) {
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
      snapshot ? [[snapshot.id, snapshot]] : [],
    ),
    initialized: !loading,
    loading,
  });
}

function createMediaSubtitleSnapshot(): ExternalLibrarySnapshot {
  return {
    id: 'media-subtitles',
    displayName: '视频/音频字幕组件',
    description: '一次安装完整本地能力',
    category: 'media',
    version: '2026.08.16',
    expectedSize: 100,
    variants: [
      { id: 'cpu', displayName: 'CPU 兼容版', expectedSize: 100 },
      {
        id: 'nvidia',
        displayName: 'NVIDIA GPU 加速版',
        expectedSize: 200,
      },
    ],
    defaultVariantId: 'cpu',
    rootPath: '/Users/student/Documents/Learning Companion/externalLib',
    status: 'not-installed',
  };
}

describe('SettingsDialog', () => {
  it('explains the external runtime storage and trust boundary', () => {
    const markup = renderToStaticMarkup(
      <SettingsDialog
        store={createStore(undefined, true)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('外部组件位置');
    expect(markup).toContain('更换位置');
    expect(markup).toContain('固定 SHA-256');
    expect(markup).toContain('正在读取');
  });

  it('allows closing while a background download remains active', () => {
    const markup = renderToStaticMarkup(
      <SettingsDialog
        store={createStore(createSnapshot('downloading'))}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('正在下载');
    expect(markup).toContain('取消');
    expect(markup).toContain('Office preview');
    expect(markup).toContain('文档');
    expect(markup).not.toContain(
      'aria-label="关闭设置" disabled=""',
    );
  });

  it('visually targets the library requested by a notification action', () => {
    const markup = renderToStaticMarkup(
      <SettingsDialog
        store={createStore(createSnapshot('failed'))}
        target={{
          section: 'external-libraries',
          libraryId: 'libreoffice',
        }}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('ring-indigo-300/10');
    expect(markup).toContain('重新安装');
  });

  it('renders one automatically configured media component', () => {
    const markup = renderToStaticMarkup(
      <SettingsDialog
        store={createStore(createMediaSubtitleSnapshot())}
        onClose={vi.fn()}
      />,
    );

    expect(markup.match(/>视频\/音频字幕组件</gu)).toHaveLength(1);
    expect(markup).not.toContain('<select');
    expect(markup).not.toContain('运行版本');
    expect(markup).toContain('安装');
  });

  it('exposes AI Provider as a settings tab', () => {
    const markup = renderToStaticMarkup(
      <SettingsDialog
        store={createStore()}
        target={{ section: 'agent-providers' }}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('常规');
    expect(markup).toContain('AI Provider');
    expect(markup).toContain('管理账号与 API Connection');
    expect(markup).not.toContain('外部组件位置');
  });
});
