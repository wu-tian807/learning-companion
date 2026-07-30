import { describe, expect, it } from 'vitest';

import {
  createDefaultExternalLibrariesRoot,
} from './external-library-path-manager';

describe('ExternalLibraryPathManager', () => {
  it('creates the default external library root under Documents', () => {
    expect(
      createDefaultExternalLibrariesRoot('/Users/student/Documents'),
    ).toBe(
      '/Users/student/Documents/Learning Companion/externalLib',
    );
  });

  it('rejects a relative Documents directory', () => {
    expect(() =>
      createDefaultExternalLibrariesRoot('Documents'),
    ).toThrow('DATA_INTEGRITY_ERROR');
  });
});
