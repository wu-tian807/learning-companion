import { describe, expect, it } from 'vitest';

import type { ContentHandle } from './content-handle';
import {
  DefaultTextContentAdapter,
  createTextRevision,
  decodeTextContent,
  detectTextLineEnding,
  encodeTextContent,
  normalizeTextLineEndings,
} from './text-content';

describe('Text content codec', () => {
  it('detects the dominant line ending and normalizes editor content', () => {
    expect(detectTextLineEnding('a\r\nb\r\nc\n')).toBe('crlf');
    expect(detectTextLineEnding('a\nb\r\nc\n')).toBe('lf');
    expect(normalizeTextLineEndings('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });

  it('round-trips UTF-8 BOM and CRLF metadata', () => {
    const source = Buffer.from('\ufeff第一行\r\n第二行');
    const decoded = decodeTextContent(source, 'utf-8');
    const encoded = encodeTextContent({
      content: decoded.content,
      encoding: decoded.encoding,
      lineEnding: decoded.lineEnding,
      hasByteOrderMark: decoded.hasByteOrderMark,
    });

    expect(decoded).toMatchObject({
      content: '第一行\n第二行',
      lineEnding: 'crlf',
      hasByteOrderMark: true,
    });
    expect(encoded).toEqual(source);
  });

  it('adapts a generic byte handle to text reads and writes', async () => {
    let bytes = Buffer.from('\ufeff第一行\r\n第二行');
    let revision = createTextRevision(bytes);
    const handle: ContentHandle = {
      capabilities: new Set(['read-bytes', 'write-bytes']),
      readBytes: async () => ({ content: bytes, revision }),
      writeBytes: async (request) => {
        expect(request.expectedRevision).toBe(revision);
        bytes = Buffer.from(request.content);
        revision = createTextRevision(bytes);
        return { revision };
      },
      close: async () => undefined,
    };
    const adapter = new DefaultTextContentAdapter();

    const resolved = await adapter.read(handle);
    expect(resolved).toMatchObject({
      content: '第一行\n第二行',
      encoding: 'utf-8',
      lineEnding: 'crlf',
      hasByteOrderMark: true,
    });

    const saved = await adapter.write(handle, {
      ...resolved,
      content: '更新后\n内容',
      expectedRevision: resolved.revision,
    });

    expect(saved.revision).toBe(revision);
    expect(bytes.toString('utf8')).toBe('\ufeff更新后\r\n内容');
  });
});
