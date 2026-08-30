// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createEpubCfiRangeTarget } from '../shared';
import { EpubReadingNotePanel } from './epub-reading-note-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const target = createEpubCfiRangeTarget({
  cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:8)',
  quote: { exact: '被记录的原文', prefix: '', suffix: '' },
});

describe('EpubReadingNotePanel', () => {
  it('shows authored notes and their distinct source quote', () => {
    const markup = renderToStaticMarkup(
      <EpubReadingNotePanel
        notes={[
          {
            id: 'note-1',
            projectId: 'project-1',
            assetId: 'asset-1',
            target,
            text: '这是我自己的感想。',
            markerColor: 'yellow',
            createdTime: 1,
            updatedTime: 2,
          },
        ]}
        activeNote={undefined}
        draftTarget={target}
        onActivate={vi.fn()}
        onStartNew={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onDelete={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('这是我自己的感想。');
    expect(markup).toContain('被记录的原文');
    expect(markup).toContain('aria-label="阅读笔记内容"');
  });

  it('requires an EPUB selection before a new note can be written', () => {
    const markup = renderToStaticMarkup(
      <EpubReadingNotePanel
        notes={[]}
        onActivate={vi.fn()}
        onStartNew={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onDelete={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('请先在正文中选中一段文字');
    expect(markup).toContain('disabled=""');
  });

  it('submits edited authored text without changing its source target', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onSave = vi.fn(async () => undefined);
    const note = {
      id: 'note-1',
      projectId: 'project-1',
      assetId: 'asset-1',
      target,
      text: '原来的感想',
      markerColor: 'blue' as const,
      createdTime: 1,
      updatedTime: 1,
    };

    await act(async () => {
      root.render(
        <EpubReadingNotePanel
          notes={[note]}
          activeNote={note}
          onActivate={vi.fn()}
          onStartNew={vi.fn()}
          onSave={onSave}
          onDelete={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />,
      );
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(textarea, '修改后的感想');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="红色波浪线"]')
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith('修改后的感想', 'red', note);
    act(() => root.unmount());
    container.remove();
  });
});
