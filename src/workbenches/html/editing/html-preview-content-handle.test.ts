import { describe, expect, it, vi } from 'vitest';

import type { ContentHandle } from '../../../main/content/content-handle';
import type { ContentCapability } from '../../../shared/workbench/manifest';
import { createTextRevision } from '../../../main/content/text-content';
import { HtmlPreviewContentHandle } from './html-preview-content-handle';

function fallback(content = 'original'): ContentHandle {
  const bytes = new TextEncoder().encode(content);
  return {
    capabilities: new Set(['read-bytes', 'read-stream']),
    readBytes: vi.fn(async () => ({
      content: bytes,
      revision: createTextRevision(bytes),
    })),
    close: vi.fn(async () => undefined),
  };
}

describe('HtmlPreviewContentHandle', () => {
  it('serves the Workbench draft without reading or writing the source', async () => {
    const source = fallback();
    const handle = new HtmlPreviewContentHandle(
      { getDraft: vi.fn(async () => '<p>draft</p>') } as never,
      'project-1',
      'asset-1',
      source,
    );

    const result = await handle.readBytes();

    expect(new TextDecoder().decode(result.content)).toContain('<p>draft</p>');
    expect(source.readBytes).not.toHaveBeenCalled();
    expect(
      (handle.capabilities as ReadonlySet<ContentCapability>).has('write-bytes'),
    ).toBe(false);
  });

  it('delegates to the source when no draft exists', async () => {
    const source = fallback();
    const handle = new HtmlPreviewContentHandle(
      { getDraft: vi.fn(async () => undefined) } as never,
      'project-1',
      'asset-1',
      source,
    );

    await expect(handle.readBytes()).resolves.toMatchObject({
      revision: expect.any(String),
    });
    expect(source.readBytes).toHaveBeenCalledOnce();
  });
});
