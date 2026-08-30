import type {
  ByteRange,
  ContentHandle,
  ResolvedByteContent,
  ResolvedByteStream,
} from '../../../main/content/content-handle';
import { createTextRevision } from '../../../main/content/text-content';
import type { HtmlAgentEditingService } from './html-agent-editing-service';

const UTF8_BYTE_ORDER_MARK = new Uint8Array([0xef, 0xbb, 0xbf]);

function encodeDraft(content: string): Uint8Array {
  const encoded = new TextEncoder().encode(content);
  const bytes = new Uint8Array(UTF8_BYTE_ORDER_MARK.length + encoded.length);
  bytes.set(UTF8_BYTE_ORDER_MARK);
  bytes.set(encoded, UTF8_BYTE_ORDER_MARK.length);
  return bytes;
}

function sliceRange(content: Uint8Array, range?: ByteRange): Uint8Array {
  if (!range) return content;
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.endExclusive) ||
    range.start < 0 ||
    range.endExclusive < range.start ||
    range.endExclusive > content.byteLength
  ) {
    throw new RangeError('HTML preview byte range 无效');
  }
  return content.slice(range.start, range.endExclusive);
}

export class HtmlPreviewContentHandle implements ContentHandle {
  readonly capabilities = new Set(['read-bytes', 'read-stream'] as const);

  constructor(
    private readonly editing: HtmlAgentEditingService,
    private readonly projectId: string,
    private readonly assetId: string,
    private readonly fallback: ContentHandle,
  ) {}

  async readBytes(): Promise<ResolvedByteContent> {
    const draft = await this.editing.getDraft(this.projectId, this.assetId);
    if (draft === undefined) {
      if (this.fallback.readBytes) {
        return this.fallback.readBytes();
      }
      if (!this.fallback.openByteStream) {
        throw new Error('HTML preview source 不支持读取');
      }
      const resolved = await this.fallback.openByteStream();
      return {
        content: await readStream(resolved.stream, resolved.byteLength),
        revision: resolved.revision ?? 'html-preview-source',
      };
    }
    const content = encodeDraft(draft);
    return {
      content,
      revision: createTextRevision(content),
    };
  }

  async getByteLength(): Promise<number> {
    const draft = await this.editing.getDraft(this.projectId, this.assetId);
    if (draft !== undefined) return encodeDraft(draft).byteLength;
    if (this.fallback.getByteLength) return this.fallback.getByteLength();
    if (!this.fallback.openByteStream) {
      throw new Error('HTML preview source 不支持读取');
    }
    const resolved = await this.fallback.openByteStream();
    await resolved.stream.cancel();
    return resolved.byteLength;
  }

  async openByteStream(range?: ByteRange): Promise<ResolvedByteStream> {
    const draft = await this.editing.getDraft(this.projectId, this.assetId);
    if (draft === undefined && this.fallback.openByteStream) {
      return this.fallback.openByteStream(range);
    }
    const fullContent = draft === undefined
      ? (await this.readBytes()).content
      : encodeDraft(draft);
    const content = sliceRange(fullContent, range);
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(content);
          controller.close();
        },
      }),
      byteLength: content.byteLength,
      revision: createTextRevision(fullContent),
    };
  }

  async close(): Promise<void> {
    // The Workbench session owns and closes the source handle.
  }
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  expectedLength: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      length += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (length !== expectedLength) {
    throw new Error('HTML preview source 长度不一致');
  }
  const content = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return content;
}
