export const ASSET_FOLDER_NAME_MAX_LENGTH = 160;
export const ASSET_FOLDER_PATH_MAX_LENGTH = 512;

export interface AssetFolderSnapshot {
  readonly projectId: string;
  readonly path: string;
}

export interface AssetFolderState {
  readonly projectId: string;
  readonly folders: readonly AssetFolderSnapshot[];
  readonly folderPathByAssetId: Readonly<Record<string, string>>;
}

const invalidFolderNameCharacters = /[<>:"/\\|?*]/u;
const reservedWindowsName =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function codePointLength(value: string): number {
  return [...value].length;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32);
}

export function normalizeAssetFolderName(value: string): string {
  const name = value.trim().normalize('NFC');

  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.endsWith('.') ||
    codePointLength(name) > ASSET_FOLDER_NAME_MAX_LENGTH ||
    invalidFolderNameCharacters.test(name) ||
    hasControlCharacter(name) ||
    reservedWindowsName.test(name)
  ) {
    throw new Error('Asset Folder 名称无效');
  }

  return name;
}

export function normalizeAssetFolderPath(value: string): string {
  const path = value.trim().normalize('NFC');
  const segments = path.split('/');

  if (
    path.length === 0 ||
    codePointLength(path) > ASSET_FOLDER_PATH_MAX_LENGTH ||
    segments.some((segment) => normalizeAssetFolderName(segment) !== segment)
  ) {
    throw new Error('Asset Folder 路径无效');
  }

  return segments.join('/');
}

export function isAssetFolderPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return normalizeAssetFolderPath(value) === value;
  } catch {
    return false;
  }
}

export function assetFolderPathKey(path: string): string {
  return normalizeAssetFolderPath(path).toLocaleLowerCase('en-US');
}

export function assetFolderName(path: string): string {
  return normalizeAssetFolderPath(path).split('/').at(-1)!;
}

export function assetFolderParentPath(path: string): string | null {
  const segments = normalizeAssetFolderPath(path).split('/');
  return segments.length === 1 ? null : segments.slice(0, -1).join('/');
}

export function joinAssetFolderPath(
  parentPath: string | null,
  name: string,
): string {
  const normalizedName = normalizeAssetFolderName(name);
  return parentPath === null
    ? normalizedName
    : `${normalizeAssetFolderPath(parentPath)}/${normalizedName}`;
}

export function isAssetFolderPathWithin(
  path: string,
  ancestorPath: string,
): boolean {
  const pathKey = assetFolderPathKey(path);
  const ancestorKey = assetFolderPathKey(ancestorPath);
  return pathKey === ancestorKey || pathKey.startsWith(`${ancestorKey}/`);
}

export function rebaseAssetFolderPath(
  path: string,
  sourcePath: string,
  targetPath: string,
): string {
  const normalizedPath = normalizeAssetFolderPath(path);
  const normalizedSource = normalizeAssetFolderPath(sourcePath);
  const normalizedTarget = normalizeAssetFolderPath(targetPath);

  if (!isAssetFolderPathWithin(normalizedPath, normalizedSource)) {
    return normalizedPath;
  }

  const suffix = normalizedPath.slice(normalizedSource.length);
  return normalizeAssetFolderPath(`${normalizedTarget}${suffix}`);
}

export function isAssetFolderSnapshot(
  value: unknown,
): value is AssetFolderSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return (
    typeof record.projectId === 'string' &&
    record.projectId.trim().length > 0 &&
    isAssetFolderPath(record.path)
  );
}

export function isAssetFolderState(value: unknown): value is AssetFolderState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record.projectId !== 'string' ||
    record.projectId.trim().length === 0 ||
    !Array.isArray(record.folders) ||
    !record.folders.every(isAssetFolderSnapshot) ||
    typeof record.folderPathByAssetId !== 'object' ||
    record.folderPathByAssetId === null ||
    Array.isArray(record.folderPathByAssetId)
  ) {
    return false;
  }

  const folders = record.folders as readonly AssetFolderSnapshot[];
  const paths = new Set(
    folders.map((folder) => assetFolderPathKey(folder.path)),
  );
  if (
    paths.size !== folders.length ||
    folders.some((folder) => folder.projectId !== record.projectId)
  ) {
    return false;
  }

  return Object.entries(record.folderPathByAssetId).every(
    ([assetId, path]) =>
      assetId.trim().length > 0 &&
      isAssetFolderPath(path) &&
      paths.has(assetFolderPathKey(path)),
  );
}

export function cloneAssetFolderState(
  state: AssetFolderState,
): AssetFolderState {
  if (!isAssetFolderState(state)) {
    throw new Error('Asset Folder State 数据无效');
  }

  return Object.freeze({
    projectId: state.projectId.trim(),
    folders: Object.freeze(
      state.folders.map((folder) =>
        Object.freeze({
          projectId: folder.projectId.trim(),
          path: folder.path,
        }),
      ),
    ),
    folderPathByAssetId: Object.freeze({
      ...state.folderPathByAssetId,
    }),
  });
}
