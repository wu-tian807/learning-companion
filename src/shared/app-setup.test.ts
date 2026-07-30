import { describe, expect, it } from 'vitest';

import {
  createAppSetupSnapshot,
  CURRENT_ONBOARDING_VERSION,
  EXTERNAL_LIBRARY_ONBOARDING_VERSION,
  isAppSetupSnapshot,
} from './app-setup';

describe('AppSetupSnapshot', () => {
  it('starts with the external-library step', () => {
    const snapshot = createAppSetupSnapshot(0);

    expect(snapshot).toEqual({
      currentOnboardingVersion: CURRENT_ONBOARDING_VERSION,
      completedOnboardingVersion: 0,
      pendingOnboardingStep: 'external-library',
      requiresOnboarding: true,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(isAppSetupSnapshot(snapshot)).toBe(true);
  });

  it('advances version 1 to the Agent Provider step', () => {
    expect(
      createAppSetupSnapshot(EXTERNAL_LIBRARY_ONBOARDING_VERSION),
    ).toEqual({
      currentOnboardingVersion: CURRENT_ONBOARDING_VERSION,
      completedOnboardingVersion:
        EXTERNAL_LIBRARY_ONBOARDING_VERSION,
      pendingOnboardingStep: 'agent-provider',
      requiresOnboarding: true,
    });
  });

  it('accepts current and newer completed versions without downgrading', () => {
    expect(
      createAppSetupSnapshot(CURRENT_ONBOARDING_VERSION),
    ).toMatchObject({
      pendingOnboardingStep: null,
      requiresOnboarding: false,
    });
    expect(
      createAppSetupSnapshot(CURRENT_ONBOARDING_VERSION + 1),
    ).toMatchObject({
      completedOnboardingVersion: CURRENT_ONBOARDING_VERSION + 1,
      pendingOnboardingStep: null,
      requiresOnboarding: false,
    });
  });

  it('rejects malformed or internally inconsistent snapshots', () => {
    expect(() => createAppSetupSnapshot(-1)).toThrow(
      '首次运行引导版本无效',
    );
    expect(
      isAppSetupSnapshot({
        currentOnboardingVersion: CURRENT_ONBOARDING_VERSION,
        completedOnboardingVersion: 0,
        pendingOnboardingStep: 'agent-provider',
        requiresOnboarding: false,
      }),
    ).toBe(false);
  });
});
