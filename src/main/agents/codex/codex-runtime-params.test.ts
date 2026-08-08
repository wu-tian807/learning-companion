import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AppError } from '../../errors/app-error';
import { toThreadConfiguration } from './codex-runtime-params';

describe('toThreadConfiguration', () => {
  it('selects a thread permission profile without changing the config default', () => {
    const profileId = 'learning-companion-generation';

    expect(
      toThreadConfiguration({
        cwd: resolve('test-fixtures', 'workspace'),
        permissions: profileId,
        configOverrides: {
          permissions: {
            [profileId]: {
              filesystem: { ':minimal': 'read' },
            },
          },
        },
      }),
    ).toMatchObject({
      permissions: profileId,
      config: {
        permissions: {
          [profileId]: {
            filesystem: { ':minimal': 'read' },
          },
        },
      },
    });
  });

  it('rejects a redundant default permission override', () => {
    expect(() =>
      toThreadConfiguration({
        permissions: 'learning-companion-generation',
        configOverrides: {
          default_permissions: 'learning-companion-generation',
        },
      }),
    ).toThrowError(AppError);
  });
});
