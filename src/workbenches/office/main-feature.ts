import { join } from 'node:path';

import {
  LIBREOFFICE_LIBRARY_ID,
  LIBREOFFICE_VERSION,
} from '../../main/external-libraries/definitions/libreoffice';
import type { MainWorkbenchFeatureDefinition } from '../catalog/main-workbench-features';
import { LibreOfficePreviewProducer } from './artifacts/libreoffice-preview-producer';
import {
  isPdfPageAnchorV1,
  isPdfRegionAnchorV1,
  isPdfTextRangeAnchorV1,
} from '../pdf/shared';
import {
  OFFICE_ANCHOR_VERSION,
  OFFICE_PAGE_ANCHOR_TYPE,
  OFFICE_REGION_ANCHOR_TYPE,
  OFFICE_TEXT_RANGE_ANCHOR_TYPE,
} from './shared';

export const officeArtifactMainFeature = Object.freeze({
  id: 'builtin.office.preview-artifact',
  registerAttachmentTypes({ anchors }): void {
    anchors.register({ anchorType: OFFICE_TEXT_RANGE_ANCHOR_TYPE, version: OFFICE_ANCHOR_VERSION, isPayload: isPdfTextRangeAnchorV1 });
    anchors.register({ anchorType: OFFICE_PAGE_ANCHOR_TYPE, version: OFFICE_ANCHOR_VERSION, isPayload: isPdfPageAnchorV1 });
    anchors.register({ anchorType: OFFICE_REGION_ANCHOR_TYPE, version: OFFICE_ANCHOR_VERSION, isPayload: isPdfRegionAnchorV1 });
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
} satisfies MainWorkbenchFeatureDefinition);
