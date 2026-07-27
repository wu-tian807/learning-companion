import { describe, expect, it } from 'vitest';

import { EmptyWorkbenchStateRepository } from './workbench-state-repository';

describe('EmptyWorkbenchStateRepository', () => {
  it('returns no state and rejects persistence explicitly', async () => {
    const repository = new EmptyWorkbenchStateRepository();

    await expect(repository.get('asset', 'workbench')).resolves.toBeUndefined();
    await expect(
      repository.save({
        assetId: 'asset',
        workbenchId: 'workbench',
        schemaVersion: 1,
        payload: {},
        updatedTime: Date.now(),
      }),
    ).rejects.toThrow('FEATURE_NOT_SUPPORTED');
  });
});
