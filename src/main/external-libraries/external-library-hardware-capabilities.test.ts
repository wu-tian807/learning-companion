import { describe, expect, it, vi } from 'vitest';

import {
  detectExternalLibraryHardwareCapabilities,
  hasNvidiaGpu,
} from './external-library-hardware-capabilities';

describe('external library hardware capabilities', () => {
  it('recognizes Electron NVIDIA vendor identifiers', () => {
    expect(hasNvidiaGpu({ gpuDevice: [{ vendorId: 0x10de }] })).toBe(true);
    expect(hasNvidiaGpu({ gpuDevice: [{ vendorId: '0x10DE' }] })).toBe(true);
    expect(hasNvidiaGpu({ gpuDevice: [{ vendorId: '4318' }] })).toBe(true);
  });

  it('does not mistake Intel, AMD or malformed GPU data for NVIDIA', () => {
    expect(
      hasNvidiaGpu({
        gpuDevice: [{ vendorId: 0x8086 }, { vendorId: 0x1002 }],
      }),
    ).toBe(false);
    expect(hasNvidiaGpu(undefined)).toBe(false);
    expect(hasNvidiaGpu({ gpuDevice: 'not-an-array' })).toBe(false);
  });

  it('falls back to the compatible profile when GPU inspection fails', async () => {
    const logger = { warn: vi.fn() };

    await expect(
      detectExternalLibraryHardwareCapabilities(
        vi.fn(async () => {
          throw new Error('gpu process unavailable');
        }),
        logger,
      ),
    ).resolves.toEqual({ nvidiaGpuAvailable: false });
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
