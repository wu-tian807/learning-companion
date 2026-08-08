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
  MIND_MAP_WORKBENCH_ID,
  mindMapWorkbenchManifest,
} from '../mindmap/shared';
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
  readonly manifest: AssetWorkbenchManifest<TId>;
}

function defineBuiltinWorkbench<TId extends string>(
  id: TId,
  manifest: AssetWorkbenchManifest<TId>,
): BuiltinWorkbenchCatalogEntry<TId> {
  return Object.freeze({ id, manifest });
}

export const builtinWorkbenchCatalog = [
  defineBuiltinWorkbench(
    PLAIN_TEXT_WORKBENCH_ID,
    plainTextWorkbenchManifest,
  ),
  defineBuiltinWorkbench(
    MARKDOWN_WORKBENCH_ID,
    markdownWorkbenchManifest,
  ),
  defineBuiltinWorkbench(
    MIND_MAP_WORKBENCH_ID,
    mindMapWorkbenchManifest,
  ),
  defineBuiltinWorkbench(PDF_WORKBENCH_ID, pdfWorkbenchManifest),
  defineBuiltinWorkbench(
    OFFICE_WORKBENCH_ID,
    officeWorkbenchManifest,
  ),
  defineBuiltinWorkbench(HTML_WORKBENCH_ID, htmlWorkbenchManifest),
  defineBuiltinWorkbench(EPUB_WORKBENCH_ID, epubWorkbenchManifest),
  defineBuiltinWorkbench(IMAGE_WORKBENCH_ID, imageWorkbenchManifest),
  defineBuiltinWorkbench(AUDIO_WORKBENCH_ID, audioWorkbenchManifest),
  defineBuiltinWorkbench(VIDEO_WORKBENCH_ID, videoWorkbenchManifest),
] as const;

export type BuiltinWorkbenchId =
  (typeof builtinWorkbenchCatalog)[number]['id'];

export const builtinWorkbenchIds: readonly BuiltinWorkbenchId[] =
  Object.freeze(builtinWorkbenchCatalog.map(({ id }) => id));
