import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import {
  AUDIO_WORKBENCH_ID,
  audioWorkbenchManifest,
} from '../audio/shared';
import {
  EPUB_WORKBENCH_ID,
  epubWorkbenchManifest,
} from '../epub/shared';
import {
  HTML_WORKBENCH_ID,
  htmlWorkbenchManifest,
} from '../html/shared';
import {
  IMAGE_WORKBENCH_ID,
  imageWorkbenchManifest,
} from '../image/shared';
import {
  MARKDOWN_WORKBENCH_ID,
  markdownWorkbenchManifest,
} from '../markdown/shared';
import {
  OFFICE_WORKBENCH_ID,
  officeWorkbenchManifest,
} from '../office/shared';
import {
  PDF_WORKBENCH_ID,
  pdfWorkbenchManifest,
} from '../pdf/shared';
import {
  PLAIN_TEXT_WORKBENCH_ID,
  plainTextWorkbenchManifest,
} from '../plain-text/shared';
import {
  VIDEO_WORKBENCH_ID,
  videoWorkbenchManifest,
} from '../video/shared';

export interface BuiltinWorkbenchCatalogEntry<
  TId extends string = string,
> {
  readonly id: TId;
  readonly manifest: AssetWorkbenchManifest;
}

export const builtinWorkbenchCatalog = [
  {
    id: PLAIN_TEXT_WORKBENCH_ID,
    manifest: plainTextWorkbenchManifest,
  },
  {
    id: MARKDOWN_WORKBENCH_ID,
    manifest: markdownWorkbenchManifest,
  },
  {
    id: PDF_WORKBENCH_ID,
    manifest: pdfWorkbenchManifest,
  },
  {
    id: OFFICE_WORKBENCH_ID,
    manifest: officeWorkbenchManifest,
  },
  {
    id: HTML_WORKBENCH_ID,
    manifest: htmlWorkbenchManifest,
  },
  {
    id: EPUB_WORKBENCH_ID,
    manifest: epubWorkbenchManifest,
  },
  {
    id: IMAGE_WORKBENCH_ID,
    manifest: imageWorkbenchManifest,
  },
  {
    id: AUDIO_WORKBENCH_ID,
    manifest: audioWorkbenchManifest,
  },
  {
    id: VIDEO_WORKBENCH_ID,
    manifest: videoWorkbenchManifest,
  },
] as const satisfies readonly BuiltinWorkbenchCatalogEntry[];

export type BuiltinWorkbenchId =
  (typeof builtinWorkbenchCatalog)[number]['id'];

export const builtinWorkbenchIds: readonly BuiltinWorkbenchId[] =
  Object.freeze(builtinWorkbenchCatalog.map(({ id }) => id));
