import { AppError } from '../../errors/app-error';
import type {
  CodexThreadConfiguration,
  StartCodexTurnInput,
} from './codex-runtime-types';
import {
  optionalAbsolutePath,
  optionalAbsolutePaths,
  requireAbsolutePath,
  requireNonEmptyString,
} from './codex-runtime-validation';

export function toThreadConfiguration(
  input: CodexThreadConfiguration,
): Record<string, unknown> {
  if (input.permissions !== undefined && input.sandbox !== undefined) {
    throw new AppError('DATA_INTEGRITY_ERROR', {
      cause: new Error(
        'Codex permissions and legacy sandbox cannot be used together',
      ),
    });
  }

  return {
    model: input.model,
    modelProvider: input.modelProvider,
    serviceTier: input.serviceTier,
    cwd: optionalAbsolutePath(input.cwd, 'cwd'),
    runtimeWorkspaceRoots: optionalAbsolutePaths(
      input.runtimeWorkspaceRoots,
      'runtimeWorkspaceRoots',
    ),
    approvalPolicy: input.approvalPolicy,
    sandbox: input.sandbox,
    permissions: input.permissions,
    config: input.configOverrides,
    baseInstructions: input.baseInstructions,
    developerInstructions: input.developerInstructions,
    personality: input.personality,
  };
}

export function toTurnParams(
  input: StartCodexTurnInput,
): Record<string, unknown> {
  if (input.input.length === 0) {
    throw new AppError('DATA_INTEGRITY_ERROR', {
      cause: new Error('Codex turn input cannot be empty'),
    });
  }

  if (
    input.permissions !== undefined &&
    input.sandboxPolicy !== undefined
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR', {
      cause: new Error(
        'Codex permissions and sandboxPolicy cannot be used together',
      ),
    });
  }

  if (input.sandboxPolicy?.type === 'workspaceWrite') {
    for (const root of input.sandboxPolicy.writableRoots) {
      requireAbsolutePath(root, 'sandboxPolicy.writableRoots');
    }
  }

  const userInput = input.input.map((item) => {
    if (
      item.type === 'localImage' ||
      item.type === 'localAudio' ||
      item.type === 'skill' ||
      item.type === 'mention'
    ) {
      requireAbsolutePath(item.path, `input.${item.type}.path`);
    }

    return item.type === 'text'
      ? {
          type: 'text',
          text: item.text,
          text_elements: [],
        }
      : { ...item };
  });

  return {
    threadId: requireNonEmptyString(input.threadId, 'threadId'),
    clientUserMessageId: input.clientUserMessageId,
    input: userInput,
    responsesapiClientMetadata: input.responsesApiClientMetadata,
    additionalContext: input.additionalContext,
    cwd: optionalAbsolutePath(input.cwd, 'cwd'),
    runtimeWorkspaceRoots: optionalAbsolutePaths(
      input.runtimeWorkspaceRoots,
      'runtimeWorkspaceRoots',
    ),
    approvalPolicy: input.approvalPolicy,
    sandboxPolicy: input.sandboxPolicy,
    permissions: input.permissions,
    model: input.model,
    serviceTier: input.serviceTier,
    effort: input.effort,
    summary: input.summary,
    personality: input.personality,
    outputSchema: input.outputSchema,
  };
}
