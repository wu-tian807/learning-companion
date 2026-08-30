// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppSetupSnapshot } from '../../shared/app-setup';
import type { ExternalLibrarySnapshot } from '../../shared/external-libraries';
import {
  createExternalLibraryStore,
  type ExternalLibraryRendererApi,
} from '../external-libraries/external-library-store';
import { FirstRunOnboarding } from './FirstRunOnboarding';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const libreOffice: ExternalLibrarySnapshot = {
  id: 'libreoffice',
  displayName: 'LibreOffice',
  description: '转换 Office 文档',
  category: 'document',
  version: '26.2.5',
  expectedSize: 356_000_000,
  rootPath: 'C:\\Learning Companion\\externalLib',
  status: 'not-installed',
};

const voxCpm: ExternalLibrarySnapshot = {
  id: 'video-dubbing-voxcpm2',
  displayName: 'VoxCPM2 视频/音频配音组件',
  description: '生成 one-shot 人声克隆配音',
  category: 'media',
  version: '2026.08.29',
  expectedSize: 4_832_000_000,
  rootPath: 'C:\\Learning Companion\\externalLib',
  status: 'not-installed',
};

function createHarness() {
  const api = {
    listExternalLibraries: vi.fn(async () => []),
    refreshExternalLibrary: vi.fn(),
    startExternalLibraryInstallation: vi.fn(
      async ({ libraryId }: { libraryId: string }) => ({
        ...(libraryId === voxCpm.id ? voxCpm : libreOffice),
        status: 'downloading' as const,
      }),
    ),
    cancelExternalLibrary: vi.fn(),
    removeExternalLibrary: vi.fn(),
    selectExternalLibrariesDirectory: vi.fn(),
    migrateExternalLibraries: vi.fn(),
    onExternalLibraryChanged: vi.fn(() => () => undefined),
  } satisfies ExternalLibraryRendererApi;

  return {
    api,
    store: createExternalLibraryStore(api, {
      librariesById: new Map([
        [libreOffice.id, libreOffice],
        [voxCpm.id, voxCpm],
      ]),
      initialized: true,
    }),
  };
}

function findButton(container: HTMLElement, label: string) {
  return [...container.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  );
}

describe('FirstRunOnboarding interactions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('installs the selected registered library through the shared management flow', async () => {
    const { api, store } = createHarness();

    act(() => {
      root.render(
        <FirstRunOnboarding
          store={store}
          api={{
            completeExternalLibraryOnboarding: vi.fn(),
          }}
          onCompleted={vi.fn()}
        />,
      );
    });

    const voxCard = [...container.querySelectorAll('article')].find(
      (article) => article.textContent?.includes(voxCpm.displayName),
    );
    const installButton = [...(voxCard?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === '安装',
    );
    act(() => installButton?.click());

    expect(container.textContent).toContain(
      `安装 ${voxCpm.displayName}？`,
    );

    await act(async () => {
      findButton(container, '下载并安装')?.click();
    });

    expect(api.startExternalLibraryInstallation).toHaveBeenCalledWith({
      libraryId: voxCpm.id,
    });
    expect(store.getState().librariesById.get(voxCpm.id)?.status).toBe(
      'downloading',
    );
    expect(container.textContent).toContain('进入应用，后台继续');
  });

  it('completes onboarding without forcing any component installation', async () => {
    const { api: libraryApi, store } = createHarness();
    const setup = createAppSetupSnapshot(1);
    const completeExternalLibraryOnboarding = vi.fn(async () => setup);
    const onCompleted = vi.fn();

    act(() => {
      root.render(
        <FirstRunOnboarding
          store={store}
          api={{ completeExternalLibraryOnboarding }}
          onCompleted={onCompleted}
        />,
      );
    });

    await act(async () => {
      findButton(container, '开始使用')?.click();
    });

    expect(libraryApi.startExternalLibraryInstallation).not.toHaveBeenCalled();
    expect(completeExternalLibraryOnboarding).toHaveBeenCalledOnce();
    expect(onCompleted).toHaveBeenCalledWith(setup);
  });

  it('keeps onboarding open and reports an invalid completion response', async () => {
    const { store } = createHarness();
    const onCompleted = vi.fn();

    act(() => {
      root.render(
        <FirstRunOnboarding
          store={store}
          api={{
            completeExternalLibraryOnboarding: vi.fn(async () =>
              null as never,
            ),
          }}
          onCompleted={onCompleted}
        />,
      );
    });

    await act(async () => {
      findButton(container, '开始使用')?.click();
    });

    expect(onCompleted).not.toHaveBeenCalled();
    expect(container.textContent).toContain('操作未完成');
    expect(container.textContent).toContain(
      '无法保存首次运行设置，请重试。',
    );
  });
});
