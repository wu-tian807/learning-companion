import type {
  ByteRange,
  ContentHandle,
  ResolvedByteContent,
  ResolvedByteStream,
} from '../../../main/content/content-handle';
import { createTextRevision } from '../../../main/content/text-content';
import type { HtmlAgentEditingService } from './html-agent-editing-service';

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

function encodeDraft(content: string): Uint8Array {
  const encoded = new TextEncoder().encode(content);
  const bytes = new Uint8Array(UTF8_BOM.length + encoded.length);
  bytes.set(UTF8_BOM);
  bytes.set(encoded, UTF8_BOM.length);
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

export class HtmlPreviewContentHandle implements ContentHandle {
  readonly capabilities = new Set(['read-bytes', 'read-stream'] as const);

  constructor(
    private readonly editing: Pick<HtmlAgentEditingService, 'getDraft'>,
    private readonly projectId: string,
    private readonly assetId: string,
    private readonly source: ContentHandle,
  ) {}

  async readBytes(): Promise<ResolvedByteContent> {
    const draft = await this.editing.getDraft(this.projectId, this.assetId);
    if (draft === undefined) {
      if (this.source.readBytes) return this.source.readBytes();
      if (!this.source.openByteStream) {
        throw new Error('HTML preview source 不支持读取');
      }
      const resolved = await this.source.openByteStream();
      return {
        content: await readStream(resolved.stream, resolved.byteLength),
        revision: resolved.revision ?? 'html-preview-source',
      };
    }
    const content = encodeDraft(draft);
    return { content, revision: createTextRevision(content) };
  }

  async getByteLength(): Promise<number> {
    const draft = await this.editing.getDraft(this.projectId, this.assetId);
    if (draft !== undefined) return encodeDraft(draft).byteLength;
    if (this.source.getByteLength) return this.source.getByteLength();
    if (!this.source.openByteStream) {
      return (await this.readBytes()).content.byteLength;
    }
    const resolved = await this.source.openByteStream();
    await resolved.stream.cancel();
    return resolved.byteLength;
  }

  async openByteStream(range?: ByteRange): Promise<ResolvedByteStream> {
    const draft = await this.editing.getDraft(this.projectId, this.assetId);
    if (draft === undefined && this.source.openByteStream) {
      return this.source.openByteStream(range);
    }
    const fullContent =
      draft === undefined ? (await this.readBytes()).content : encodeDraft(draft);
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
    // The Workbench session owns the source handle lifecycle.
  }
}
