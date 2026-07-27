import type { ContentCapability } from '../../../../shared/workbench/manifest';
import {
  DefaultLocalFileContentInspector,
  type LocalFileContentInspector,
} from './local-file-content-inspector';
import { AppError } from '../../../errors/app-error';
import type { ContentHandle } from '../../content-handle';
import {
  LOCAL_FILE_CONTENT_KIND,
} from '../../content-ref';
import type { ContentResolver } from '../../content-resolver-registry';

const noContentCapabilities = new Set<ContentCapability>();

export class LocalFileContentHandle implements ContentHandle {
  readonly capabilities: ReadonlySet<ContentCapability> =
    noContentCapabilities;

  constructor(readonly path: string) {}

  async close(): Promise<void> {
    return undefined;
  }
}

export class LocalFileContentResolver implements ContentResolver {
  readonly kind = LOCAL_FILE_CONTENT_KIND;

  constructor(
    private readonly inspector: LocalFileContentInspector =
      new DefaultLocalFileContentInspector(),
  ) {}

  async resolve(ref: Parameters<ContentResolver['resolve']>[0]) {
    if (ref.kind !== LOCAL_FILE_CONTENT_KIND) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    const inspection = await this.inspector.inspect(ref.path);

    return {
      contentRef: inspection.contentRef,
      contentStatus: inspection.contentStatus,
      handle:
        inspection.contentStatus.availability === 'available'
          ? new LocalFileContentHandle(inspection.contentRef.path)
          : undefined,
    };
  }
}
