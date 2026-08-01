import { describe, expect, it, vi } from 'vitest';

import {
  isWorkbenchActionEnabled,
} from '../renderer/workbench/actions/workbench-action';
import type { WorkbenchActionBundle } from '../renderer/workbench/actions/workbench-action-bundle';
import { createAudioRendererActions } from './audio/renderer-actions';
import { createHtmlRendererActions } from './html/renderer-actions';
import { createImageRendererActions } from './image/renderer-actions';
import { createMindMapRendererActions } from './mindmap/renderer-actions';
import { createPdfRendererActions } from './pdf/renderer-actions';
import { createVideoRendererActions } from './video/renderer-actions';

function contextLabels(bundle: WorkbenchActionBundle): string[] {
  return bundle.contributions
    .filter((entry) => entry.surface === 'context-menu')
    .map((entry) => entry.presentation.label);
}

function expectWorkbenchSpecificContextMenu(
  bundle: WorkbenchActionBundle,
  expectedLabels: readonly string[],
) {
  const labels = contextLabels(bundle);

  expect(labels).toEqual(
    expect.arrayContaining([...expectedLabels]),
  );
  expect(bundle.contributions.some(
    (entry) =>
      entry.surface === 'context-menu' &&
      entry.actionId.startsWith('editor.'),
  )).toBe(false);
}

describe('viewer Workbench context action bundles', () => {
  it('uses HTML frame context for links and selections', () => {
    const currentContext: {
      value:
        | {
          x: number;
          y: number;
          frameUrl: string;
          mediaType: 'none';
          selectionText?: string;
          linkUrl?: string;
        }
        | undefined;
    } = { value: undefined };
    const bundle = createHtmlRendererActions({
      getContext: () => currentContext.value,
      onCopySelection: vi.fn(),
      onOpenLink: vi.fn(),
      onReload: vi.fn(),
      onReveal: vi.fn(),
    });
    const copyAction = bundle.actions.find(
      (action) => action.id === 'html.copy-selection',
    );
    const openLinkAction = bundle.actions.find(
      (action) => action.id === 'html.open-link',
    );

    expectWorkbenchSpecificContextMenu(bundle, [
      '复制选中内容',
      '在浏览器中打开链接',
      '解释选中内容',
      '总结当前页面',
    ]);
    expect(isWorkbenchActionEnabled(copyAction!)).toBe(false);
    expect(isWorkbenchActionEnabled(openLinkAction!)).toBe(false);

    currentContext.value = {
      x: 1,
      y: 2,
      frameUrl: 'learning-content://resource/session',
      mediaType: 'none',
      selectionText: '选区',
      linkUrl: 'https://example.com',
    };
    expect(isWorkbenchActionEnabled(copyAction!)).toBe(true);
    expect(isWorkbenchActionEnabled(openLinkAction!)).toBe(true);
  });

  it('keeps PDF commands page- and selection-oriented', () => {
    const bundle = createPdfRendererActions({
      ready: true,
      searchOpen: false,
      readingMode: 'continuous',
      sidebar: 'closed',
      hasOutline: true,
      onToggleSearch: vi.fn(),
      onReadingMode: vi.fn(),
      onSidebar: vi.fn(),
      onPageWidth: vi.fn(),
      onPageFit: vi.fn(),
      onActualSize: vi.fn(),
      onRotateClockwise: vi.fn(),
      onRotateCounterclockwise: vi.fn(),
      hasSelection: () => true,
      onCopySelection: vi.fn(),
      onReveal: vi.fn(),
    });

    expectWorkbenchSpecificContextMenu(bundle, [
      '复制选中内容',
      '适应整页',
      '总结当前页',
    ]);
  });

  it('keeps image commands visual and viewport-oriented', () => {
    const bundle = createImageRendererActions({
      ready: true,
      onFit: vi.fn(),
      onActualSize: vi.fn(),
      onRotateClockwise: vi.fn(),
      onRotateCounterclockwise: vi.fn(),
      onReset: vi.fn(),
      onReveal: vi.fn(),
    });

    expectWorkbenchSpecificContextMenu(bundle, [
      '适应窗口',
      '顺时针旋转',
      '分析整张图片',
      '分析当前视野',
    ]);
  });

  it('keeps Mind Map commands node- and generation-oriented', () => {
    const bundle = createMindMapRendererActions({
      canToggleFocusedNode: () => true,
      hasCollapsedNodes: () => false,
      onFit: vi.fn(),
      onToggleNode: vi.fn(),
      onExpandAll: vi.fn(),
      onReveal: vi.fn(),
    });

    expectWorkbenchSpecificContextMenu(bundle, [
      '展开 / 收起子节点',
      '围绕此节点提问',
      '从此节点派生资料',
    ]);
    expect(
      bundle.contributions
        .filter((entry) => entry.surface === 'generation-center')
        .map((entry) => entry.presentation.label),
    ).toEqual(['生成讲义']);
  });

  it('keeps video commands timeline- and frame-oriented', () => {
    const bundle = createVideoRendererActions({
      ready: true,
      onTogglePlayback: vi.fn(),
      onReveal: vi.fn(),
    });

    expectWorkbenchSpecificContextMenu(bundle, [
      '播放 / 暂停',
      '解释当前画面',
      '从这里生成学习笔记',
    ]);
    expect(contextLabels(bundle)).not.toContain('标记当前时间');
    expect(
      bundle.contributions
        .filter((entry) => entry.surface === 'overflow')
        .map((entry) => entry.presentation.label),
    ).not.toContain('标记当前时间');
  });

  it('keeps audio commands timeline- and transcript-oriented', () => {
    const bundle = createAudioRendererActions({
      ready: true,
      playbackRate: 1,
      onTogglePlayback: vi.fn(),
      onPlaybackRate: vi.fn(),
      onReveal: vi.fn(),
    });

    expectWorkbenchSpecificContextMenu(bundle, [
      '播放 / 暂停',
      '解释这一段',
      '从这里生成学习笔记',
    ]);
    expect(contextLabels(bundle)).not.toContain('标记当前时间');
    expect(
      bundle.contributions
        .filter((entry) => entry.surface === 'overflow')
        .map((entry) => entry.presentation.label),
    ).not.toContain('标记当前时间');
    expect(
      bundle.contributions
        .filter((entry) => entry.surface === 'generation-center')
        .map((entry) => entry.presentation.label),
    ).toEqual([
      '解释当前音频片段',
      '生成音频学习笔记',
    ]);
  });
});
