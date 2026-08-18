import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('openseadragon', () => ({
  default: vi.fn(),
}));

import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import { WorkbenchConversationRuntimeProvider } from '../../renderer/conversation/WorkbenchConversationRuntimeProvider';
import { ImageWorkbenchView } from './renderer';
import {
  cloneImageViewState,
  DEFAULT_IMAGE_VIEW_STATE,
  IMAGE_WORKBENCH_ID,
  imageWorkbenchManifest,
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
  updatedTime: 100,
};

function createBootstrap(
  payload: WorkbenchBootstrap['payload'],
): WorkbenchBootstrap {
  return {
    sessionId: 'session',
    workbenchId: IMAGE_WORKBENCH_ID,
    workbenchVersion: imageWorkbenchManifest.version,
    protocolVersion: imageWorkbenchManifest.protocolVersion,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };
}

function render(payload: WorkbenchBootstrap['payload']) {
  return renderToStaticMarkup(
    <WorkbenchConversationRuntimeProvider>
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
      </WorkbenchRuntimeProvider>
    </WorkbenchConversationRuntimeProvider>,
  );
}

describe('ImageWorkbenchView', () => {
  it('renders a stable full-height canvas and loading state', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
      sourceRevision: 'revision-1',
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
      sourceRevision: 'revision-1',
      viewState: cloneImageViewState(DEFAULT_IMAGE_VIEW_STATE),
    });

    expect(markup).toContain('Image Workbench 数据无效');
    expect(markup).not.toContain('图片查看画布');
  });
});
