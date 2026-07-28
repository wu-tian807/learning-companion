import { createHash } from 'node:crypto';

export function createContentRevision(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
