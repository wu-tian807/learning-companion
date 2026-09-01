interface GpuDeviceLike {
  readonly vendorId?: unknown;
  readonly vendor?: unknown;
  readonly vendorString?: unknown;
  readonly deviceName?: unknown;
}

export interface ExternalLibraryHardwareCapabilities {
  readonly nvidiaGpuAvailable: boolean;
  readonly appleSiliconAvailable: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNvidiaVendorId(value: unknown): boolean {
  if (typeof value === 'number') return value === 0x10de;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  const radix = normalized.startsWith('0x') ? 16 : 10;
  return Number.parseInt(normalized.replace(/^0x/u, ''), radix) === 0x10de;
}

function mentionsNvidia(value: unknown): boolean {
  return typeof value === 'string' && /nvidia/iu.test(value);
}

function isNvidiaDevice(value: unknown): value is GpuDeviceLike {
  return (
    isRecord(value) &&
    (isNvidiaVendorId(value.vendorId) ||
      mentionsNvidia(value.vendor) ||
      mentionsNvidia(value.vendorString) ||
      mentionsNvidia(value.deviceName))
  );
}

export function hasNvidiaGpu(gpuInfo: unknown): boolean {
  if (!isRecord(gpuInfo)) return false;

  const devices = Array.isArray(gpuInfo.gpuDevice)
    ? gpuInfo.gpuDevice
    : Array.isArray(gpuInfo.gpuDevices)
      ? gpuInfo.gpuDevices
      : [];
  return devices.some(isNvidiaDevice);
}

export async function detectExternalLibraryHardwareCapabilities(
  getGpuInfo: () => Promise<unknown>,
  logger: Pick<Console, 'warn'> = console,
  platform = process.platform,
  architecture = process.arch,
): Promise<ExternalLibraryHardwareCapabilities> {
  const appleSiliconAvailable =
    platform === 'darwin' && architecture === 'arm64';
  try {
    return Object.freeze({
      nvidiaGpuAvailable: hasNvidiaGpu(await getGpuInfo()),
      appleSiliconAvailable,
    });
  } catch (error) {
    logger.warn('无法读取 GPU 信息，外部组件将使用兼容配置', error);
    return Object.freeze({
      nvidiaGpuAvailable: false,
      appleSiliconAvailable,
    });
  }
}
