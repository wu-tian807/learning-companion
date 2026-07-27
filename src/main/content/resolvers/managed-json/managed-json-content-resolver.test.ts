import { describe, expect, it, vi } from 'vitest';

import { createManagedJsonContentRef } from '../../content-ref';
import type { ManagedJsonContentRepository } from './managed-json-content-repository';
import { ManagedJsonContentResolver } from './managed-json-content-resolver';

function createRepository(): ManagedJsonContentRepository {
  return {
    get: vi.fn(async () => ({ title: '测试内容' })),
    set: vi.fn(async () => undefined),
  };
}

describe('ManagedJsonContentResolver', () => {
  it('reads managed JSON as UTF-8', async () => {
    const resolver = new ManagedJsonContentResolver(createRepository());
    const resolved = await resolver.resolve(
      createManagedJsonContentRef('content-1'),
    );

    await expect(
      resolved.handle!.readText!({ encoding: 'utf-8' }),
    ).resolves.toMatchObject({
      content: '{"title":"测试内容"}',
      encoding: 'utf-8',
      lineEnding: 'lf',
    });
  });

  it('rejects an encoding that managed JSON cannot provide', async () => {
    const resolver = new ManagedJsonContentResolver(createRepository());
    const resolved = await resolver.resolve(
      createManagedJsonContentRef('content-1'),
    );

    await expect(
      resolved.handle!.readText!({ encoding: 'gbk' }),
    ).rejects.toMatchObject({
      code: 'CONTENT_ENCODING_UNSUPPORTED',
    });
  });
});
