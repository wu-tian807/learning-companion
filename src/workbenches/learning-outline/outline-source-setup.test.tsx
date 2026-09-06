// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAbsoluteLocalFileContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import { MIND_MAP_ASSET_MEDIA_TYPE } from '../../shared/asset-media-types';
import { LearningOutlineSourceSetup } from './outline-source-setup';

const now = Date.parse('2026-09-05T10:00:00.000Z');

function asset(
  id: string,
  name: string,
  mediaType = MIND_MAP_ASSET_MEDIA_TYPE,
): AssetSnapshot {
  return {
    id,
    projectId: 'project-1',
    name,
    mediaType,
    creationKind: 'generated',
    contentRef: createAbsoluteLocalFileContentRef(`/tmp/${id}.json`),
    contentStatus: { availability: 'available', checkedTime: now },
    createdTime: now,
    updatedTime: now,
  };
}

describe('LearningOutlineSourceSetup', () => {
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
  });

  it('filters non-MindMap assets and submits exactly the selected source', async () => {
    const onComplete = vi.fn();
    await act(async () => {
      root.render(
        <LearningOutlineSourceSetup
          projectId="project-1"
          candidateState={{
            kind: 'ready',
            assets: [
              asset('mindmap-1', '线性代数导图'),
              asset('pdf-1', '课程讲义.pdf', 'application/pdf'),
              asset('mindmap-2', '概率论导图'),
            ],
          }}
          onComplete={onComplete}
          onCancel={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('线性代数导图');
    expect(container.textContent).toContain('概率论导图');
    expect(container.textContent).not.toContain('课程讲义.pdf');

    const choices = container.querySelectorAll<HTMLButtonElement>(
      'button[role="radio"]',
    );
    await act(async () => choices[1]!.click());
    expect(choices[1]!.getAttribute('aria-checked')).toBe('true');
    expect(choices[0]!.getAttribute('aria-checked')).toBe('false');

    const submit = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('创建大纲并开始沟通'),
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'mindmap-2' }),
    ]);
  });

  it('keeps confirmation disabled until a source is selected and supports cancel', async () => {
    const onCancel = vi.fn();
    await act(async () => {
      root.render(
        <LearningOutlineSourceSetup
          projectId="project-1"
          candidateState={{
            kind: 'ready',
            assets: [asset('mindmap-1', '导图')],
          }}
          onComplete={vi.fn()}
          onCancel={onCancel}
        />,
      );
    });
    const submit = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('创建大纲并开始沟通'),
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const cancel = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '取消',
    ) as HTMLButtonElement;
    await act(async () => cancel.click());
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
