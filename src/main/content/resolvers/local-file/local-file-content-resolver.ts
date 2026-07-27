import type { ContentCapability } from '../../../../shared/workbench/manifest';
import {
  DefaultLocalFileLocatorChecker,
  type LocalFileLocatorChecker,
} from '../../../assets/asset-content-locator';
import { AppError } from '../../../errors/app-error';
import type { ContentHandle } from '../../content-handle';
import {
  createAssetContentStatus,
  createLocalFileContentRef,
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
    private readonly checker: LocalFileLocatorChecker =
      new DefaultLocalFileLocatorChecker(),
  ) {}

  async resolve(ref: Parameters<ContentResolver['resolve']>[0]) {
    if (ref.kind !== LOCAL_FILE_CONTENT_KIND) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    const locator = await this.checker.check(ref.path);
    const normalizedRef = createLocalFileContentRef(locator.path);
    const status = createAssetContentStatus(
      locator.availability,
      locator.checkedTime,
    );

    return {
      ref: normalizedRef,
      status,
      handle:
        status.availability === 'available'
          ? new LocalFileContentHandle(normalizedRef.path)
          : undefined,
    };
  }
}
