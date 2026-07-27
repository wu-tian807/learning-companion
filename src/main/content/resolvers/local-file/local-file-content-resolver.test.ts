import { describe, expect, it, vi } from 'vitest';

import {
  createLocalFileContentInspection,
  type LocalFileContentInspector,
} from './local-file-content-inspector';
import {
  createLocalFileContentRef,
  createManagedJsonContentRef,
} from '../../content-ref';
import { LocalFileContentResolver } from './local-file-content-resolver';

describe('LocalFileContentResolver', () => {
  it('returns a Handle only for available files', async () => {
    const inspector: LocalFileContentInspector = {
      inspect: vi.fn(async (path) =>
        createLocalFileContentInspection({
          path,
          availability: 'available',
          checkedTime: Date.parse('2026-07-27T01:00:00.000Z'),
        }),
      ),
    };
    const resolver = new LocalFileContentResolver(inspector);

    const resolved = await resolver.resolve(
      createLocalFileContentRef('/tmp/notes.md'),
    );

    expect(resolved.contentStatus.availability).toBe('available');
    expect(resolved.handle).toBeDefined();
    await resolved.handle?.close();
  });

  it('returns status without a Handle for missing files', async () => {
    const inspector: LocalFileContentInspector = {
      inspect: vi.fn(async (path) =>
        createLocalFileContentInspection({
          path,
          availability: 'missing',
          checkedTime: Date.parse('2026-07-27T01:00:00.000Z'),
        }),
      ),
    };
    const resolver = new LocalFileContentResolver(inspector);

    const resolved = await resolver.resolve(
      createLocalFileContentRef('/tmp/missing.md'),
    );

    expect(resolved.contentStatus.availability).toBe('missing');
    expect(resolved.handle).toBeUndefined();
  });

  it('rejects a ref belonging to another Resolver kind', async () => {
    const resolver = new LocalFileContentResolver();

    await expect(
      resolver.resolve(createManagedJsonContentRef('content')),
    ).rejects.toThrow('INVALID_EXTENSION_DEFINITION');
  });
});
