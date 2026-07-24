import { describe, expect, it } from 'vitest';

import {
  createDefaultAssetName,
  detectAssetMediaType,
  isAssetRelinkMediaCompatible,
  UNKNOWN_ASSET_MEDIA_TYPE,
} from './asset-media-type';

describe('Asset media type', () => {
  it('detects supported MIME values without extension casing', () => {
    expect(detectAssetMediaType('/tmp/notes.MD')).toBe('text/markdown');
    expect(detectAssetMediaType('/tmp/notes.markdown')).toBe('text/markdown');
    expect(detectAssetMediaType('/tmp/paper.PDF')).toBe('application/pdf');
    expect(detectAssetMediaType('/tmp/readme.txt')).toBe('text/plain');
    expect(detectAssetMediaType('/tmp/book.epub')).toBe('application/epub+zip');
  });

  it('falls back for unsupported or extensionless files', () => {
    expect(detectAssetMediaType('/tmp/report.docx')).toBe(
      UNKNOWN_ASSET_MEDIA_TYPE,
    );
    expect(detectAssetMediaType('/tmp/LICENSE')).toBe(UNKNOWN_ASSET_MEDIA_TYPE);
  });

  it('creates names by removing only the final extension', () => {
    expect(createDefaultAssetName('/tmp/attention.v2.pdf')).toBe(
      'attention.v2',
    );
    expect(createDefaultAssetName('/tmp/LICENSE')).toBe('LICENSE');
    expect(createDefaultAssetName('/tmp/.gitignore')).toBe('.gitignore');
  });

  it('checks known Relink media types using the derived MIME', () => {
    expect(
      isAssetRelinkMediaCompatible(
        'application/pdf',
        '/old/book.pdf',
        '/new/book.PDF',
      ),
    ).toBe(true);
    expect(
      isAssetRelinkMediaCompatible(
        'application/pdf',
        '/old/book.pdf',
        '/new/notes.md',
      ),
    ).toBe(false);
  });

  it('checks unknown Relink media types using the final extension', () => {
    expect(
      isAssetRelinkMediaCompatible(
        UNKNOWN_ASSET_MEDIA_TYPE,
        '/old/report.docx',
        '/new/report.DOCX',
      ),
    ).toBe(true);
    expect(
      isAssetRelinkMediaCompatible(
        UNKNOWN_ASSET_MEDIA_TYPE,
        '/old/report.docx',
        '/new/report.xlsx',
      ),
    ).toBe(false);
    expect(
      isAssetRelinkMediaCompatible(
        UNKNOWN_ASSET_MEDIA_TYPE,
        '/old/LICENSE',
        '/new/COPYING',
      ),
    ).toBe(true);
    expect(
      isAssetRelinkMediaCompatible(
        UNKNOWN_ASSET_MEDIA_TYPE,
        '/old/LICENSE',
        '/new/archive.bin',
      ),
    ).toBe(false);
  });
});
