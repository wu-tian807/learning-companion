import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createEpubCfiRangeTarget } from '../shared';
import { EpubExplanationPanel } from './epub-explanation-panel';
import type { EpubExplanationView } from './shared';

const target = createEpubCfiRangeTarget({
  cfiRange: 'epubcfi(/6/2!/4/2/1:0,/1:4)',
  quote: {
    exact: '需要解释的文字',
    prefix: '前文',
    suffix: '后文',
  },
});

function render(
  explanation: EpubExplanationView,
  runtime?: Parameters<typeof EpubExplanationPanel>[0]['runtime'],
): string {
  return renderToStaticMarkup(
    <EpubExplanationPanel
      explanation={explanation}
      runtime={runtime}
      onClose={vi.fn()}
      onRetry={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}

describe('EpubExplanationPanel', () => {
  it('shows real partial output and a caret while the Agent is answering', () => {
    const markup = render(
      {
        kind: 'task',
        id: 'task-1',
        projectId: 'project-1',
        assetId: 'asset-1',
        target,
        status: 'pending',
        createdTime: 1,
        updatedTime: 1,
      },
      {
        text: '正在逐步生成的解释',
        phase: 'answering',
        statusMessage: 'AI 正在生成解释…',
      },
    );

    expect(markup).toContain('AI 正在生成解释');
    expect(markup).toContain('正在逐步生成的解释');
    expect(markup).toContain('data-epub-explanation-stream-caret');
  });

  it('uses the completed snapshot as a saving preview without a streaming caret', () => {
    const markup = render(
      {
        kind: 'task',
        id: 'task-1',
        projectId: 'project-1',
        assetId: 'asset-1',
        target,
        status: 'pending',
        createdTime: 1,
        updatedTime: 2,
      },
      {
        text: '完整回答',
        phase: 'saving',
        statusMessage: '回答已生成，正在保存解释…',
      },
    );

    expect(markup).toContain('回答已生成，正在保存解释');
    expect(markup).toContain('完整回答');
    expect(markup).not.toContain('data-epub-explanation-stream-caret');
  });

  it('labels partial output as unsaved after the task fails', () => {
    const markup = render(
      {
        kind: 'task',
        id: 'task-1',
        projectId: 'project-1',
        assetId: 'asset-1',
        target,
        status: 'failed',
        failureMessage: '网络连接中断',
        createdTime: 1,
        updatedTime: 3,
      },
      {
        text: '只生成了一部分',
        phase: 'answering',
        statusMessage: 'AI 正在生成解释…',
      },
    );

    expect(markup).toContain('未完成，内容尚未保存');
    expect(markup).toContain('只生成了一部分');
    expect(markup).toContain('网络连接中断');
  });
});
