import { describe, expect, it, vi } from 'vitest';

import { createEpubCfiRangeTarget } from '../shared';
import { displayEpubExplanationLocation } from './epub-explanation-navigation';
import type { EpubExplanationView } from './shared';

const explanation: EpubExplanationView = {
  kind: 'attachment',
  id: 'explanation-1',
  projectId: 'project-1',
  assetId: 'asset-1',
  target: createEpubCfiRangeTarget({
    cfiRange: 'epubcfi(/6/8!/4/2/1:0,/1:12)',
    quote: {
      exact: '需要定位的原文',
      prefix: '',
      suffix: '',
    },
  }),
  status: 'completed',
  answer: '解释内容',
  createdTime: 1,
  updatedTime: 1,
};

describe('displayEpubExplanationLocation', () => {
  it('把标注保存的 CFI 原样交给 EPUB rendition', async () => {
    const display = vi.fn(async () => undefined);

    await displayEpubExplanationLocation({ display }, explanation);

    expect(display).toHaveBeenCalledOnce();
    expect(display).toHaveBeenCalledWith(
      'epubcfi(/6/8!/4/2/1:0,/1:12)',
    );
  });

  it('保留 EPUB 定位失败，让界面层显示错误且不误关闭索引', async () => {
    const failure = new Error('CFI not found');
    const display = vi.fn(async () => {
      throw failure;
    });

    await expect(
      displayEpubExplanationLocation({ display }, explanation),
    ).rejects.toBe(failure);
  });
});
