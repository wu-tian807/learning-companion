import { createHash } from 'node:crypto';

import type { ContentCapability } from '../../../../shared/workbench/manifest';
import type { JsonValue } from '../../../../shared/workbench/protocol';
import { AppError } from '../../../errors/app-error';
import type {
  ContentHandle,
  ResolvedTextContent,
  WriteTextContentRequest,
  WriteTextContentResult,
} from '../../content-handle';
import {
  createAssetContentStatus,
  createManagedJsonContentRef,
  MANAGED_JSON_CONTENT_KIND,
} from '../../content-ref';
import type { ContentResolver } from '../../content-resolver-registry';
import type { ManagedJsonContentRepository } from './managed-json-content-repository';

const managedJsonCapabilities = new Set<ContentCapability>([
  'read-text',
  'write-text',
]);

class ManagedJsonContentHandle implements ContentHandle {
  readonly capabilities: ReadonlySet<ContentCapability> =
    managedJsonCapabilities;

  constructor(
    private readonly contentId: string,
    private readonly repository: ManagedJsonContentRepository,
  ) {}

  async readText(): Promise<ResolvedTextContent> {
    const value = await this.repository.get(this.contentId);

    if (value === undefined) {
      throw new AppError('ASSET_UNAVAILABLE');
    }

    const content = JSON.stringify(value);

    return {
      content,
      encoding: 'utf-8',
      lineEnding: 'lf',
      hasByteOrderMark: false,
      revision: createHash('sha256').update(content).digest('hex'),
    };
  }

  async writeText(
    request: WriteTextContentRequest,
  ): Promise<WriteTextContentResult> {
    const current = await this.readText();

    if (current.revision !== request.expectedRevision) {
      throw new AppError('CONTENT_CHANGED_EXTERNALLY');
    }

    let value: JsonValue;

    try {
      value = JSON.parse(request.content) as JsonValue;
    } catch (error) {
      throw new AppError('INVALID_IPC_REQUEST', { cause: error });
    }

    await this.repository.set(this.contentId, value);
    return {
      revision: createHash('sha256')
        .update(request.content)
        .digest('hex'),
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
