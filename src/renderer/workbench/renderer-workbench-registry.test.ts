import { describe, expect, it } from 'vitest';

import type { RendererWorkbenchModule } from './renderer-workbench-registry';
import { RendererWorkbenchRegistry } from './renderer-workbench-registry';
import { unsupportedRendererWorkbenchModule } from '../../workbenches/unsupported/renderer';

function TestView() {
  return null;
}

describe('RendererWorkbenchRegistry', () => {
  it('resolves registered modules and falls back for unknown IDs', async () => {
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
    await expect(registry.resolve('unknown')).resolves.toBe(
      unsupportedRendererWorkbenchModule,
    );
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

    registry.registerLoader(module.manifest.id, async () => {
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

  it('rejects loader results registered under a different ID', async () => {
    const registry = new RendererWorkbenchRegistry(
      unsupportedRendererWorkbenchModule,
    );

    registry.registerLoader('builtin.plain-text', async () => ({
      manifest: {
        ...unsupportedRendererWorkbenchModule.manifest,
        id: 'builtin.other',
      },
      View: TestView,
    }));

    await expect(
      registry.resolve('builtin.plain-text'),
    ).rejects.toThrow('Renderer Workbench 加载结果不匹配');
  });

  it('rejects duplicate module IDs', () => {
    const registry = new RendererWorkbenchRegistry(
      unsupportedRendererWorkbenchModule,
    );

    expect(() =>
      registry.register(unsupportedRendererWorkbenchModule),
    ).toThrow('Renderer Workbench 重复注册');
  });
});
