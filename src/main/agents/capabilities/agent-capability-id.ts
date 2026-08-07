import { AppError } from '../../errors/app-error';

const agentCapabilityIdPattern = /^[a-z][a-z0-9_-]{0,63}$/u;

export function requireAgentCapabilityId(value: string): string {
  const normalized = value.trim();

  if (!agentCapabilityIdPattern.test(normalized)) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return normalized;
}
