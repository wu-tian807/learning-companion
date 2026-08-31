import type { AppSetupSnapshot } from '../../shared/app-setup';
import type { ExternalLibraryStatus } from '../../shared/external-libraries';
import { isExternalLibraryInstalling } from '../external-libraries/external-library-view';

export type OnboardingDecision = 'install' | 'skip';
export type OnboardingDecisionStage =
  | 'start-installation'
  | 'persist-completion';

export class OnboardingDecisionError extends Error {
  readonly name = 'OnboardingDecisionError';

  constructor(
    readonly stage: OnboardingDecisionStage,
    readonly installationAccepted: boolean,
    options: ErrorOptions,
  ) {
    super(
      stage === 'start-installation'
        ? '无法开始推荐组件安装'
        : '无法保存首次运行引导状态',
      options,
    );
  }
}

export interface RunOnboardingDecisionInput {
  readonly decision: OnboardingDecision;
  readonly libraryStatus?: ExternalLibraryStatus;
  readonly installationAccepted: boolean;
  readonly startInstallation: () => Promise<void>;
  readonly completeOnboarding: () => Promise<AppSetupSnapshot>;
}

export interface RunOnboardingDecisionResult {
  readonly setup: AppSetupSnapshot;
  readonly installationAccepted: boolean;
}

function requiresInstallationStart(
  status: ExternalLibraryStatus | undefined,
): boolean {
  return status === 'not-installed' || status === 'failed';
}

export async function runOnboardingDecision(
  input: RunOnboardingDecisionInput,
): Promise<RunOnboardingDecisionResult> {
  let installationAccepted =
    input.installationAccepted ||
    (input.libraryStatus !== undefined &&
      isExternalLibraryInstalling(input.libraryStatus));

  if (
    input.decision === 'install' &&
    !installationAccepted &&
    requiresInstallationStart(input.libraryStatus)
  ) {
    try {
      await input.startInstallation();
      installationAccepted = true;
    } catch (error) {
      throw new OnboardingDecisionError(
        'start-installation',
        false,
        { cause: error },
      );
    }
  }

  try {
    const setup = await input.completeOnboarding();
    return { setup, installationAccepted };
  } catch (error) {
    throw new OnboardingDecisionError(
      'persist-completion',
      installationAccepted,
      { cause: error },
    );
  }
}
