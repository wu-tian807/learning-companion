import type { ContentCapability } from '../../../../shared/workbench/manifest';
import type { JsonValue } from '../../../../shared/workbench/protocol';
import { AppError } from '../../../errors/app-error';
import type {
  ContentHandle,
  ResolvedTextContent,
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

    return {
      content: JSON.stringify(value),
      encoding: 'utf-8',
    };
  }

  async writeText(content: string): Promise<void> {
    let value: JsonValue;

    try {
      value = JSON.parse(content) as JsonValue;
    } catch (error) {
      throw new AppError('INVALID_IPC_REQUEST', { cause: error });
    }

    await this.repository.set(this.contentId, value);
  }

  async close(): Promise<void> {
    return undefined;
  }
}

export interface ManagedJsonContentResolverDependencies {
  readonly now: () => Date;
}

export class ManagedJsonContentResolver implements ContentResolver {
  readonly kind = MANAGED_JSON_CONTENT_KIND;
  private readonly now: () => Date;

  constructor(
    private readonly repository: ManagedJsonContentRepository,
    dependencies: Partial<ManagedJsonContentResolverDependencies> = {},
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async resolve(ref: Parameters<ContentResolver['resolve']>[0]) {
    if (ref.kind !== MANAGED_JSON_CONTENT_KIND) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    const normalizedRef = createManagedJsonContentRef(ref.contentId);
    const value = await this.repository.get(normalizedRef.contentId);
    const availability = value === undefined ? 'missing' : 'available';

    return {
      ref: normalizedRef,
      status: createAssetContentStatus(availability, this.now()),
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
