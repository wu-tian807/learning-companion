import { describe, expect, it, vi } from 'vitest';

import { createAppSetupSnapshot } from '../../shared/app-setup';
import {
  OnboardingDecisionError,
  runOnboardingDecision,
} from './onboarding-decision';

describe('runOnboardingDecision', () => {
  it('waits for task admission before persisting completion', async () => {
    const order: string[] = [];

    const result = await runOnboardingDecision({
      decision: 'install',
      libraryStatus: 'not-installed',
      installationAccepted: false,
      startInstallation: vi.fn(async () => {
        order.push('start');
      }),
      completeOnboarding: vi.fn(async () => {
        order.push('complete');
        return createAppSetupSnapshot(1);
      }),
    });

    expect(order).toEqual(['start', 'complete']);
    expect(result.installationAccepted).toBe(true);
    expect(result.setup).toMatchObject({
      pendingOnboardingStep: 'agent-provider',
      requiresOnboarding: true,
    });
  });

  it('skips installation when the user explicitly continues without it', async () => {
    const startInstallation = vi.fn();

    await runOnboardingDecision({
      decision: 'skip',
      libraryStatus: 'not-installed',
      installationAccepted: false,
      startInstallation,
      completeOnboarding: vi.fn(async () => createAppSetupSnapshot(1)),
    });

    expect(startInstallation).not.toHaveBeenCalled();
  });

  it('does not restart an active or previously accepted installation', async () => {
    const startInstallation = vi.fn();

    await runOnboardingDecision({
      decision: 'install',
      libraryStatus: 'downloading',
      installationAccepted: false,
      startInstallation,
      completeOnboarding: vi.fn(async () => createAppSetupSnapshot(1)),
    });
    await runOnboardingDecision({
      decision: 'install',
      libraryStatus: 'failed',
      installationAccepted: true,
      startInstallation,
      completeOnboarding: vi.fn(async () => createAppSetupSnapshot(1)),
    });

    expect(startInstallation).not.toHaveBeenCalled();
  });

  it('distinguishes task admission failure from later settings failure', async () => {
    await expect(
      runOnboardingDecision({
        decision: 'install',
        libraryStatus: 'not-installed',
        installationAccepted: false,
        startInstallation: vi.fn(async () => {
          throw new Error('start failed');
        }),
        completeOnboarding: vi.fn(),
      }),
    ).rejects.toMatchObject({
      stage: 'start-installation',
      installationAccepted: false,
    });

    await expect(
      runOnboardingDecision({
        decision: 'install',
        libraryStatus: 'not-installed',
        installationAccepted: false,
        startInstallation: vi.fn(async () => undefined),
        completeOnboarding: vi.fn(async () => {
          throw new Error('settings failed');
        }),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<OnboardingDecisionError>>({
        stage: 'persist-completion',
        installationAccepted: true,
      }),
    );
  });
});
