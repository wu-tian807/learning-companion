import { describe, expect, it } from 'vitest';

import { AssetTargetRegistry } from './asset-target-registry';

function pageDefinition(workbenchId = 'builtin.pdf') {
  return {
    workbenchId,
    targetType: 'pdf.page',
    version: 1,
    isPayload: (value: unknown) =>
      typeof value === 'object' &&
      value !== null &&
      Number.isSafeInteger((value as { pageNumber?: unknown }).pageNumber),
    agent: {
      description: 'PDF page',
      payloadSchema: { type: 'object' },
      examplePayloads: [{ pageNumber: 1 }],
    },
    describe: (value: unknown) =>
      `page ${(value as { pageNumber: number }).pageNumber}`,
  };
}

describe('AssetTargetRegistry', () => {
  it('keeps validation, Agent guidance, ownership and descriptions together', () => {
    const targets = new AssetTargetRegistry();
    targets.register(pageDefinition());

    const target = {
      scope: 'content' as const,
      targetType: 'pdf.page',
      targetVersion: 1,
      targetPayload: { pageNumber: 3 },
    };
    expect(targets.validate('builtin.pdf', target)).toBe(true);
    expect(targets.validate('builtin.office', target)).toBe(false);
    expect(targets.describe('builtin.pdf', target)).toContain('page 3');
    expect(targets.listForWorkbench('builtin.pdf')).toHaveLength(1);
  });

  it('requires complete Agent metadata and exact manifest alignment', () => {
    const targets = new AssetTargetRegistry();
    targets.register(pageDefinition());

    expect(() => targets.register(pageDefinition('builtin.other'))).toThrow(
      'REGISTRATION_CONFLICT',
    );
    expect(() => targets.register({
      ...pageDefinition('builtin.invalid'),
      agent: undefined,
    } as never)).toThrow('INVALID_EXTENSION_DEFINITION');
    expect(() => targets.assertManifest({
      id: 'builtin.pdf',
      version: 1,
      protocolVersion: 2,
      supportedMediaTypes: ['application/pdf'],
      requiredContentCapabilities: ['read-bytes'],
      supportedTargetTypes: ['pdf.page'],
      facilities: [],
    })).not.toThrow();
    expect(() => targets.assertManifest({
      id: 'builtin.pdf',
      version: 1,
      protocolVersion: 2,
      supportedMediaTypes: ['application/pdf'],
      requiredContentCapabilities: ['read-bytes'],
      supportedTargetTypes: ['pdf.region'],
      facilities: [],
    })).toThrow('INVALID_EXTENSION_DEFINITION');
  });

  it('owns immutable copies of Agent schemas and examples', () => {
    const targets = new AssetTargetRegistry();
    const definition = pageDefinition();
    targets.register(definition);

    definition.agent.payloadSchema.type = 'array';
    definition.agent.examplePayloads[0].pageNumber = 99;

    const registered = targets.get('pdf.page', 1)!;
    expect(registered.agent.payloadSchema).toEqual({ type: 'object' });
    expect(registered.agent.examplePayloads).toEqual([{ pageNumber: 1 }]);
    expect(Object.isFrozen(registered.agent.payloadSchema)).toBe(true);
    expect(Object.isFrozen(registered.agent.examplePayloads[0])).toBe(true);
  });

  it('contains Workbench validator failures at the registry boundary', () => {
    const targets = new AssetTargetRegistry();
    targets.register({
      ...pageDefinition(),
      isPayload(value) {
        const pageNumber = (value as { pageNumber?: number }).pageNumber;
        if (pageNumber === 99) throw new Error('broken extension');
        return pageNumber === 1 || pageNumber === 2;
      },
      describe(value) {
        const pageNumber = (value as { pageNumber?: number }).pageNumber;
        if (pageNumber === 2) throw new Error('broken extension');
        return `page ${pageNumber}`;
      },
    });

    expect(targets.validate('builtin.pdf', {
      scope: 'content',
      targetType: 'pdf.page',
      targetVersion: 1,
      targetPayload: { pageNumber: 99 },
    })).toBe(false);
    expect(targets.describe('builtin.pdf', {
      scope: 'content',
      targetType: 'pdf.page',
      targetVersion: 1,
      targetPayload: { pageNumber: 2 },
    })).toBeUndefined();
  });
});
