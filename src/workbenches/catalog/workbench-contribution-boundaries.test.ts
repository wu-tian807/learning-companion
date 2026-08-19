import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src');
const WORKBENCH_ROOT = join(SOURCE_ROOT, 'workbenches');

function source(path: string): string {
  return readFileSync(join(SOURCE_ROOT, path), 'utf8');
}

function importsOf(value: string): string[] {
  return [...value.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)].map(
    ([, specifier]) => specifier,
  );
}

function productionWorkbenchFiles(directory = WORKBENCH_ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (absolute === join(WORKBENCH_ROOT, 'catalog')) return [];
      return productionWorkbenchFiles(absolute);
    }
    if (
      !/\.(?:ts|tsx)$/u.test(entry.name) ||
      /\.(?:test|integration)\.(?:ts|tsx)$/u.test(entry.name)
    ) {
      return [];
    }
    return [absolute];
  });
}

function workbenchImports(path: string): string[] {
  return importsOf(source(path)).filter(
    (specifier) =>
      specifier.startsWith('../') && !specifier.startsWith('../../'),
  );
}

describe('Workbench contribution ownership boundaries', () => {
  it.each([
    [
      'workbenches/catalog/register-main-workbenches.ts',
      /^\.\.\/[^/]+\/main-contribution$/u,
    ],
    [
      'workbenches/catalog/register-preload-workbench-features.ts',
      /^\.\.\/[^/]+\/preload-contribution$/u,
    ],
    [
      'workbenches/catalog/register-renderer-workbenches.ts',
      /^\.\.\/[^/]+\/renderer-contribution$/u,
    ],
  ])('%s imports each Workbench only through its process contribution', (path, pattern) => {
    const invalid = workbenchImports(path).filter(
      (specifier) => !pattern.test(specifier),
    );
    expect(invalid).toEqual([]);
  });

  it('keeps Workbench production code independent from catalog implementation files', () => {
    const invalid = productionWorkbenchFiles().flatMap((absolute) =>
      importsOf(readFileSync(absolute, 'utf8'))
        .filter((specifier) => /(?:^|\/)catalog\/register-/u.test(specifier))
        .map((specifier) => ({
          file: relative(WORKBENCH_ROOT, absolute).replaceAll('\\', '/'),
          specifier,
        })),
    );
    expect(invalid).toEqual([]);
  });

  it('keeps Workbench views independent from Host implementation modules', () => {
    const invalid = productionWorkbenchFiles().flatMap((absolute) =>
      importsOf(readFileSync(absolute, 'utf8'))
        .filter((specifier) =>
          /renderer\/workbench\/host\/Workbench[^/]*Portal$/u.test(specifier),
        )
        .map((specifier) => ({
          file: relative(WORKBENCH_ROOT, absolute).replaceAll('\\', '/'),
          specifier,
        })),
    );
    expect(invalid).toEqual([]);
  });
});
