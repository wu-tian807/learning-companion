import { AppError } from '../../../main/errors/app-error';
import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import type { MainWorkbenchProvider } from '../../../main/workbench/workbench-session';
import { VideoWorkbenchProvider } from '../main';
import { createVideoFunctionTool } from './video-function-tool';

function requireVideoProvider(
  provider: MainWorkbenchProvider | undefined,
): VideoWorkbenchProvider {
  if (!(provider instanceof VideoWorkbenchProvider)) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return provider;
}

export const videoAgentMainFeature = Object.freeze({
  id: 'builtin.video.agent-reader',
  registerAgentFunctionTools({ functionTools, provider }): void {
    functionTools.register(
      createVideoFunctionTool(
        requireVideoProvider(provider).getAgentMediaRuntime(),
      ),
    );
  },
} satisfies MainWorkbenchFeatureContribution);
