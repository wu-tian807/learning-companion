import { describe, expect, it } from 'vitest';

import type { RendererWorkbenchModule } from './renderer-workbench-registry';
import {
  assertRendererWorkbenchCompatibility,
  RendererWorkbenchRegistry,
} from './renderer-workbench-registry';
import { unsupportedRendererWorkbenchModule } from '../../workbenches/unsupported/renderer';

function TestView() {
  return null;
}

describe('RendererWorkbenchRegistry', () => {
  it('resolves registered modules and rejects unknown IDs', async () => {
    const registry = new RendererWorkbenchRegistry(
      unsupportedRendererWorkbenchModule,
    );
    const module: RendererWorkbenchModule = {
      manifest: {
        ...unsupportedRendererWorkbenchModule.manifest,
        id: 'builtin.plain-text',
        supportedMediaTypes: ['text/plain'],
      },
      View: TestView,
    };
    registry.register(module);

    await expect(registry.resolve('builtin.plain-text')).resolves.toBe(
      module,
    );
    await expect(registry.resolve('unknown')).rejects.toThrow(
      'Renderer Workbench 未注册',
    );
    await expect(
      registry.resolve(unsupportedRendererWorkbenchModule.manifest.id),
    ).resolves.toBe(unsupportedRendererWorkbenchModule);
  });

  it('loads renderer modules only when first resolved', async () => {
    const registry = new RendererWorkbenchRegistry(
      unsupportedRendererWorkbenchModule,
    );
    const module: RendererWorkbenchModule = {
      manifest: {
        ...unsupportedRendererWorkbenchModule.manifest,
        id: 'builtin.plain-text',
        supportedMediaTypes: ['text/plain'],
      },
      View: TestView,
    };
    let loadCount = 0;

    registry.registerLoader(module.manifest, async () => {
      loadCount += 1;
      return module;
    });

    expect(loadCount).toBe(0);

    const [firstResolution, secondResolution] = await Promise.all([
      registry.resolve(module.manifest.id),
      registry.resolve(module.manifest.id),
    ]);

    expect(firstResolution).toBe(module);
    expect(secondResolution).toBe(module);
    expect(loadCount).toBe(1);
    await expect(registry.resolve(module.manifest.id)).resolves.toBe(
      module,
    );
    expect(loadCount).toBe(1);
  });

  it('rejects loader results with a different contract', async () => {
    const registry = new RendererWorkbenchRegistry(
      unsupportedRendererWorkbenchModule,
    );

    const expectedManifest = {
      ...unsupportedRendererWorkbenchModule.manifest,
      id: 'builtin.plain-text' as const,
      supportedMediaTypes: ['text/plain'],
    };

    registry.registerLoader(expectedManifest, async () => ({
      manifest: {
        ...expectedManifest,
        version: expectedManifest.version + 1,
      },
      View: TestView,
    }));

    await expect(
      registry.resolve('builtin.plain-text'),
    ).rejects.toThrow('Renderer Workbench 加载契约不匹配');
  });

  it('rejects duplicate module IDs', () => {
    const registry = new RendererWorkbenchRegistry(
      unsupportedRendererWorkbenchModule,
    );

    expect(() =>
      registry.register(unsupportedRendererWorkbenchModule),
    ).toThrow('Renderer Workbench 重复注册');
  });

  it('checks the Main bootstrap against the Renderer contract', () => {
    const module: RendererWorkbenchModule = {
      manifest: {
        ...unsupportedRendererWorkbenchModule.manifest,
        id: 'builtin.plain-text',
      },
      View: TestView,
    };
    const bootstrap = {
      sessionId: 'session',
      workbenchId: module.manifest.id,
      workbenchVersion: module.manifest.version,
      protocolVersion: module.manifest.protocolVersion,
      assetId: 'asset',
      mediaType: 'text/plain',
      availability: 'available' as const,
      payload: null,
    };

    expect(() =>
      assertRendererWorkbenchCompatibility(module, bootstrap),
    ).not.toThrow();
    expect(() =>
      assertRendererWorkbenchCompatibility(module, {
        ...bootstrap,
        workbenchVersion: bootstrap.workbenchVersion + 1,
      }),
    ).toThrow('Workbench 前后端契约版本不匹配');
  });
});
