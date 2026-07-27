import { AppError } from '../errors/app-error';
import type {
  AssetContentKind,
  AssetContentRef,
  ResolvedAssetContent,
} from './content-ref';

export interface ContentResolver {
  readonly kind: AssetContentKind;
  resolve(ref: AssetContentRef): Promise<ResolvedAssetContent>;
}

export class ContentResolverRegistry {
  private readonly resolvers = new Map<AssetContentKind, ContentResolver>();

  register(resolver: ContentResolver): void {
    if (this.resolvers.has(resolver.kind)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.resolvers.set(resolver.kind, resolver);
  }

  has(kind: AssetContentKind): boolean {
    return this.resolvers.has(kind);
  }

  async resolve(ref: AssetContentRef): Promise<ResolvedAssetContent> {
    const resolver = this.resolvers.get(ref.kind);

    if (!resolver) {
      throw new AppError('CONTENT_RESOLVER_NOT_FOUND');
    }

    return resolver.resolve(ref);
  }
}
