import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';

import { createImageRegionTarget } from '../../shared';
import { prepareImageExplanationInputs } from './image-input-preparer';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('image explanation input preparation', () => {
  it('creates an unmarked overview, marked overview, and padded crop', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'image-explanation-'));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, 'source.png');
    const canvas = createCanvas(400, 200);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 400, 200);
    context.fillStyle = '#2563eb';
    context.fillRect(100, 50, 100, 80);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(sourcePath, canvas.toBuffer('image/png')));

    const result = await prepareImageExplanationInputs(
      sourcePath,
      createImageRegionTarget({ x: 0.25, y: 0.25, width: 0.25, height: 0.4, sourceWidth: 400, sourceHeight: 200 }),
      directory,
    );

    const [overview, marked, crop] = await Promise.all([
      loadImage(await readFile(result.overviewPath)),
      loadImage(await readFile(result.markedOverviewPath)),
      loadImage(await readFile(result.cropPath)),
    ]);
    expect([overview.width, overview.height]).toEqual([400, 200]);
    expect([marked.width, marked.height]).toEqual([400, 200]);
    expect(crop.width).toBeGreaterThan(100);
    expect(crop.height).toBeGreaterThan(80);
    expect(crop.width).toBeLessThan(400);
  });

  it('rejects an anchor captured from different image dimensions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'image-explanation-'));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, 'source.png');
    const canvas = createCanvas(40, 20);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(sourcePath, canvas.toBuffer('image/png')));

    await expect(prepareImageExplanationInputs(
      sourcePath,
      createImageRegionTarget({ x: 0.1, y: 0.1, width: 0.5, height: 0.5, sourceWidth: 80, sourceHeight: 40 }),
      directory,
    )).rejects.toMatchObject({ code: 'CONTENT_CHANGED_EXTERNALLY' });
  });
});
