import type { ContentCapability } from '../../../../shared/workbench/manifest';
import type { JsonValue } from '../../../../shared/workbench/protocol';
import { AppError } from '../../../errors/app-error';
import type {
  ContentHandle,
  ResolvedByteContent,
  WriteByteContentRequest,
  WriteByteContentResult,
} from '../../content-handle';
import { createContentRevision } from '../../content-revision';
import {
  createAssetContentStatus,
  createManagedJsonContentRef,
  MANAGED_JSON_CONTENT_KIND,
} from '../../content-ref';
import type { ContentResolver } from '../../content-resolver-registry';
import type { ManagedJsonContentRepository } from './managed-json-content-repository';

const managedJsonCapabilities = new Set<ContentCapability>([
  'read-bytes',
  'write-bytes',
]);

class ManagedJsonContentHandle implements ContentHandle {
  readonly capabilities: ReadonlySet<ContentCapability> =
    managedJsonCapabilities;

  constructor(
    private readonly contentId: string,
    private readonly repository: ManagedJsonContentRepository,
  ) {}

  async readBytes(): Promise<ResolvedByteContent> {
    const value = await this.repository.get(this.contentId);

    if (value === undefined) {
      throw new AppError('ASSET_UNAVAILABLE');
    }

    const content = JSON.stringify(value);
    const bytes = new TextEncoder().encode(content);

    return {
      content: bytes,
      revision: createContentRevision(bytes),
    };
  }

  async writeBytes(
    request: WriteByteContentRequest,
  ): Promise<WriteByteContentResult> {
    const current = await this.readBytes();

    if (current.revision !== request.expectedRevision) {
      throw new AppError('CONTENT_CHANGED_EXTERNALLY');
    }

    let value: JsonValue;
    let content: string;

    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(
        request.content,
      );
      value = JSON.parse(content) as JsonValue;
    } catch (error) {
      throw new AppError('INVALID_IPC_REQUEST', { cause: error });
    }

    await this.repository.set(this.contentId, value);
    return {
      revision: createContentRevision(request.content),
    };
  }

  async close(): Promise<void> {
    return undefined;
  }
}

export interface ManagedJsonContentResolverDependencies {
  readonly now: () => number;
}

export class ManagedJsonContentResolver implements ContentResolver {
  readonly kind = MANAGED_JSON_CONTENT_KIND;
  private readonly now: () => number;

  constructor(
    private readonly repository: ManagedJsonContentRepository,
    dependencies: Partial<ManagedJsonContentResolverDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async resolve(ref: Parameters<ContentResolver['resolve']>[0]) {
    if (ref.kind !== MANAGED_JSON_CONTENT_KIND) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    const normalizedRef = createManagedJsonContentRef(ref.contentId);
    const value = await this.repository.get(normalizedRef.contentId);
    const availability = value === undefined ? 'missing' : 'available';

    return {
      contentRef: normalizedRef,
      contentStatus: createAssetContentStatus(availability, this.now()),
      handle:
        availability === 'available'
          ? new ManagedJsonContentHandle(
              normalizedRef.contentId,
              this.repository,
            )
          : undefined,
    };
  }
}
