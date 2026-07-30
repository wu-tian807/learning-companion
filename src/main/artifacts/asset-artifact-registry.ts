import { AppError } from '../errors/app-error';

export interface AssetArtifactSource {
  readonly assetId: string;
  readonly mediaType: string;
  readonly absolutePath: string;
  readonly revision: string;
}

export interface AssetArtifactProduceRequest {
  readonly source: AssetArtifactSource;
  readonly artifactKey: string;
  readonly workspacePath: string;
  readonly stagingDirectory: string;
}

export interface ProducedAssetArtifact {
  readonly filePath: string;
  readonly mediaType: string;
  readonly extension: string;
}

export interface AssetArtifactProducer {
  readonly id: string;
  readonly version: string;
  produce(
    request: AssetArtifactProduceRequest,
    signal: AbortSignal,
  ): Promise<ProducedAssetArtifact>;
}

export interface AssetArtifactRegistryApi {
  register(producer: AssetArtifactProducer): void;
  get(producerId: string): AssetArtifactProducer | undefined;
  require(producerId: string): AssetArtifactProducer;
}

function validateProducer(producer: AssetArtifactProducer): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(producer.id) ||
    producer.id === '.' ||
    producer.id === '..' ||
    producer.version.trim().length === 0 ||
    typeof producer.produce !== 'function'
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }
}

export class AssetArtifactRegistry
  implements AssetArtifactRegistryApi
{
  private readonly producers = new Map<string, AssetArtifactProducer>();

  register(producer: AssetArtifactProducer): void {
    validateProducer(producer);

    if (this.producers.has(producer.id)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.producers.set(producer.id, producer);
  }

  get(producerId: string): AssetArtifactProducer | undefined {
    return this.producers.get(producerId.trim());
  }

  require(producerId: string): AssetArtifactProducer {
    const producer = this.get(producerId);

    if (!producer) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    return producer;
  }
}
