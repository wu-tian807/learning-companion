import type {
  ContentHandle,
  WriteByteContentResult,
} from './content-handle';

export interface ContentWriteTracker {
  onDidWrite(result: WriteByteContentResult): Promise<void> | void;
  onTrackingError?(error: unknown): void;
}

export function createTrackedContentHandle(
  handle: ContentHandle,
  tracker: ContentWriteTracker,
): ContentHandle {
  return {
    capabilities: handle.capabilities,
    ...(handle.readBytes
      ? { readBytes: () => handle.readBytes!() }
      : {}),
    ...(handle.getByteLength
      ? { getByteLength: () => handle.getByteLength!() }
      : {}),
    ...(handle.openByteStream
      ? {
          openByteStream: (range) => handle.openByteStream!(range),
        }
      : {}),
    ...(handle.writeBytes
      ? {
          writeBytes: async (request) => {
            const result = await handle.writeBytes!(request);

            try {
              await tracker.onDidWrite(result);
            } catch (error) {
              try {
                tracker.onTrackingError?.(error);
              } catch {
                // 跟踪失败不能把已经完成的正文写入变成保存失败。
              }
            }

            return result;
          },
        }
      : {}),
    close: () => handle.close(),
  };
}
