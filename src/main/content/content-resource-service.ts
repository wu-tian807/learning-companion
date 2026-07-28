import { randomUUID } from 'node:crypto';

import { AppError } from '../errors/app-error';
import type { ContentHandle } from './content-handle';

export const CONTENT_RESOURCE_SCHEME = 'learning-content';
export const CONTENT_RESOURCE_HOST = 'resource';

interface ContentResourceRegistration {
  readonly token: string;
  readonly sessionId: string;
  readonly handle: ContentHandle;
  readonly mediaType: string;
  readonly abortController: AbortController;
}

export interface ContentResourceServiceDependencies {
  readonly createToken: () => string;
  readonly logger: Pick<Console, 'error'>;
}

export interface ContentResourceServiceApi {
  register(
    sessionId: string,
    handle: ContentHandle,
    mediaType: string,
  ): string;
  revokeSession(sessionId: string): void;
  handle(request: Request): Promise<Response>;
  dispose(): void;
}

function createResponseHeaders(
  mediaType?: string,
  byteLength?: number,
): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });

  if (mediaType) {
    headers.set('Content-Type', mediaType);
  }
  if (byteLength !== undefined) {
    headers.set('Content-Length', String(byteLength));
  }

  return headers;
}

function createErrorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: createResponseHeaders('text/plain; charset=utf-8'),
  });
}

function createAbortableStream(
  source: ReadableStream<Uint8Array>,
  signals: readonly AbortSignal[],
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let finished = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  const removeAbortListeners = () => {
    for (const signal of signals) {
      signal.removeEventListener('abort', abort);
    }
  };
  const finish = () => {
    if (finished) {
      return false;
    }
    finished = true;
    removeAbortListeners();
    return true;
  };
  const abort = () => {
    if (!finish()) {
      return;
    }

    void reader.cancel('Content resource revoked');
    controller?.error(new DOMException('Content resource revoked', 'AbortError'));
  };

  return new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;

      for (const signal of signals) {
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener('abort', abort, { once: true });
      }

      const pump = async () => {
        try {
          while (!finished) {
            const result = await reader.read();

            if (finished) {
              return;
            }
            if (result.done) {
              finish();
              streamController.close();
              return;
            }

            streamController.enqueue(result.value);
          }
        } catch (error) {
          if (finish()) {
            streamController.error(error);
          }
        }
      };

      void pump();
    },
    async cancel(reason) {
      if (finish()) {
        await reader.cancel(reason);
      }
    },
  });
}

function isValidMediaType(mediaType: string): boolean {
  return /^[^\s/]+\/[^\s/]+$/.test(mediaType);
}

function parseToken(requestUrl: string): string | undefined {
  let url: URL;

  try {
    url = new URL(requestUrl);
  } catch {
    return undefined;
  }

  if (
    url.protocol !== `${CONTENT_RESOURCE_SCHEME}:` ||
    url.hostname !== CONTENT_RESOURCE_HOST ||
    url.search ||
    url.hash
  ) {
    return undefined;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length === 1 ? segments[0] : undefined;
}

export class ContentResourceService
  implements ContentResourceServiceApi
{
  private readonly registrations = new Map<
    string,
    ContentResourceRegistration
  >();
  private readonly createToken: () => string;
  private readonly logger: Pick<Console, 'error'>;

  constructor(
    dependencies: Partial<ContentResourceServiceDependencies> = {},
  ) {
    this.createToken = dependencies.createToken ?? randomUUID;
    this.logger = dependencies.logger ?? console;
  }

  register(
    sessionId: string,
    handle: ContentHandle,
    mediaType: string,
  ): string {
    if (
      !sessionId.trim() ||
      !isValidMediaType(mediaType) ||
      !handle.capabilities.has('read-stream')
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const token = this.createToken();

    if (!token.trim() || this.registrations.has(token)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.registrations.set(token, {
      token,
      sessionId,
      handle,
      mediaType,
      abortController: new AbortController(),
    });

    return `${CONTENT_RESOURCE_SCHEME}://${CONTENT_RESOURCE_HOST}/${encodeURIComponent(token)}`;
  }

  revokeSession(sessionId: string): void {
    for (const [token, registration] of this.registrations) {
      if (registration.sessionId !== sessionId) {
        continue;
      }

      registration.abortController.abort();
      this.registrations.delete(token);
    }
  }

  async handle(request: Request): Promise<Response> {
    const token = parseToken(request.url);
    const registration = token
      ? this.registrations.get(token)
      : undefined;

    if (!registration) {
      return createErrorResponse(404, 'Not Found');
    }

    const method = request.method.toUpperCase();

    if (method !== 'GET' && method !== 'HEAD') {
      const response = createErrorResponse(405, 'Method Not Allowed');
      response.headers.set('Allow', 'GET, HEAD');
      return response;
    }

    if (!registration.handle.openByteStream) {
      this.logger.error(
        '[content-resource] Handle 缺少 read-stream 实现',
        new AppError('DATA_INTEGRITY_ERROR'),
      );
      return createErrorResponse(409, 'Content Unavailable');
    }

    try {
      const resolved = await registration.handle.openByteStream();
      const headers = createResponseHeaders(
        registration.mediaType,
        resolved.byteLength,
      );

      if (method === 'HEAD') {
        await resolved.stream.cancel();
        return new Response(null, { status: 200, headers });
      }

      const stream = createAbortableStream(resolved.stream, [
        registration.abortController.signal,
        request.signal,
      ]);
      return new Response(stream, { status: 200, headers });
    } catch (error) {
      this.logger.error('[content-resource] 内容流打开失败', error);
      return createErrorResponse(
        error instanceof AppError && error.code === 'ASSET_UNAVAILABLE'
          ? 410
          : 500,
        'Content Unavailable',
      );
    }
  }

  dispose(): void {
    for (const registration of this.registrations.values()) {
      registration.abortController.abort();
    }
    this.registrations.clear();
  }
}
