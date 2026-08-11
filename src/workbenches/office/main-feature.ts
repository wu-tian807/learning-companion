import { join } from 'node:path';

import {
  LIBREOFFICE_LIBRARY_ID,
  LIBREOFFICE_VERSION,
} from '../../main/external-libraries/definitions/libreoffice';
import type { MainWorkbenchFeatureDefinition } from '../catalog/main-workbench-features';
import { LibreOfficePreviewProducer } from './artifacts/libreoffice-preview-producer';

export const officeArtifactMainFeature = Object.freeze({
  id: 'builtin.office.preview-artifact',
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
