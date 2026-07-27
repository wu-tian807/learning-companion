import { describe, expect, it } from 'vitest';

import {
  createTextEncodingDetector,
  detectTextEncoding,
} from './asset-text-encoding';

describe('Asset text encoding', () => {
  it('prefers UTF-8 and falls back to GBK', () => {
    expect(detectTextEncoding(Buffer.from('中文 UTF-8'))).toBe('utf-8');
    expect(
      detectTextEncoding(
        Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]),
      ),
    ).toBe('gbk');
  });

  it('rejects NUL bytes and excessive control characters', () => {
    expect(detectTextEncoding(Buffer.from([0x00, 0x41]))).toBeUndefined();
    expect(
      detectTextEncoding(Buffer.from([0x01, 0x02, 0x03, 0x41])),
    ).toBeUndefined();
  });

  it('supports adding another detector without changing the pipeline', () => {
    const customDetector = createTextEncodingDetector('utf-8');

    expect(
      detectTextEncoding(Buffer.from('custom'), [customDetector]),
    ).toBe('utf-8');
  });
});
