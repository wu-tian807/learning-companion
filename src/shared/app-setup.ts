export const EXTERNAL_LIBRARY_ONBOARDING_VERSION = 1 as const;
export const CURRENT_ONBOARDING_VERSION = 2 as const;

export type AppOnboardingStep =
  | 'external-library'
  | 'agent-provider';

export interface AppSetupSnapshot {
  readonly currentOnboardingVersion: typeof CURRENT_ONBOARDING_VERSION;
  readonly completedOnboardingVersion: number;
  readonly pendingOnboardingStep: AppOnboardingStep | null;
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

  const pendingOnboardingStep =
    completedOnboardingVersion <
    EXTERNAL_LIBRARY_ONBOARDING_VERSION
      ? 'external-library'
      : completedOnboardingVersion < CURRENT_ONBOARDING_VERSION
        ? 'agent-provider'
        : null;

  return Object.freeze({
    currentOnboardingVersion: CURRENT_ONBOARDING_VERSION,
    completedOnboardingVersion,
    pendingOnboardingStep,
    requiresOnboarding: pendingOnboardingStep !== null,
  });
}

export function isAppSetupSnapshot(
  value: unknown,
): value is AppSetupSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<AppSetupSnapshot>;

  if (
    candidate.currentOnboardingVersion !==
      CURRENT_ONBOARDING_VERSION ||
    !isCompletedOnboardingVersion(
      candidate.completedOnboardingVersion,
    )
  ) {
    return false;
  }

  const expected = createAppSetupSnapshot(
    candidate.completedOnboardingVersion,
  );

  return (
    candidate.pendingOnboardingStep ===
      expected.pendingOnboardingStep &&
    candidate.requiresOnboarding === expected.requiresOnboarding
  );
}
