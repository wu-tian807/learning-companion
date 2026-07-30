type MermaidRuntime = {
  initialize(options: Record<string, unknown>): void;
};

type StrictMermaidRuntime = MermaidRuntime & {
  __learningCompanionStrict?: true;
};

interface MarkdownRuntimeGlobal {
  mermaid?: StrictMermaidRuntime;
  plantumlEncoder?: { encode(value: string): string };
}

export interface MarkdownRuntimeLoaderApi {
  load(resourceBaseUrl: string, signal?: AbortSignal): Promise<void>;
}

export interface MarkdownRuntimeLoaderDependencies {
  readonly document: Document;
  readonly runtimeGlobal: MarkdownRuntimeGlobal;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function createAbortError(): DOMException {
  return new DOMException(
    'Markdown runtime loading cancelled',
    'AbortError',
  );
}

async function waitForTask(
  task: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    return task;
  }
  if (signal.aborted) {
    throw createAbortError();
  }

  let onAbort: (() => void) | undefined;

  try {
    await Promise.race([
      task,
      new Promise<never>((_resolvePromise, rejectPromise) => {
        onAbort = () => rejectPromise(createAbortError());
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

export class MarkdownRuntimeLoader
  implements MarkdownRuntimeLoaderApi
{
  private iconRuntimeTask: Promise<void> | undefined;
  private mermaidRuntimeTask: Promise<void> | undefined;

  constructor(
    private readonly configuredDependencies:
      Partial<MarkdownRuntimeLoaderDependencies> = {},
  ) {}

  async load(
    resourceBaseUrl: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw createAbortError();
    }

    await waitForTask(
      Promise.all([
        this.loadIconRuntime(resourceBaseUrl),
        this.loadMermaidRuntime(resourceBaseUrl),
      ]).then(() => undefined),
      signal,
    );
    this.enforceStrictMermaidRuntime();
    this.installPlantUmlNetworkGuard();
  }

  private get document(): Document {
    return this.configuredDependencies.document ?? document;
  }

  private get runtimeGlobal(): MarkdownRuntimeGlobal {
    return (
      this.configuredDependencies.runtimeGlobal ??
      (globalThis as MarkdownRuntimeGlobal)
    );
  }

  private loadIconRuntime(resourceBaseUrl: string): Promise<void> {
    if (this.document.getElementById('vditor-icon-bold')) {
      return Promise.resolve();
    }
    if (this.iconRuntimeTask) {
      return this.iconRuntimeTask;
    }

    const task = this.loadScript({
      id: 'vditorIconScript',
      source: `${trimTrailingSlash(resourceBaseUrl)}/dist/js/icons/ant.js`,
      isReady: () =>
        Boolean(this.document.getElementById('vditor-icon-bold')),
      errorMessage: 'Vditor 本地图标资源加载失败',
    });
    this.iconRuntimeTask = task;
    void task.then(
      () => {
        if (this.iconRuntimeTask === task) {
          this.iconRuntimeTask = undefined;
        }
      },
      () => {
        if (this.iconRuntimeTask === task) {
          this.iconRuntimeTask = undefined;
        }
      },
    );
    return task;
  }

  private loadMermaidRuntime(resourceBaseUrl: string): Promise<void> {
    if (this.runtimeGlobal.mermaid) {
      return Promise.resolve();
    }
    if (this.mermaidRuntimeTask) {
      return this.mermaidRuntimeTask;
    }

    const task = this.loadScript({
      id: 'vditorMermaidScript',
      source: `${trimTrailingSlash(resourceBaseUrl)}/dist/js/mermaid/mermaid.min.js?v=11.6.0`,
      isReady: () => Boolean(this.runtimeGlobal.mermaid),
      errorMessage: 'Mermaid 本地运行资源加载失败',
    });
    this.mermaidRuntimeTask = task;
    void task.then(
      () => {
        if (this.mermaidRuntimeTask === task) {
          this.mermaidRuntimeTask = undefined;
        }
      },
      () => {
        if (this.mermaidRuntimeTask === task) {
          this.mermaidRuntimeTask = undefined;
        }
      },
    );
    return task;
  }

  private loadScript(input: {
    readonly id: string;
    readonly source: string;
    readonly isReady: () => boolean;
    readonly errorMessage: string;
  }): Promise<void> {
    const existing = this.document.getElementById(input.id);

    if (existing) {
      existing.remove();
    }

    return new Promise<void>((resolve, reject) => {
      const script = this.document.createElement('script');
      script.id = input.id;
      script.async = true;
      script.src = input.source;
      const cleanup = () => {
        script.removeEventListener('load', handleLoad);
        script.removeEventListener('error', handleError);
      };
      const fail = () => {
        cleanup();
        script.remove();
        reject(new Error(input.errorMessage));
      };
      const handleLoad = () => {
        if (!input.isReady()) {
          fail();
          return;
        }

        cleanup();
        resolve();
      };
      const handleError = () => {
        fail();
      };

      script.addEventListener('load', handleLoad, { once: true });
      script.addEventListener('error', handleError, { once: true });
      this.document.head.appendChild(script);
    });
  }

  private enforceStrictMermaidRuntime(): void {
    const runtime = this.runtimeGlobal.mermaid;

    if (!runtime || runtime.__learningCompanionStrict) {
      return;
    }

    const initialize = runtime.initialize.bind(runtime);
    runtime.initialize = (options) => {
      const flowchart =
        typeof options.flowchart === 'object' &&
        options.flowchart !== null &&
        !Array.isArray(options.flowchart)
          ? (options.flowchart as Record<string, unknown>)
          : {};

      initialize({
        ...options,
        securityLevel: 'strict',
        flowchart: {
          ...flowchart,
          htmlLabels: false,
        },
      });
    };
    runtime.__learningCompanionStrict = true;
  }

  private installPlantUmlNetworkGuard(): void {
    const scriptId = 'vditorPlantumlScript';

    if (!this.document.getElementById(scriptId)) {
      const marker = this.document.createElement('meta');
      marker.id = scriptId;
      this.document.head.appendChild(marker);
    }

    this.runtimeGlobal.plantumlEncoder = {
      encode() {
        throw new Error(
          'PlantUML 网络渲染在 Learning Companion 中已禁用',
        );
      },
    };
  }
}

export const markdownRuntimeLoader = new MarkdownRuntimeLoader();
