import type {
  RendererWorkbenchLoader,
  RendererWorkbenchRegistry,
} from '../../renderer/workbench/renderer-workbench-registry';
import {
  builtinWorkbenchCatalog,
  type BuiltinWorkbenchId,
} from './builtin-workbenches';

const rendererLoaders: Readonly<
  {
    [TId in BuiltinWorkbenchId]: RendererWorkbenchLoader<TId>;
  }
> = {
  'builtin.plain-text': async () => {
    const { plainTextRendererWorkbenchModule } = await import(
      '../plain-text/renderer'
    );
    return plainTextRendererWorkbenchModule;
  },
  'builtin.markdown': async () => {
    const { markdownRendererWorkbenchModule } = await import(
      '../markdown/renderer'
    );
    return markdownRendererWorkbenchModule;
  },
  'builtin.mindmap': async () => {
    const { mindMapRendererWorkbenchModule } = await import(
      '../mindmap/renderer'
    );
    return mindMapRendererWorkbenchModule;
  },
  'builtin.pdf': async () => {
    const { default: module } = await import('../pdf/renderer');
    return module;
  },
  'builtin.office': async () => {
    const { default: module } = await import('../office/renderer');
    return module;
  },
  'builtin.html': async () => {
    const { default: module } = await import('../html/renderer');
    return module;
  },
  'builtin.epub': async () => {
    const { default: module } = await import('../epub/renderer');
    return module;
  },
  'builtin.image': async () => {
    const { imageRendererWorkbenchModule } = await import(
      '../image/renderer'
    );
    return imageRendererWorkbenchModule;
  },
  'builtin.audio': async () => {
    const { default: module } = await import('../audio/renderer');
    return module;
  },
  'builtin.video': async () => {
    const { default: module } = await import('../video/renderer');
    return module;
  },
};

export function registerRendererWorkbenches(
  registry: Pick<RendererWorkbenchRegistry, 'registerLoader'>,
): void {
  for (const entry of builtinWorkbenchCatalog) {
    registry.registerLoader(
      entry.manifest,
      rendererLoaders[entry.id],
    );
  }
}
