import { describe, expect, it } from 'vitest';

import {
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
});
