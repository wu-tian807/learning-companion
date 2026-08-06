import { AppError } from '../../errors/app-error';
import type { FileSystemPathRules } from '../../filesystem/file-system-path-rules';

const invalidPortableSegmentCharacters = /[<>:"/\\|?*]/u;
const windowsReservedDeviceName =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const workspaceKeyPattern = /^[a-z][a-z0-9-]{0,63}$/u;

export function requireAgentWorkspaceRootPath(
  rootPath: string,
  pathRules: FileSystemPathRules,
): string {
  const normalized = pathRules.normalize(rootPath.trim());

  if (
    normalized.length === 0 ||
    !pathRules.isAbsolute(normalized) ||
    normalized === pathRules.parse(normalized).root
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

export function requireAgentWorkspacePathSegment(
  segment: string,
): string {
  const containsControlCharacter = [...segment].some(
    (character) => character.codePointAt(0)! < 0x20,
  );

  if (
    segment.length === 0 ||
    segment.trim() !== segment ||
    segment === '.' ||
    segment === '..' ||
    segment.endsWith('.') ||
    containsControlCharacter ||
    invalidPortableSegmentCharacters.test(segment) ||
    windowsReservedDeviceName.test(segment)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return segment;
}

export function requireAgentWorkspaceKey(value: string): string {
  const normalized = value.trim();

  if (!workspaceKeyPattern.test(normalized)) {
    throw new Error('Agent workspace key 必须是扁平 kebab-case 主键');
  }

  return normalized;
}
