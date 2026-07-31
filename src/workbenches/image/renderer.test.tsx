import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('openseadragon', () => ({
  default: vi.fn(),
}));

import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import { ImageWorkbenchView } from './renderer';
import {
  cloneImageViewState,
  DEFAULT_IMAGE_VIEW_STATE,
  IMAGE_WORKBENCH_ID,
} from './shared';

const asset: AssetSnapshot = {
  id: 'asset',
  projectId: 'project',
  name: '架构图',
  mediaType: 'image/png',
  creationKind: 'imported',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: '/tmp/private/diagram.png',
  },
  contentStatus: {
    availability: 'available',
    checkedTime: 100,
  },
  createdTime: 100,
  lastUsedTime: 100,
};

function createBootstrap(
  payload: WorkbenchBootstrap['payload'],
): WorkbenchBootstrap {
  return {
    sessionId: 'session',
    workbenchId: IMAGE_WORKBENCH_ID,
    protocolVersion: 1,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };
}

function render(payload: WorkbenchBootstrap['payload']) {
  return renderToStaticMarkup(
    <WorkbenchRuntimeProvider onError={vi.fn()}>
      <ImageWorkbenchView
        asset={asset}
        bootstrap={createBootstrap(payload)}
        executeCommand={vi.fn(async () => ({
          payload: { saved: true, savedTime: 100 },
        }))}
        onRelink={vi.fn()}
        onRefresh={vi.fn()}
        onReveal={vi.fn()}
        onInteractionChange={vi.fn()}
        onOpenExternal={vi.fn(async () => undefined)}
        onError={vi.fn()}
      />
    </WorkbenchRuntimeProvider>,
  );
}

describe('ImageWorkbenchView', () => {
  it('renders a stable full-height canvas and loading state', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
      viewState: cloneImageViewState(DEFAULT_IMAGE_VIEW_STATE),
    });

    expect(markup).toContain('aria-label="图片查看画布"');
    expect(markup).toContain('h-full min-h-0');
    expect(markup).toContain('正在载入图片');
    expect(markup).not.toContain('/tmp/private/diagram.png');
  });

  it('rejects an invalid bootstrap payload before creating a viewer', () => {
    const markup = render({
      contentUrl: 'file:///tmp/private/diagram.png',
      viewState: cloneImageViewState(DEFAULT_IMAGE_VIEW_STATE),
    });

    expect(markup).toContain('Image Workbench 数据无效');
    expect(markup).not.toContain('图片查看画布');
  });
});
