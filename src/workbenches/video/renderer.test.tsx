import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import {
  hasLoadedVideoMetadata,
  mediaErrorMessage,
  VideoWorkbenchView,
} from './renderer';
import {
  cloneVideoViewState,
  DEFAULT_VIDEO_VIEW_STATE,
  VIDEO_WORKBENCH_ID,
} from './shared';

const asset: AssetSnapshot = {
  id: 'asset',
  projectId: 'project',
  name: '课程视频',
  mediaType: 'video/mp4',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: '/tmp/private/lesson.mp4',
  },
  contentStatus: {
    availability: 'available',
    checkedTime: 100,
  },
  createdTime: 100,
  lastUsedTime: 100,
};

function render(payload: WorkbenchBootstrap['payload']) {
  const bootstrap: WorkbenchBootstrap = {
    sessionId: 'session',
    workbenchId: VIDEO_WORKBENCH_ID,
    protocolVersion: 1,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };

  return renderToStaticMarkup(
    <WorkbenchRuntimeProvider onError={vi.fn()}>
      <VideoWorkbenchView
        asset={asset}
        bootstrap={bootstrap}
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

describe('VideoWorkbenchView', () => {
  it('reconciles media state that settled before effect listeners attach', () => {
    expect(hasLoadedVideoMetadata({ readyState: 0 })).toBe(false);
    expect(hasLoadedVideoMetadata({ readyState: 1 })).toBe(true);
    expect(mediaErrorMessage({ code: 4 })).toContain('不支持');
  });

  it('renders the native video element without exposing its file path', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
      viewState: cloneVideoViewState(DEFAULT_VIDEO_VIEW_STATE),
    });

    expect(markup).toContain('aria-label="视频播放器"');
    expect(markup).toContain('controls=""');
    expect(markup).toContain('learning-content://resource/token');
    expect(markup).not.toContain('标记当前时间');
    expect(markup).not.toContain('/tmp/private/lesson.mp4');
  });

  it('rejects an invalid bootstrap URL', () => {
    const markup = render({
      contentUrl: 'file:///tmp/private/lesson.mp4',
      viewState: cloneVideoViewState(DEFAULT_VIDEO_VIEW_STATE),
    });

    expect(markup).toContain('Video Workbench 数据无效');
    expect(markup).not.toContain('视频播放器');
  });
});
