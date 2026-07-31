import { describe, expect, it, vi } from 'vitest';

import type { ContentHandle } from './content-handle';
import { createTrackedContentHandle } from './tracked-content-handle';

function createHandle(): ContentHandle {
  return {
    capabilities: new Set(['read-bytes', 'write-bytes']),
    readBytes: vi.fn(async () => ({
      content: new Uint8Array([1]),
      revision: 'before',
    })),
    writeBytes: vi.fn(async () => ({ revision: 'after' })),
    close: vi.fn(async () => undefined),
  };
}

describe('TrackedContentHandle', () => {
  it('preserves optional capabilities and reports successful writes once', async () => {
    const handle = createHandle();
    const onDidWrite = vi.fn(async () => undefined);
    const tracked = createTrackedContentHandle(handle, { onDidWrite });

    await expect(tracked.readBytes!()).resolves.toMatchObject({
      revision: 'before',
    });
    await expect(
      tracked.writeBytes!({
        content: new Uint8Array([2]),
        expectedRevision: 'before',
      }),
    ).resolves.toEqual({ revision: 'after' });
    await tracked.close();

    expect(tracked.capabilities).toBe(handle.capabilities);
    expect(onDidWrite).toHaveBeenCalledOnce();
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it('does not report failed writes', async () => {
    const writeError = new Error('write failed');
    const handle = createHandle();
    vi.mocked(handle.writeBytes!).mockRejectedValueOnce(writeError);
    const onDidWrite = vi.fn();
    const tracked = createTrackedContentHandle(handle, { onDidWrite });

    await expect(
      tracked.writeBytes!({
        content: new Uint8Array([2]),
        expectedRevision: 'before',
      }),
    ).rejects.toBe(writeError);
    expect(onDidWrite).not.toHaveBeenCalled();
  });

  it('keeps a successful write successful when tracking fails', async () => {
    const handle = createHandle();
    const trackingError = new Error('tracking failed');
    const onTrackingError = vi.fn();
    const tracked = createTrackedContentHandle(handle, {
      onDidWrite: () => {
        throw trackingError;
      },
      onTrackingError,
    });

    await expect(
      tracked.writeBytes!({
        content: new Uint8Array([2]),
        expectedRevision: 'before',
      }),
    ).resolves.toEqual({ revision: 'after' });
    expect(onTrackingError).toHaveBeenCalledWith(trackingError);
  });

  it('does not add capabilities absent from the underlying handle', () => {
    const handle: ContentHandle = {
      capabilities: new Set(),
      close: async () => undefined,
    };
    const tracked = createTrackedContentHandle(handle, {
      onDidWrite: vi.fn(),
    });

    expect(tracked.readBytes).toBeUndefined();
    expect(tracked.writeBytes).toBeUndefined();
    expect(tracked.openByteStream).toBeUndefined();
  });
});
