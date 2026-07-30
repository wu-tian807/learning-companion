import {
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';

export interface FileSystemPathRules {
  readonly isAbsolute: (path: string) => boolean;
  readonly join: (...paths: string[]) => string;
  readonly normalize: (path: string) => string;
  readonly parse: (path: string) => { readonly root: string };
  readonly relative: (from: string, to: string) => string;
  readonly resolve: (...paths: string[]) => string;
  readonly sep: string;
}

export const currentPlatformPathRules: FileSystemPathRules = Object.freeze({
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
});

export function isPathInside(
  root: string,
  target: string,
  pathRules: FileSystemPathRules = currentPlatformPathRules,
): boolean {
  const relativePath = pathRules.relative(root, target);

  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${pathRules.sep}`) &&
      relativePath !== '..' &&
      !pathRules.isAbsolute(relativePath))
  );
}
