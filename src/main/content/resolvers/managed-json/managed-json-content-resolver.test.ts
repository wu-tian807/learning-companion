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
  it('reads managed JSON as generic UTF-8 bytes', async () => {
    const resolver = new ManagedJsonContentResolver(createRepository());
    const resolved = await resolver.resolve(
      createManagedJsonContentRef('content-1'),
    );

    const content = await resolved.handle!.readBytes!();

    expect(new TextDecoder().decode(content.content)).toBe(
      '{"title":"测试内容"}',
    );
  });

  it('validates and writes managed JSON through the generic byte contract', async () => {
    const repository = createRepository();
    const resolver = new ManagedJsonContentResolver(repository);
    const resolved = await resolver.resolve(
      createManagedJsonContentRef('content-1'),
    );
    const current = await resolved.handle!.readBytes!();

    await expect(
      resolved.handle!.writeBytes!({
        content: new TextEncoder().encode('{"title":"新内容"}'),
        expectedRevision: current.revision,
      }),
    ).resolves.toHaveProperty('revision');
    expect(repository.set).toHaveBeenCalledWith('content-1', {
      title: '新内容',
    });
  });
});
