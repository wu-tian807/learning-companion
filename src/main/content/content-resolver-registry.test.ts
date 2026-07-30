import { describe, expect, it, vi } from 'vitest';

import type { ContentCapability } from '../../shared/workbench/manifest';
import {
  createAssetContentStatus,
  createAbsoluteLocalFileContentRef,
} from './content-ref';
import {
  ContentResolverRegistry,
  type ContentResolver,
} from './content-resolver-registry';

describe('ContentResolverRegistry', () => {
  const context = {
    projectId: 'project',
    projectWorkspace: '/tmp/project',
  };

  it('dispatches a content ref to its registered kind', async () => {
    const ref = createAbsoluteLocalFileContentRef('/tmp/notes.md');
    const resolve = vi.fn(async () => ({
      contentRef: ref,
      contentStatus: createAssetContentStatus(
        'available',
        Date.parse('2026-07-27T01:00:00.000Z'),
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

    await expect(registry.resolve(ref, context)).resolves.toMatchObject({
      contentRef: ref,
      contentStatus: { availability: 'available' },
    });
    expect(resolve).toHaveBeenCalledWith(ref, context);
    expect(registry.has('local-file')).toBe(true);
  });

  it('rejects duplicate kinds and unknown resolvers', async () => {
    const registry = new ContentResolverRegistry();
    const resolver: ContentResolver = {
      kind: 'local-file',
      resolve: async (ref) => ({
        contentRef: ref,
        contentStatus: createAssetContentStatus('invalid', Date.now()),
      }),
    };

    registry.register(resolver);

    expect(() => registry.register(resolver)).toThrow('REGISTRATION_CONFLICT');
    const unknownRegistry = new ContentResolverRegistry();
    await expect(
      unknownRegistry.resolve(
        createAbsoluteLocalFileContentRef('/tmp/content'),
        context,
      ),
    ).rejects.toThrow('CONTENT_RESOLVER_NOT_FOUND');
  });
});
