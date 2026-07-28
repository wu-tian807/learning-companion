import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../errors/app-error';
import type { ContentHandle } from './content-handle';
import { ContentResourceService } from './content-resource-service';

function createStreamHandle(
  content = '图片内容',
  onCancel?: () => void,
): ContentHandle {
  const bytes = new TextEncoder().encode(content);

  return {
    capabilities: new Set(['read-stream']),
    openByteStream: vi.fn(async () => ({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
        cancel() {
          onCancel?.();
        },
      }),
      byteLength: bytes.byteLength,
    })),
    close: vi.fn(async () => undefined),
  };
}

function createService(
  token = 'fixed-token',
  logger = { error: vi.fn() },
) {
  return {
    logger,
    service: new ContentResourceService({
      createToken: () => token,
      logger,
    }),
  };
}

describe('ContentResourceService', () => {
  it('registers an opaque URL without exposing the local path', () => {
    const { service } = createService();
    const handle = createStreamHandle();

    const url = service.register(
      'session-1',
      Object.assign(handle, { path: '/Users/test/private/image.png' }),
      'image/png',
    );

    expect(url).toBe('learning-content://resource/fixed-token');
    expect(url).not.toContain('/Users/test/private');
  });

  it('serves GET with the stream metadata and security headers', async () => {
    const { service } = createService();
    const url = service.register(
      'session-1',
      createStreamHandle('binary-image'),
      'image/png',
    );

    const response = await service.handle(new Request(url));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Length')).toBe('12');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe(
      'nosniff',
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    await expect(response.text()).resolves.toBe('binary-image');
  });

  it('serves HEAD metadata without a body', async () => {
    const cancel = vi.fn();
    const { service } = createService();
    const url = service.register(
      'session-1',
      createStreamHandle('metadata', cancel),
      'image/jpeg',
    );

    const response = await service.handle(
      new Request(url, { method: 'HEAD' }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Content-Length')).toBe('8');
    expect(response.body).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects unsupported methods and unknown tokens', async () => {
    const { service } = createService();
    const url = service.register(
      'session-1',
      createStreamHandle(),
      'image/png',
    );

    const unsupported = await service.handle(
      new Request(url, { method: 'POST' }),
    );
    const unknown = await service.handle(
      new Request('learning-content://resource/unknown-token'),
    );

    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get('Allow')).toBe('GET, HEAD');
    expect(unknown.status).toBe(404);
  });

  it('revokes every token belonging to a session', async () => {
    let tokenIndex = 0;
    const service = new ContentResourceService({
      createToken: () => `token-${tokenIndex += 1}`,
      logger: { error: vi.fn() },
    });
    const first = service.register(
      'session-1',
      createStreamHandle(),
      'image/png',
    );
    const second = service.register(
      'session-1',
      createStreamHandle(),
      'image/jpeg',
    );
    const other = service.register(
      'session-2',
      createStreamHandle(),
      'image/webp',
    );

    service.revokeSession('session-1');

    await expect(
      service.handle(new Request(first)),
    ).resolves.toHaveProperty('status', 404);
    await expect(
      service.handle(new Request(second)),
    ).resolves.toHaveProperty('status', 404);
    await expect(
      service.handle(new Request(other)),
    ).resolves.toHaveProperty('status', 200);
  });

  it('aborts an active response stream when its session is revoked', async () => {
    const cancel = vi.fn();
    const { service } = createService();
    const handle: ContentHandle = {
      capabilities: new Set(['read-stream']),
      openByteStream: async () => ({
        stream: new ReadableStream<Uint8Array>({
          cancel,
        }),
        byteLength: 100,
      }),
      close: vi.fn(async () => undefined),
    };
    const url = service.register('session-1', handle, 'image/bmp');
    const response = await service.handle(new Request(url));

    service.revokeSession('session-1');
    await Promise.resolve();

    expect(response.body).not.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    await expect(
      service.handle(new Request(url)),
    ).resolves.toHaveProperty('status', 404);
  });

  it('maps unavailable content to a minimal Gone response', async () => {
    const { logger, service } = createService();
    const handle: ContentHandle = {
      capabilities: new Set(['read-stream']),
      openByteStream: async () => {
        throw new AppError('ASSET_UNAVAILABLE');
      },
      close: vi.fn(async () => undefined),
    };
    const url = service.register('session-1', handle, 'image/png');

    const response = await service.handle(new Request(url));

    expect(response.status).toBe(410);
    await expect(response.text()).resolves.toBe('Content Unavailable');
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('returns Conflict when a Handle claims but does not implement streaming', async () => {
    const { logger, service } = createService();
    const handle: ContentHandle = {
      capabilities: new Set(['read-stream']),
      close: vi.fn(async () => undefined),
    };
    const url = service.register('session-1', handle, 'image/png');

    await expect(
      service.handle(new Request(url)),
    ).resolves.toHaveProperty('status', 409);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('rejects registrations that do not own stream capability', () => {
    const { service } = createService();
    const handle: ContentHandle = {
      capabilities: new Set(['read-bytes']),
      close: vi.fn(async () => undefined),
    };

    expect(() =>
      service.register('session-1', handle, 'image/png'),
    ).toThrow('DATA_INTEGRITY_ERROR');
  });
});
