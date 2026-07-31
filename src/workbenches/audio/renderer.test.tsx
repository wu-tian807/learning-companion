import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import {
  audioErrorMessage,
  AudioWorkbenchView,
  hasLoadedAudioMetadata,
} from './renderer';
import {
  AUDIO_WORKBENCH_ID,
  cloneAudioViewState,
  DEFAULT_AUDIO_VIEW_STATE,
} from './shared';

const asset: AssetSnapshot = {
  id: 'asset',
  projectId: 'project',
  name: '课程音频',
  mediaType: 'audio/mpeg',
  creationKind: 'imported',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: '/tmp/private/lesson.mp3',
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
    workbenchId: AUDIO_WORKBENCH_ID,
    protocolVersion: 1,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };

  return renderToStaticMarkup(
    <WorkbenchRuntimeProvider onError={vi.fn()}>
      <AudioWorkbenchView
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

describe('AudioWorkbenchView', () => {
  it('reconciles media state that settled before effect listeners attach', () => {
    expect(hasLoadedAudioMetadata({ readyState: 0 })).toBe(false);
    expect(hasLoadedAudioMetadata({ readyState: 1 })).toBe(true);
    expect(audioErrorMessage({ code: 4 })).toContain('不支持');
  });

  it('renders native audio controls and reserves the transcript area', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
      viewState: cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE),
    });

    expect(markup).toContain('aria-label="音频播放器"');
    expect(markup).toContain('controls=""');
    expect(markup).toContain('音频转写、章节和逐句学习内容');
    expect(markup).toContain('learning-content://resource/token');
    expect(markup).not.toContain('标记当前时间');
    expect(markup).not.toContain('/tmp/private/lesson.mp3');
  });

  it('rejects an invalid bootstrap URL', () => {
    const markup = render({
      contentUrl: 'file:///tmp/private/lesson.mp3',
      viewState: cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE),
    });

    expect(markup).toContain('Audio Workbench 数据无效');
    expect(markup).not.toContain('音频播放器');
  });
});
