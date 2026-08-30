import { describe, expect, it, vi } from 'vitest';

import type { ContentHandle } from '../../../main/content/content-handle';
import { createTextRevision } from '../../../main/content/text-content';
import { HtmlPreviewContentHandle } from './html-preview-content-handle';

function fallback(content = 'original') {
  const bytes = new TextEncoder().encode(content);
  return {
    capabilities: new Set(['read-bytes', 'read-stream']),
    readBytes: vi.fn(async () => ({
      content: bytes,
      revision: createTextRevision(bytes),
    })),
    close: vi.fn(async () => undefined),
  } as ContentHandle;
}

describe('HtmlPreviewContentHandle', () => {
  it('reads the active recovery draft without touching the original handle', async () => {
    const source = fallback();
    const editing = {
      getDraft: vi.fn(async () => '<p>draft</p>'),
    };
    const handle = new HtmlPreviewContentHandle(
      editing as never,
      'project-1',
      'asset-1',
      source,
    );

    const result = await handle.readBytes();

    expect(new TextDecoder().decode(result.content)).toBe('<p>draft</p>');
    expect([...result.content.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(source.readBytes).not.toHaveBeenCalled();
    expect(await handle.getByteLength()).toBe(15);
  });

  it('falls back to the original after the draft is discarded', async () => {
    const source = fallback('original');
    const handle = new HtmlPreviewContentHandle(
      { getDraft: vi.fn(async () => undefined) } as never,
      'project-1',
      'asset-1',
      source,
    );

    const result = await handle.readBytes();

    expect(new TextDecoder().decode(result.content)).toBe('original');
    expect(source.readBytes).toHaveBeenCalledOnce();
  });

  it('serves bounded stream ranges from the draft', async () => {
    const handle = new HtmlPreviewContentHandle(
      { getDraft: vi.fn(async () => 'abcdef') } as never,
      'project-1',
      'asset-1',
      fallback(),
    );

    const result = await handle.openByteStream({ start: 4, endExclusive: 7 });
    const reader = result.stream.getReader();
    const chunk = await reader.read();

    expect(new TextDecoder().decode(chunk.value)).toBe('bcd');
    expect(result.byteLength).toBe(3);
    await expect(
      handle.openByteStream({ start: -1, endExclusive: 2 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('delegates source streams before a draft exists', async () => {
    const bytes = new TextEncoder().encode('source stream');
    const openByteStream = vi.fn(async () => ({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      byteLength: bytes.length,
      revision: 'source-revision',
    }));
    const source: ContentHandle = {
      capabilities: new Set(['read-stream']),
      openByteStream,
      close: vi.fn(async () => undefined),
    };
    const handle = new HtmlPreviewContentHandle(
      { getDraft: vi.fn(async () => undefined) } as never,
      'project-1',
      'asset-1',
      source,
    );

    const result = await handle.openByteStream();

    expect(result.revision).toBe('source-revision');
    expect(openByteStream).toHaveBeenCalledOnce();
  });

  it('does not close the Workbench-owned fallback handle', async () => {
    const source = fallback();
    const handle = new HtmlPreviewContentHandle(
      { getDraft: vi.fn(async () => undefined) } as never,
      'project-1',
      'asset-1',
      source,
    );

    await handle.close();

    expect(source.close).not.toHaveBeenCalled();
  });
});
