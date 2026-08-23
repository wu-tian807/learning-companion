import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createCanvas, loadImage } from '@napi-rs/canvas';

import { AppError } from '../errors/app-error';

const MAX_SOURCE_PIXELS = 100_000_000;
const MAX_OVERVIEW_EDGE = 2048;
const MAX_CROP_EDGE = 2048;

export interface NormalizedVisualRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export interface PreparedVisualRegionInputs {
  readonly overviewPath: string;
  readonly markedOverviewPath: string;
  readonly cropPath: string;
}

function outputSize(width: number, height: number, maximumEdge: number) {
  const scale = Math.min(1, maximumEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function prepareVisualRegionInputs(
  sourcePath: string,
  region: NormalizedVisualRegion,
  outputDirectory: string,
): Promise<PreparedVisualRegionInputs> {
  const image = await loadImage(sourcePath);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    sourceWidth * sourceHeight > MAX_SOURCE_PIXELS
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR', {
      cause: new Error('视觉输入尺寸无效或像素总量超过安全限制'),
    });
  }
  if (
    sourceWidth !== region.sourceWidth ||
    sourceHeight !== region.sourceHeight
  ) {
    throw new AppError('CONTENT_CHANGED_EXTERNALLY', {
      cause: new Error('视觉输入尺寸与创建兴趣区域时不一致'),
    });
  }

  await mkdir(outputDirectory, { recursive: true });
  const overviewSize = outputSize(sourceWidth, sourceHeight, MAX_OVERVIEW_EDGE);
  const overviewCanvas = createCanvas(overviewSize.width, overviewSize.height);
  const overviewContext = overviewCanvas.getContext('2d');
  overviewContext.imageSmoothingEnabled = true;
  overviewContext.imageSmoothingQuality = 'high';
  overviewContext.drawImage(image, 0, 0, overviewSize.width, overviewSize.height);
  const overviewPath = join(outputDirectory, 'overview.png');
  await writeFile(overviewPath, overviewCanvas.toBuffer('image/png'));

  const markedCanvas = createCanvas(overviewSize.width, overviewSize.height);
  const markedContext = markedCanvas.getContext('2d');
  markedContext.drawImage(overviewCanvas, 0, 0);
  const x = region.x * overviewSize.width;
  const y = region.y * overviewSize.height;
  const width = region.width * overviewSize.width;
  const height = region.height * overviewSize.height;
  markedContext.fillStyle = 'rgba(0, 0, 0, 0.42)';
  markedContext.fillRect(0, 0, overviewSize.width, y);
  markedContext.fillRect(
    0,
    y + height,
    overviewSize.width,
    overviewSize.height - y - height,
  );
  markedContext.fillRect(0, y, x, height);
  markedContext.fillRect(
    x + width,
    y,
    overviewSize.width - x - width,
    height,
  );
  markedContext.strokeStyle = '#ff3b30';
  markedContext.lineWidth = Math.max(
    3,
    Math.round(Math.min(overviewSize.width, overviewSize.height) / 300),
  );
  markedContext.strokeRect(x, y, width, height);
  const markedOverviewPath = join(outputDirectory, 'marked-overview.png');
  await writeFile(markedOverviewPath, markedCanvas.toBuffer('image/png'));

  const regionX = region.x * sourceWidth;
  const regionY = region.y * sourceHeight;
  const regionWidth = region.width * sourceWidth;
  const regionHeight = region.height * sourceHeight;
  const paddingX = Math.max(regionWidth * 0.18, sourceWidth * 0.01, 16);
  const paddingY = Math.max(regionHeight * 0.18, sourceHeight * 0.01, 16);
  const cropX = Math.max(0, Math.floor(regionX - paddingX));
  const cropY = Math.max(0, Math.floor(regionY - paddingY));
  const cropRight = Math.min(
    sourceWidth,
    Math.ceil(regionX + regionWidth + paddingX),
  );
  const cropBottom = Math.min(
    sourceHeight,
    Math.ceil(regionY + regionHeight + paddingY),
  );
  const cropWidth = Math.max(1, cropRight - cropX);
  const cropHeight = Math.max(1, cropBottom - cropY);
  const cropSize = outputSize(cropWidth, cropHeight, MAX_CROP_EDGE);
  const cropCanvas = createCanvas(cropSize.width, cropSize.height);
  const cropContext = cropCanvas.getContext('2d');
  cropContext.imageSmoothingEnabled = true;
  cropContext.imageSmoothingQuality = 'high';
  cropContext.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropSize.width,
    cropSize.height,
  );
  const cropPath = join(outputDirectory, 'region-with-context.png');
  await writeFile(cropPath, cropCanvas.toBuffer('image/png'));

  return Object.freeze({ overviewPath, markedOverviewPath, cropPath });
}
