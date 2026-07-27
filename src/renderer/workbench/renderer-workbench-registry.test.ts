import { describe, expect, it } from 'vitest';

import type { RendererWorkbenchModule } from './renderer-workbench-registry';
import { RendererWorkbenchRegistry } from './renderer-workbench-registry';
import { unsupportedRendererWorkbenchModule } from '../../workbenches/unsupported/renderer';

function TestView() {
  return null;
}

describe('RendererWorkbenchRegistry', () => {
  it('resolves registered modules and falls back for unknown IDs', () => {
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

    expect(registry.resolve('builtin.plain-text')).toBe(module);
    expect(registry.resolve('unknown')).toBe(
      unsupportedRendererWorkbenchModule,
    );
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
