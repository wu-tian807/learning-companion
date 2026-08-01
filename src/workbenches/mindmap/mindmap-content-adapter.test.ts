import { describe, expect, it, vi } from 'vitest';

import type { ContentHandle } from '../../main/content/content-handle';
import { createContentRevision } from '../../main/content/content-revision';
import {
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
  type MindMapDocumentV1,
} from './document';
import {
  decodeMindMapDocument,
  DefaultMindMapContentAdapter,
  encodeMindMapDocument,
} from './mindmap-content-adapter';

function createDocument(
  title = ' Map ',
): MindMapDocumentV1 {
  return {
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION,
    title,
    rootNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        title: 'Root',
        focus: 'Root topic',
        childIds: ['child'],
      },
      child: {
        id: 'child',
        title: 'Child',
        focus: 'Child topic',
        childIds: [],
      },
    },
    frames: {
      chapter: {
        id: 'chapter',
        title: 'Chapter',
        nodeIds: ['root', 'child'],
      },
    },
    associations: {
      nodes: {},
      frames: {},
    },
  };
}

describe('MindMapContentAdapter', () => {
  it('decodes UTF-8 JSON with BOM and encodes normalized JSON', () => {
    const source = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify(createDocument())),
    ]);

    const decoded = decodeMindMapDocument(source);
    const encoded = encodeMindMapDocument(decoded);
    const serialized = new TextDecoder().decode(encoded);

    expect(decoded.title).toBe('Map');
    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized.startsWith('\uFEFF')).toBe(false);
    expect(JSON.parse(serialized)).toEqual(decoded);
  });

  it('adapts a generic byte Handle without owning its lifecycle', async () => {
    let bytes = Buffer.from(JSON.stringify(createDocument('Original')));
    let revision = createContentRevision(bytes);
    const close = vi.fn(async () => undefined);
    const handle: ContentHandle = {
      capabilities: new Set(['read-bytes', 'write-bytes']),
      readBytes: async () => ({ content: bytes, revision }),
      writeBytes: async (request) => {
        expect(request.expectedRevision).toBe(revision);
        bytes = Buffer.from(request.content);
        revision = createContentRevision(bytes);
        return { revision };
      },
      close,
    };
    const adapter = new DefaultMindMapContentAdapter();

    const resolved = await adapter.read(handle);
    const saved = await adapter.write(handle, {
      document: { ...resolved.document, title: 'Updated' },
      expectedRevision: resolved.revision,
    });

    expect(saved.revision).toBe(revision);
    expect(decodeMindMapDocument(bytes).title).toBe('Updated');
    expect(close).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON, invalid documents and non-UTF-8 bytes', () => {
    expect(() => decodeMindMapDocument(Buffer.from('{'))).toThrow(
      'DATA_INTEGRITY_ERROR',
    );
    expect(() => decodeMindMapDocument(Buffer.from('{}'))).toThrow(
      'DATA_INTEGRITY_ERROR',
    );
    expect(() =>
      decodeMindMapDocument(Uint8Array.from([0xc3, 0x28])),
    ).toThrow('CONTENT_ENCODING_UNSUPPORTED');
  });

  it('requires the matching generic Handle capabilities', async () => {
    const adapter = new DefaultMindMapContentAdapter();
    const readOnlyHandle: ContentHandle = {
      capabilities: new Set(['read-bytes']),
      readBytes: async () => {
        const content = encodeMindMapDocument(createDocument());
        return {
          content,
          revision: createContentRevision(content),
        };
      },
      close: async () => undefined,
    };
    const writeOnlyHandle: ContentHandle = {
      capabilities: new Set(['write-bytes']),
      writeBytes: async () => ({ revision: 'next' }),
      close: async () => undefined,
    };

    await expect(
      adapter.write(readOnlyHandle, {
        document: createDocument(),
        expectedRevision: 'revision',
      }),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    await expect(adapter.read(writeOnlyHandle)).rejects.toThrow(
      'DATA_INTEGRITY_ERROR',
    );
    await expect(
      adapter.write(writeOnlyHandle, {
        document: createDocument(),
        expectedRevision: '  ',
      }),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
  });
});
