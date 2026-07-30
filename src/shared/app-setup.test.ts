import { describe, expect, it } from 'vitest';

import {
  createAppSetupSnapshot,
  CURRENT_ONBOARDING_VERSION,
  isAppSetupSnapshot,
} from './app-setup';

describe('AppSetupSnapshot', () => {
  it('requires onboarding when the completed version is behind', () => {
    const snapshot = createAppSetupSnapshot(0);

    expect(snapshot).toEqual({
      currentOnboardingVersion: CURRENT_ONBOARDING_VERSION,
      completedOnboardingVersion: 0,
      requiresOnboarding: true,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(isAppSetupSnapshot(snapshot)).toBe(true);
  });

  it('accepts current and newer completed versions without downgrading', () => {
    expect(createAppSetupSnapshot(CURRENT_ONBOARDING_VERSION)).toMatchObject({
      requiresOnboarding: false,
    });
    expect(createAppSetupSnapshot(CURRENT_ONBOARDING_VERSION + 1)).toMatchObject(
      {
        completedOnboardingVersion: CURRENT_ONBOARDING_VERSION + 1,
        requiresOnboarding: false,
      },
    );
  });

  it('rejects malformed or internally inconsistent snapshots', () => {
    expect(() => createAppSetupSnapshot(-1)).toThrow(
      '首次运行引导版本无效',
    );
    expect(
      isAppSetupSnapshot({
        currentOnboardingVersion: CURRENT_ONBOARDING_VERSION,
        completedOnboardingVersion: 0,
        requiresOnboarding: false,
      }),
    ).toBe(false);
  });
});
