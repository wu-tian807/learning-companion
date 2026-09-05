// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectWorkspaceContentRef,
  type AssetSnapshot,
} from '../../../shared/assets';
import { unsupportedWorkbenchManifest } from '../../../workbenches/unsupported/shared';
import { WorkbenchRuntimeProvider } from '../runtime/WorkbenchRuntimeProvider';
import {
  AssetWorkbenchHost,
  type AssetWorkbenchOpenStateChange,
} from './AssetWorkbenchHost';

const asset: AssetSnapshot = {
  id: 'outline-1',
  projectId: 'project-1',
  name: '学习大纲',
  mediaType: 'application/vnd.learning-companion.learning-outline',
  creationKind: 'generated',
  contentRef: createProjectWorkspaceContentRef(
    '.learning-companion/assets/generated/outline-1.outline',
  ),
  createdTime: 1,
  updatedTime: 1,
  contentStatus: { availability: 'available', checkedTime: 1 },
};

describe('AssetWorkbenchHost opening lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function renderHost(
    openWorkbench: ReturnType<typeof vi.fn>,
    onOpenStateChange: (change: AssetWorkbenchOpenStateChange) => void,
  ) {
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        openWorkbench,
        closeWorkbench: vi.fn(async () => undefined),
        listAttachments: vi.fn(async () => []),
        onWorkbenchEvent: vi.fn(() => () => undefined),
      },
    });

    act(() =>
      root.render(
        <WorkbenchRuntimeProvider onError={vi.fn()}>
          <AssetWorkbenchHost
            projectId="project-1"
            asset={asset}
            mediaLabel={() => '学习大纲'}
            onRelink={vi.fn()}
            onRefresh={vi.fn()}
            onReveal={vi.fn()}
            onOpenSettings={vi.fn()}
            onOpenStateChange={onOpenStateChange}
            onLifecycleTaskChange={vi.fn()}
            onError={vi.fn()}
          />
        </WorkbenchRuntimeProvider>,
      ),
    );
  }

  it('reports ready only after the Workbench bootstrap is validated', async () => {
    const openWorkbench = vi.fn(async () => ({
      sessionId: 'session-1',
      workbenchId: unsupportedWorkbenchManifest.id,
      workbenchVersion: unsupportedWorkbenchManifest.version,
      protocolVersion: unsupportedWorkbenchManifest.protocolVersion,
      assetId: asset.id,
      mediaType: asset.mediaType,
      availability: 'available',
      payload: {},
    }));
    const onOpenStateChange =
      vi.fn<(change: AssetWorkbenchOpenStateChange) => void>();

    renderHost(openWorkbench, onOpenStateChange);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });

    expect(
      onOpenStateChange.mock.calls.map(([change]) => change.status),
    ).toEqual(['opening', 'ready']);
  });

  it('reports a bootstrap failure so a caller can retry opening', async () => {
    const openWorkbench = vi.fn(async () => ({}));
    const onOpenStateChange =
      vi.fn<(change: AssetWorkbenchOpenStateChange) => void>();

    renderHost(openWorkbench, onOpenStateChange);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });

    expect(
      onOpenStateChange.mock.calls.map(([change]) => change.status),
    ).toEqual(['opening', 'failed']);
  });
});
