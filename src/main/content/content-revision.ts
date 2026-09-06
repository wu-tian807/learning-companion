import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

import type { ResolvedByteStream } from './content-handle';

export function createContentRevision(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function createStreamContentRevision(
  openByteStream: () => Promise<ResolvedByteStream>,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const resolved = await openByteStream();
  const reader = resolved.stream.getReader();
  if (resolved.revision?.trim()) {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    return resolved.revision;
  }
  const hash = createHash('sha256');

  try {
    while (true) {
      signal?.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      hash.update(result.value);
    }
    signal?.throwIfAborted();
    return hash.digest('hex');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
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
