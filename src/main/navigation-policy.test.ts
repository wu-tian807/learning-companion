import { describe, expect, it } from 'vitest';

import { isAllowedMainWindowNavigation } from './navigation-policy';

const devServerUrl = 'http://localhost:5173/';

describe('isAllowedMainWindowNavigation', () => {
  it('allows reloading the current URL', () => {
    expect(
      isAllowedMainWindowNavigation(
        'http://localhost:5173/',
        'http://localhost:5173/',
        devServerUrl,
      ),
    ).toBe(true);
    expect(
      isAllowedMainWindowNavigation(
        'file:///D:/Learning%20Companion/index.html',
        'file:///D:/Learning%20Companion/index.html',
      ),
    ).toBe(true);
  });

  it('allows navigation within the Vite development origin', () => {
    expect(
      isAllowedMainWindowNavigation(
        devServerUrl,
        'http://localhost:5173/project?id=one',
        devServerUrl,
      ),
    ).toBe(true);
  });

  it('blocks external origins and non-http URLs', () => {
    expect(
      isAllowedMainWindowNavigation(
        devServerUrl,
        'https://example.com/',
        devServerUrl,
      ),
    ).toBe(false);
    expect(
      isAllowedMainWindowNavigation(
        devServerUrl,
        'blob:http://localhost:5173/renderer',
        devServerUrl,
      ),
    ).toBe(false);
  });

  it('blocks navigation to another packaged file', () => {
    expect(
      isAllowedMainWindowNavigation(
        'file:///D:/Learning%20Companion/index.html',
        'file:///D:/Learning%20Companion/other.html',
      ),
    ).toBe(false);
  });

  it('blocks invalid URLs', () => {
    expect(
      isAllowedMainWindowNavigation('', '', devServerUrl),
    ).toBe(false);
  });
});
