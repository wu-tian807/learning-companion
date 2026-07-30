import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createDefaultAssetName,
  detectAssetMediaType,
  isAssetRelinkMediaCompatible,
  PLAIN_TEXT_ASSET_MEDIA_TYPE,
  UNKNOWN_ASSET_MEDIA_TYPE,
} from './asset-media-type';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'learning-media-type-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Asset media type', () => {
  it('detects predefined MIME values without reading file contents', async () => {
    await expect(detectAssetMediaType('/tmp/notes.MD')).resolves.toBe(
      'text/markdown',
    );
    await expect(detectAssetMediaType('/tmp/notes.markdown')).resolves.toBe(
      'text/markdown',
    );
    await expect(detectAssetMediaType('/tmp/paper.PDF')).resolves.toBe(
      'application/pdf',
    );
    await expect(detectAssetMediaType('/tmp/book.epub')).resolves.toBe(
      'application/epub+zip',
    );
    await expect(detectAssetMediaType('/tmp/page.HTML')).resolves.toBe(
      'text/html',
    );
    await expect(detectAssetMediaType('/tmp/legacy.htm')).resolves.toBe(
      'text/html',
    );
    await expect(detectAssetMediaType('/tmp/lesson.mp4')).resolves.toBe(
      'video/mp4',
    );
    await expect(detectAssetMediaType('/tmp/lesson.M4V')).resolves.toBe(
      'video/mp4',
    );
    await expect(detectAssetMediaType('/tmp/lesson.webm')).resolves.toBe(
      'video/webm',
    );
    await expect(detectAssetMediaType('/tmp/lesson.ogv')).resolves.toBe(
      'video/ogg',
    );
    await expect(detectAssetMediaType('/tmp/lesson.mov')).resolves.toBe(
      'video/quicktime',
    );
    await expect(detectAssetMediaType('/tmp/lecture.mp3')).resolves.toBe(
      'audio/mpeg',
    );
    await expect(detectAssetMediaType('/tmp/lecture.WAV')).resolves.toBe(
      'audio/wav',
    );
    await expect(detectAssetMediaType('/tmp/lecture.wave')).resolves.toBe(
      'audio/wav',
    );
    await expect(detectAssetMediaType('/tmp/lecture.m4a')).resolves.toBe(
      'audio/mp4',
    );
    await expect(detectAssetMediaType('/tmp/lecture.aac')).resolves.toBe(
      'audio/aac',
    );
    await expect(detectAssetMediaType('/tmp/lecture.flac')).resolves.toBe(
      'audio/flac',
    );
    await expect(detectAssetMediaType('/tmp/lecture.ogg')).resolves.toBe(
      'audio/ogg',
    );
    await expect(detectAssetMediaType('/tmp/lecture.oga')).resolves.toBe(
      'audio/ogg',
    );
    await expect(detectAssetMediaType('/tmp/lecture.opus')).resolves.toBe(
      'audio/ogg',
    );
    await expect(detectAssetMediaType('/tmp/lecture.weba')).resolves.toBe(
      'audio/webm',
    );
    await expect(detectAssetMediaType('/tmp/diagram.PNG')).resolves.toBe(
      'image/png',
    );
    await expect(detectAssetMediaType('/tmp/photo.jpeg')).resolves.toBe(
      'image/jpeg',
    );
    await expect(detectAssetMediaType('/tmp/photo.JPG')).resolves.toBe(
      'image/jpeg',
    );
    await expect(detectAssetMediaType('/tmp/scan.bmp')).resolves.toBe(
      'image/bmp',
    );
    await expect(detectAssetMediaType('/tmp/chart.webp')).resolves.toBe(
      'image/webp',
    );
    await expect(detectAssetMediaType('/tmp/lesson.doc')).resolves.toBe(
      'application/msword',
    );
    await expect(detectAssetMediaType('/tmp/lesson.DOCX')).resolves.toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    await expect(detectAssetMediaType('/tmp/slides.ppt')).resolves.toBe(
      'application/vnd.ms-powerpoint',
    );
    await expect(detectAssetMediaType('/tmp/slides.PPTX')).resolves.toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
  });

  it('falls back to plain text for UTF-8, GBK and empty files', async () => {
    const directory = await createTemporaryDirectory();
    const utf8Path = join(directory, 'utf8.txt');
    const gbkPath = join(directory, 'gbk.log');
    const emptyPath = join(directory, 'LICENSE');
    await writeFile(utf8Path, '中文 UTF-8 学习笔记');
    await writeFile(
      gbkPath,
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]),
    );
    await writeFile(emptyPath, '');

    await expect(detectAssetMediaType(utf8Path)).resolves.toBe(
      PLAIN_TEXT_ASSET_MEDIA_TYPE,
    );
    await expect(detectAssetMediaType(gbkPath)).resolves.toBe(
      PLAIN_TEXT_ASSET_MEDIA_TYPE,
    );
    await expect(detectAssetMediaType(emptyPath)).resolves.toBe(
      PLAIN_TEXT_ASSET_MEDIA_TYPE,
    );
  });

  it('falls back to octet-stream when content is not supported text', async () => {
    const directory = await createTemporaryDirectory();
    const binaryPath = join(directory, 'renamed.txt');
    await writeFile(binaryPath, Buffer.from([0x00, 0x01, 0xff, 0x80]));

    await expect(detectAssetMediaType(binaryPath)).resolves.toBe(
      UNKNOWN_ASSET_MEDIA_TYPE,
    );
  });

  it('creates names by removing only the final extension', () => {
    expect(createDefaultAssetName('/tmp/attention.v2.pdf')).toBe(
      'attention.v2',
    );
    expect(createDefaultAssetName('/tmp/LICENSE')).toBe('LICENSE');
    expect(createDefaultAssetName('/tmp/.gitignore')).toBe('.gitignore');
  });

  it('checks known Relink media types using the derived MIME', async () => {
    await expect(
      isAssetRelinkMediaCompatible(
        'application/pdf',
        '/old/book.pdf',
        '/new/book.PDF',
      ),
    ).resolves.toBe(true);
    await expect(
      isAssetRelinkMediaCompatible(
        'application/pdf',
        '/old/book.pdf',
        '/new/notes.md',
      ),
    ).resolves.toBe(false);
  });

  it('checks unknown Relink media types using the final extension', async () => {
    await expect(
      isAssetRelinkMediaCompatible(
        UNKNOWN_ASSET_MEDIA_TYPE,
        '/old/report.docx',
        '/new/report.DOCX',
      ),
    ).resolves.toBe(true);
    await expect(
      isAssetRelinkMediaCompatible(
        UNKNOWN_ASSET_MEDIA_TYPE,
        '/old/report.docx',
        '/new/report.xlsx',
      ),
    ).resolves.toBe(false);
    await expect(
      isAssetRelinkMediaCompatible(
        UNKNOWN_ASSET_MEDIA_TYPE,
        '/old/LICENSE',
        '/new/COPYING',
      ),
    ).resolves.toBe(true);
    await expect(
      isAssetRelinkMediaCompatible(
        UNKNOWN_ASSET_MEDIA_TYPE,
        '/old/LICENSE',
        '/new/archive.bin',
      ),
    ).resolves.toBe(false);
  });
});
