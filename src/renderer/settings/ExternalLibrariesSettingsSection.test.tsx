// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExternalLibrarySnapshot } from '../../shared/external-libraries';
import { ExternalLibrariesSettingsSection } from './ExternalLibrariesSettingsSection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mediaSubtitles: ExternalLibrarySnapshot = {
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
  rootPath: 'C:\\Learning Companion\\externalLib',
  status: 'not-installed',
};

describe('ExternalLibrariesSettingsSection', () => {
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

  it('does not ask users to choose hardware and installs the resolved package', () => {
    const onInstall = vi.fn();
    act(() => {
      root.render(
        <ExternalLibrariesSettingsSection
          libraries={[mediaSubtitles]}
          loading={false}
          loadError={undefined}
          migrationPending={false}
          hasActiveTask={false}
          requestPendingById={new Set()}
          target={undefined}
          targetedLibraryRef={createRef<HTMLElement>()}
          onInstall={onInstall}
          onRemove={vi.fn()}
          onCancel={vi.fn()}
          onReload={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).not.toContain('运行版本');
    expect(container.textContent).not.toContain('CPU 兼容版');
    expect(container.textContent).not.toContain('NVIDIA GPU 加速版');
    expect(container.textContent).toContain('固定组件资源约');

    const installButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '安装',
    );
    act(() => installButton?.click());

    expect(onInstall).toHaveBeenCalledWith({
      library: mediaSubtitles,
      expectedSize: 100,
    });
  });

  it('shows the active installation step instead of a frozen percentage', () => {
    act(() => {
      root.render(
        <ExternalLibrariesSettingsSection
          libraries={[
            {
              ...mediaSubtitles,
              status: 'installing',
              statusDetail: '正在安装 PyTorch/CUDA 运行环境',
            },
          ]}
          loading={false}
          loadError={undefined}
          migrationPending={false}
          hasActiveTask
          requestPendingById={new Set()}
          target={undefined}
          targetedLibraryRef={createRef<HTMLElement>()}
          onInstall={vi.fn()}
          onRemove={vi.fn()}
          onCancel={vi.fn()}
          onReload={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain(
      '正在安装 PyTorch/CUDA 运行环境',
    );
    expect(
      container.querySelector('.external-library-indeterminate'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain(' · 33%');
  });
});
