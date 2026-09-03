import { describe, expect, it } from 'vitest';

import { AssetTargetRegistry } from '../../workbench/asset-target-registry';
import { createTextAgentUserMessage } from '../contracts/agent-message';
import { appendAssetTargetCatalogToUserMessage } from './generation-asset-target-catalog';

describe('generation AssetTarget catalog', () => {
  it('projects selected source mappings, each Workbench definition once, and the whole Asset fallback', () => {
    const targets = new AssetTargetRegistry();
    targets.register({
      workbenchId: 'builtin.pdf',
      targetType: 'pdf.page',
      version: 1,
      isPayload(value) {
        if (
          typeof value !== 'object' ||
          value === null ||
          Array.isArray(value)
        ) return false;
        return Number.isSafeInteger(
          (value as Record<string, unknown>).pageNumber,
        );
      },
      describe: (value) =>
        `第 ${(value as { readonly pageNumber: number }).pageNumber} 页`,
      agent: {
        description: 'PDF 指定页',
        payloadSchema: { type: 'object', required: ['pageNumber'] },
        examplePayloads: [{ pageNumber: 1 }],
      },
    });
    targets.register({
      workbenchId: 'builtin.video',
      targetType: 'video.time-range',
      version: 1,
      isPayload: () => true,
      describe: () => '时间范围',
      agent: {
        description: '视频时间范围',
        payloadSchema: { type: 'object' },
        examplePayloads: [{}],
      },
    });

    const message = appendAssetTargetCatalogToUserMessage(
      createTextAgentUserMessage('生成'),
      {
        sources: [
          {
            alias: 'sources-0001',
            assetId: 'asset-pdf-1',
            name: 'lesson-1.pdf',
            mediaType: 'application/pdf',
            workbenchId: 'builtin.pdf',
            contentRevision: 'revision-1',
            relativePath: 'references/sources-0001/source.pdf',
          },
          {
            alias: 'sources-0002',
            assetId: 'asset-pdf-2',
            name: 'lesson-2.pdf',
            mediaType: 'application/pdf',
            workbenchId: 'builtin.pdf',
            contentRevision: 'revision-2',
            relativePath: 'references/sources-0002/source.pdf',
          },
        ],
      },
      targets,
    );
    const text = message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');

    expect(text).toContain('"scope": "asset"');
    expect(text).toContain('pdf.page');
    expect(text).not.toContain('video.time-range');
    expect(text.match(/"targetType": "pdf\.page"/gu)).toHaveLength(1);
  });
});
