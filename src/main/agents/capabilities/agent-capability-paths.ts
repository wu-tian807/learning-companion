import { AppError } from '../../errors/app-error';
import {
  currentPlatformPathRules,
  type FileSystemPathRules,
} from '../../filesystem/file-system-path-rules';

export interface AgentCapabilityPaths {
  readonly rootPath: string;
  readonly skillsPath: string;
  readonly mcpPath: string;
}

export function createAgentCapabilityPaths(
  documentsPath: string,
  pathRules: FileSystemPathRules = currentPlatformPathRules,
): AgentCapabilityPaths {
  const normalized = pathRules.normalize(documentsPath.trim());

  if (
    normalized.length === 0 ||
    !pathRules.isAbsolute(normalized) ||
    normalized === pathRules.parse(normalized).root
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  const rootPath = pathRules.join(
    normalized,
    'Learning Companion',
    'agent-capabilities',
  );

  return Object.freeze({
    rootPath,
    skillsPath: pathRules.join(rootPath, 'skills'),
    mcpPath: pathRules.join(rootPath, 'mcp'),
  });
}
