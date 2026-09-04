import { join } from 'node:path';

import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import { LibreOfficePreviewProducer } from './artifacts/libreoffice-preview-producer';
import {
  LIBREOFFICE_LIBRARY_ID,
  LIBREOFFICE_VERSION,
  libreOfficeDefinition,
} from './external-libraries/libreoffice';
import { registerPagedDocumentTargets } from '../document-ai/paged-document-targets';
import {
  OFFICE_ANCHOR_VERSION,
  OFFICE_PAGE_ANCHOR_TYPE,
  OFFICE_REGION_ANCHOR_TYPE,
  OFFICE_TEXT_RANGE_ANCHOR_TYPE,
} from './shared';

export const officeArtifactMainFeature = Object.freeze({
  id: 'builtin.office.preview-artifact',
  registerExternalLibraries({ libraries }): void {
    libraries.register(libreOfficeDefinition);
  },
  registerAssetTargets({ targets }): void {
    registerPagedDocumentTargets(targets, {
      workbenchId: 'builtin.office',
      label: 'Office 文档预览',
      types: {
        textRange: OFFICE_TEXT_RANGE_ANCHOR_TYPE,
        page: OFFICE_PAGE_ANCHOR_TYPE,
        region: OFFICE_REGION_ANCHOR_TYPE,
        version: OFFICE_ANCHOR_VERSION,
      },
    });
  },
  registerArtifactProducers({
    artifacts,
    externalLibraries,
    externalLibraryProfilesDirectory,
  }): void {
    artifacts.register(
      new LibreOfficePreviewProducer(
        externalLibraries,
        join(
          externalLibraryProfilesDirectory,
          LIBREOFFICE_LIBRARY_ID,
          LIBREOFFICE_VERSION,
        ),
      ),
    );
  },
} satisfies MainWorkbenchFeatureContribution);
