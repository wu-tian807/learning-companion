import { describe, expect, it } from 'vitest';

import {
  hasExplicitUrlScheme,
  isExternalNetworkUrl,
  toSafeExternalUrl,
} from './epub-security';

describe('EPUB content security helpers', () => {
  it('recognizes external network resources without blocking archive paths', () => {
    expect(isExternalNetworkUrl('https://tracker.test/pixel')).toBe(true);
    expect(isExternalNetworkUrl('//tracker.test/pixel')).toBe(true);
    expect(isExternalNetworkUrl('../images/cover.jpg')).toBe(false);
    expect(isExternalNetworkUrl('blob:https://app.test/id')).toBe(false);
    expect(isExternalNetworkUrl('data:image/png;base64,AA==')).toBe(false);
  });

  it('normalizes only safe external links and blocks active schemes', () => {
    expect(toSafeExternalUrl('//example.com/chapter')).toBe(
      'https://example.com/chapter',
    );
    expect(toSafeExternalUrl('https://user:pass@example.com')).toBe(
      undefined,
    );
    expect(hasExplicitUrlScheme('javascript:alert(1)')).toBe(true);
    expect(hasExplicitUrlScheme('../chapter-2.xhtml')).toBe(false);
  });
});
