import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

export function createContentRevision(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function createFileContentRevision(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const file = await open(path, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);

  try {
    while (true) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(
        buffer,
        0,
        buffer.byteLength,
        null,
      );

      if (bytesRead === 0) {
        break;
      }

      hash.update(buffer.subarray(0, bytesRead));
    }

    signal?.throwIfAborted();
    return hash.digest('hex');
  } finally {
    await file.close();
  }
}
