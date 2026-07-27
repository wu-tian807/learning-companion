import { describe, expect, it, vi } from 'vitest';

import {
  createLocalFileContentLocator,
  type LocalFileLocatorChecker,
} from '../../../assets/asset-content-locator';
import {
  createLocalFileContentRef,
  createManagedJsonContentRef,
} from '../../content-ref';
import { LocalFileContentResolver } from './local-file-content-resolver';

describe('LocalFileContentResolver', () => {
  it('returns a Handle only for available files', async () => {
    const checker: LocalFileLocatorChecker = {
      check: vi.fn(async (path) =>
        createLocalFileContentLocator({
          path,
          availability: 'available',
          checkedTime: new Date('2026-07-27T01:00:00.000Z'),
        }),
      ),
    };
    const resolver = new LocalFileContentResolver(checker);

    const resolved = await resolver.resolve(
      createLocalFileContentRef('/tmp/notes.md'),
    );

    expect(resolved.status.availability).toBe('available');
    expect(resolved.handle).toBeDefined();
    await resolved.handle?.close();
  });

  it('returns status without a Handle for missing files', async () => {
    const checker: LocalFileLocatorChecker = {
      check: vi.fn(async (path) =>
        createLocalFileContentLocator({
          path,
          availability: 'missing',
          checkedTime: new Date('2026-07-27T01:00:00.000Z'),
        }),
      ),
    };
    const resolver = new LocalFileContentResolver(checker);

    const resolved = await resolver.resolve(
      createLocalFileContentRef('/tmp/missing.md'),
    );

    expect(resolved.status.availability).toBe('missing');
    expect(resolved.handle).toBeUndefined();
  });

  it('rejects a ref belonging to another Resolver kind', async () => {
    const resolver = new LocalFileContentResolver();

    await expect(
      resolver.resolve(createManagedJsonContentRef('content')),
    ).rejects.toThrow('INVALID_EXTENSION_DEFINITION');
  });
});
