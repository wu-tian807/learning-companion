import { describe, expect, it, vi } from 'vitest';

import {
  ExternalLibraryLifecycleRegistry,
  ExternalLibraryUsageManager,
} from './external-library-lifecycle';

describe('ExternalLibraryLifecycleRegistry', () => {
  it('registers one lifecycle per external library', () => {
    const registry = new ExternalLibraryLifecycleRegistry();
    const lifecycle = {
      libraryId: 'media-runtime',
      release: vi.fn(async () => undefined),
    };

    registry.register(lifecycle);

    expect(registry.find('media-runtime')).toBe(lifecycle);
    expect(() => registry.register(lifecycle)).toThrow(
      'REGISTRATION_CONFLICT',
    );
    expect(() =>
      registry.register({ ...lifecycle, libraryId: '../runtime' }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
  });
});

describe('ExternalLibraryUsageManager', () => {
  it('aborts and drains active use while blocking new work', async () => {
    const manager = new ExternalLibraryUsageManager();
    let started!: () => void;
    const operationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const operation = manager.run('media-runtime', undefined, async (signal) => {
      started();
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(signal.reason),
          { once: true },
        );
      });
    });
    await operationStarted;
    const release = vi.fn(async () => undefined);

    const quiescence = await manager.quiesce('media-runtime', release);

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    expect(release).toHaveBeenCalledOnce();
    await expect(
      manager.run('media-runtime', undefined, async () => undefined),
    ).rejects.toMatchObject({ code: 'EXTERNAL_LIBRARY_CONFLICT' });

    quiescence.dispose();
    await expect(
      manager.run('media-runtime', undefined, async () => 'ready'),
    ).resolves.toBe('ready');
  });

  it('restores use after release failure without affecting other libraries', async () => {
    const manager = new ExternalLibraryUsageManager();

    await expect(
      manager.quiesce('media-runtime', async () => {
        throw new Error('release failed');
      }),
    ).rejects.toThrow('release failed');

    await expect(
      manager.run('media-runtime', undefined, async () => 'retry'),
    ).resolves.toBe('retry');
    const other = await manager.quiesce('office-runtime');
    await expect(
      manager.run('media-runtime', undefined, async () => 'isolated'),
    ).resolves.toBe('isolated');
    other.dispose();
  });
});
