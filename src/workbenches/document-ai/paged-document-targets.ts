import type { AssetTargetRegistryApi } from '../../main/workbench/asset-target-registry';
import {
  isPdfPageAnchorV1,
  isPdfRegionAnchorV1,
  isPdfTextRangeAnchorV1,
} from '../pdf/shared';

export interface PagedDocumentTargetTypes {
  readonly textRange: string;
  readonly page: string;
  readonly region: string;
  readonly version: number;
}

export function registerPagedDocumentTargets(
  targets: AssetTargetRegistryApi,
  input: {
    readonly workbenchId: string;
    readonly label: string;
    readonly types: PagedDocumentTargetTypes;
  },
): void {
  targets.register({
    workbenchId: input.workbenchId,
    targetType: input.types.textRange,
    version: input.types.version,
    isPayload: isPdfTextRangeAnchorV1,
    agent: {
      description: `${input.label}中带页内字符位置、原文和文档指纹的精确文本范围；无法取得指纹时应改用页 Target`,
      payloadSchema: {
        type: 'object',
        required: ['documentIdentity', 'start', 'end', 'quote'],
        properties: {
          documentIdentity: {
            type: 'object',
            required: ['fingerprint'],
            properties: { fingerprint: { type: 'string' } },
          },
          start: {
            type: 'object',
            required: ['pageNumber', 'offset'],
            properties: {
              pageNumber: { type: 'integer', minimum: 1 },
              offset: { type: 'integer', minimum: 0 },
            },
          },
          end: {
            type: 'object',
            required: ['pageNumber', 'offset'],
            properties: {
              pageNumber: { type: 'integer', minimum: 1 },
              offset: { type: 'integer', minimum: 0 },
            },
          },
          quote: {
            type: 'object',
            required: ['exact', 'prefix', 'suffix'],
            properties: {
              exact: { type: 'string', minLength: 1 },
              prefix: { type: 'string' },
              suffix: { type: 'string' },
            },
          },
        },
      },
      examplePayloads: [{
        documentIdentity: { fingerprint: 'document-fingerprint' },
        start: { pageNumber: 1, offset: 0 },
        end: { pageNumber: 1, offset: 4 },
        quote: { exact: '示例原文', prefix: '', suffix: '' },
      }],
    },
    describe(payload): string {
      const value = payload as {
        readonly start: { readonly pageNumber: number };
        readonly quote: { readonly exact: string };
      };
      return `第 ${value.start.pageNumber} 页“${value.quote.exact}”`;
    },
  });
  targets.register({
    workbenchId: input.workbenchId,
    targetType: input.types.page,
    version: input.types.version,
    isPayload: isPdfPageAnchorV1,
    agent: {
      description: `${input.label}的指定页`,
      payloadSchema: {
        type: 'object',
        required: ['pageNumber'],
        properties: { pageNumber: { type: 'integer', minimum: 1 } },
      },
      examplePayloads: [{ pageNumber: 1 }],
    },
    describe(payload): string {
      return `第 ${(payload as { readonly pageNumber: number }).pageNumber} 页`;
    },
  });
  targets.register({
    workbenchId: input.workbenchId,
    targetType: input.types.region,
    version: input.types.version,
    isPayload: isPdfRegionAnchorV1,
    agent: {
      description: `${input.label}指定页上的归一化矩形区域`,
      payloadSchema: {
        type: 'object',
        required: ['pageNumber', 'x', 'y', 'width', 'height'],
        properties: {
          pageNumber: { type: 'integer', minimum: 1 },
          x: { type: 'number', minimum: 0, maximum: 1 },
          y: { type: 'number', minimum: 0, maximum: 1 },
          width: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
          height: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        },
      },
      examplePayloads: [
        { pageNumber: 1, x: 0, y: 0, width: 1, height: 0.5 },
      ],
    },
    describe(payload): string {
      return `第 ${(payload as { readonly pageNumber: number }).pageNumber} 页区域`;
    },
  });
}
