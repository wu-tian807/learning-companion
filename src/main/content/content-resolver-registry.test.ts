import { describe, expect, it, vi } from 'vitest';

import type { ContentCapability } from '../../shared/workbench/manifest';
import {
  createAssetContentStatus,
  createLocalFileContentRef,
  createManagedJsonContentRef,
} from './content-ref';
import {
  ContentResolverRegistry,
  type ContentResolver,
} from './content-resolver-registry';

describe('ContentResolverRegistry', () => {
  it('dispatches a content ref to its registered kind', async () => {
    const ref = createLocalFileContentRef('/tmp/notes.md');
    const resolve = vi.fn(async () => ({
      ref,
      status: createAssetContentStatus(
        'available',
        new Date('2026-07-27T01:00:00.000Z'),
      ),
      handle: {
        capabilities: new Set<ContentCapability>(),
        close: async () => undefined,
      },
    }));
    const resolver: ContentResolver = {
      kind: 'local-file',
      resolve,
    };
    const registry = new ContentResolverRegistry();

    registry.register(resolver);

    await expect(registry.resolve(ref)).resolves.toMatchObject({
      ref,
      status: { availability: 'available' },
    });
    expect(resolve).toHaveBeenCalledWith(ref);
    expect(registry.has('local-file')).toBe(true);
  });

  it('rejects duplicate kinds and unknown resolvers', async () => {
    const registry = new ContentResolverRegistry();
    const resolver: ContentResolver = {
      kind: 'local-file',
      resolve: async (ref) => ({
        ref,
        status: createAssetContentStatus('invalid', new Date()),
      }),
    };

    registry.register(resolver);

    expect(() => registry.register(resolver)).toThrow('REGISTRATION_CONFLICT');
    await expect(
      registry.resolve(createManagedJsonContentRef('content')),
    ).rejects.toThrow('CONTENT_RESOLVER_NOT_FOUND');
  });
});
