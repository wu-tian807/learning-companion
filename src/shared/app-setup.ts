export const CURRENT_ONBOARDING_VERSION = 1 as const;

export interface AppSetupSnapshot {
  readonly currentOnboardingVersion: typeof CURRENT_ONBOARDING_VERSION;
  readonly completedOnboardingVersion: number;
  readonly requiresOnboarding: boolean;
}

export function isCompletedOnboardingVersion(
  value: unknown,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function createAppSetupSnapshot(
  completedOnboardingVersion: number,
): AppSetupSnapshot {
  if (!isCompletedOnboardingVersion(completedOnboardingVersion)) {
    throw new Error('首次运行引导版本无效');
  }

  return Object.freeze({
    currentOnboardingVersion: CURRENT_ONBOARDING_VERSION,
    completedOnboardingVersion,
    requiresOnboarding:
      completedOnboardingVersion < CURRENT_ONBOARDING_VERSION,
  });
}

export function isAppSetupSnapshot(
  value: unknown,
): value is AppSetupSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<AppSetupSnapshot>;

  return (
    candidate.currentOnboardingVersion === CURRENT_ONBOARDING_VERSION &&
    isCompletedOnboardingVersion(candidate.completedOnboardingVersion) &&
    candidate.requiresOnboarding ===
      (candidate.completedOnboardingVersion <
        CURRENT_ONBOARDING_VERSION)
  );
}
