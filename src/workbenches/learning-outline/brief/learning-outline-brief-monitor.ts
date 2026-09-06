import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { access, mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import type { AgentWorkspacePreparationApi } from '../../../main/agents/workspaces/agent-workspace-manager';
import type { AssetLookup } from '../../../main/assets/asset-database';
import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import type { AssetAttachment } from '../../../shared/attachments/contracts';
import {
  cloneLearningBrief,
  createEmptyLearningBrief,
  isLearningBrief,
  LEARNING_BRIEF_FORMAT,
  LEARNING_BRIEF_VERSION,
  LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
  LEARNING_OUTLINE_BRIEF_ATTACHMENT_TYPE,
  LEARNING_OUTLINE_BRIEF_ATTACHMENT_VERSION,
  LEARNING_OUTLINE_BRIEF_FILE_NAME,
  type LearningBrief,
  type LearningOutlineBriefState,
} from '../shared';
import type { LearningOutlineChangedEvent } from '../shared';

const BRIEF_DIRECTORY_KEY = 'learning-outline-brief';
const MAX_BRIEF_BYTES = 512 * 1_024;

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ((error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error as NodeJS.ErrnoException).code === 'ENOTDIR')
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function briefRevision(brief: LearningBrief): string {
  return createHash('sha256')
    .update(stableStringify(brief), 'utf8')
    .digest('hex');
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function retainLastValidBrief(
  state: LearningOutlineBriefState,
): Pick<LearningOutlineBriefState, 'brief' | 'revision' | 'updatedTime'> {
  return {
    ...(state.brief ? { brief: state.brief } : {}),
    ...(state.revision ? { revision: state.revision } : {}),
    ...(state.updatedTime === undefined
      ? {}
      : { updatedTime: state.updatedTime }),
  };
}

function createAssetTarget(): { readonly scope: 'asset' } {
  return Object.freeze({ scope: 'asset' });
}

function findBriefAttachment(
  attachments: readonly AssetAttachment[],
): AssetAttachment | undefined {
  return attachments.find(
    (attachment) =>
      attachment.typeId === LEARNING_OUTLINE_BRIEF_ATTACHMENT_TYPE &&
      attachment.typeVersion === LEARNING_OUTLINE_BRIEF_ATTACHMENT_VERSION,
  );
}

interface BriefRuntime {
  readonly projectId: string;
  readonly assetId: string;
  readonly directory: string;
  readonly filePath: string;
  watcher?: FSWatcher;
  scanTimer?: ReturnType<typeof setTimeout>;
  scanSerial: Promise<void>;
  state: LearningOutlineBriefState;
}

/** Watches the Agent-owned brief copy and persists only validated snapshots. */
export class LearningOutlineBriefMonitor {
  private readonly listeners = new Set<
    (event: LearningOutlineChangedEvent) => void
  >();
  private readonly runtimes = new Map<string, BriefRuntime>();
  private readonly starts = new Map<string, Promise<void>>();
  private disposed = false;

  constructor(
    private readonly assets: AssetLookup,
    private readonly attachments: AttachmentServiceApi,
    private readonly agentWorkspaces: AgentWorkspacePreparationApi,
  ) {}

  async ensureWorkspace(projectId: string, assetId: string): Promise<string> {
    const asset = this.assets.get(projectId, assetId);
    if (
      !asset ||
      asset.projectId !== projectId ||
      asset.mediaType !== LEARNING_OUTLINE_ASSET_MEDIA_TYPE
    ) {
      throw new Error('学习大纲 Asset 不存在或不属于当前项目。');
    }
    const directory = await this.agentWorkspaces.prepare([
      projectId,
      BRIEF_DIRECTORY_KEY,
      assetId,
    ]);
    const filePath = join(directory, LEARNING_OUTLINE_BRIEF_FILE_NAME);
    try {
      await access(filePath);
    } catch (error) {
      if (!isMissing(error)) throw error;
      const existing = findBriefAttachment(
        await this.attachments.listByAsset(projectId, assetId),
      );
      const restored = existing
        ? await this.attachments.readTextContent(projectId, existing.id)
        : undefined;
      let restoredBrief: LearningBrief | undefined;
      if (restored) {
        try {
          const parsed: unknown = JSON.parse(restored);
          if (isLearningBrief(parsed)) restoredBrief = parsed;
        } catch {
          restoredBrief = undefined;
        }
      }
      await mkdir(dirname(filePath), { recursive: true });
      await writeFileAtomic(
        filePath,
        `${JSON.stringify(restoredBrief ?? createEmptyLearningBrief(), null, 2)}\n`,
      );
    }
    return directory;
  }

  async start(projectId: string, assetId: string): Promise<void> {
    if (this.disposed || this.runtimes.has(assetId)) return;
    const previous = this.starts.get(assetId);
    if (previous) return previous;
    const task = this.startInternal(projectId, assetId);
    this.starts.set(assetId, task);
    try {
      await task;
    } finally {
      this.starts.delete(assetId);
    }
  }

  getState(assetId: string): LearningOutlineBriefState {
    return (
      this.runtimes.get(assetId.trim())?.state ??
      Object.freeze({ valid: false })
    );
  }

  subscribe(
    listener: (event: LearningOutlineChangedEvent) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    this.disposed = true;
    await Promise.allSettled([...this.starts.values()]);
    const runtimes = [...this.runtimes.values()];
    for (const runtime of runtimes) runtime.watcher?.close();
    await Promise.allSettled(
      runtimes.map((runtime) => this.flushRuntime(runtime)),
    );
    this.runtimes.clear();
  }

  async flush(assetId?: string): Promise<void> {
    const runtimes = assetId
      ? [this.runtimes.get(assetId.trim())].filter(
          (runtime): runtime is BriefRuntime => runtime !== undefined,
        )
      : [...this.runtimes.values()];
    await Promise.all(runtimes.map((runtime) => this.flushRuntime(runtime)));
  }

  dispose(): void {
    this.disposed = true;
    for (const runtime of this.runtimes.values()) {
      if (runtime.scanTimer) clearTimeout(runtime.scanTimer);
      runtime.watcher?.close();
    }
    this.runtimes.clear();
    this.listeners.clear();
  }

  private async startInternal(
    projectId: string,
    assetId: string,
  ): Promise<void> {
    // libuv compares event paths with the watched directory. Windows 8.3
    // aliases can abort the process, so resolve the existing directory first.
    const directory = await realpath(await this.ensureWorkspace(projectId, assetId));
    if (this.disposed) return;
    const runtime: BriefRuntime = {
      projectId,
      assetId,
      directory,
      filePath: join(directory, LEARNING_OUTLINE_BRIEF_FILE_NAME),
      scanSerial: Promise.resolve(),
      state: Object.freeze({ valid: false }),
    };
    runtime.watcher = watch(directory, () => this.scheduleScan(runtime));
    this.runtimes.set(assetId, runtime);
    this.scheduleScan(runtime, true);
  }

  private scheduleScan(runtime: BriefRuntime, immediate = false): void {
    if (this.disposed || !this.runtimes.has(runtime.assetId)) return;
    if (runtime.scanTimer) clearTimeout(runtime.scanTimer);
    runtime.scanTimer = setTimeout(
      () => {
        runtime.scanTimer = undefined;
        void this.enqueueScan(runtime);
      },
      immediate ? 0 : 80,
    );
  }

  private flushRuntime(runtime: BriefRuntime): Promise<void> {
    if (runtime.scanTimer) {
      clearTimeout(runtime.scanTimer);
      runtime.scanTimer = undefined;
    }
    return this.enqueueScan(runtime);
  }

  private enqueueScan(runtime: BriefRuntime): Promise<void> {
    const task = runtime.scanSerial
      .then(() => this.scan(runtime))
      .catch((error: unknown) => {
        if (!this.runtimes.has(runtime.assetId)) return;
        runtime.state = Object.freeze({
          valid: false,
          ...retainLastValidBrief(runtime.state),
          error:
            error instanceof Error ? error.message : '无法读取学习需求文件。',
        });
        this.publishBrief(runtime);
      });
    runtime.scanSerial = task;
    return task;
  }

  private async scan(runtime: BriefRuntime): Promise<void> {
    const asset = this.assets.get(runtime.projectId, runtime.assetId);
    if (!asset || asset.mediaType !== LEARNING_OUTLINE_ASSET_MEDIA_TYPE) {
      runtime.watcher?.close();
      this.runtimes.delete(runtime.assetId);
      return;
    }
    let raw: string;
    try {
      raw = await readFile(runtime.filePath, 'utf8');
    } catch (error) {
      runtime.state = Object.freeze({
        valid: false,
        ...retainLastValidBrief(runtime.state),
        error: isMissing(error)
          ? '学习需求文件不存在。'
          : '学习需求文件无法读取。',
      });
      this.publishBrief(runtime);
      return;
    }
    if (new TextEncoder().encode(raw).byteLength > MAX_BRIEF_BYTES) {
      runtime.state = Object.freeze({
        valid: false,
        ...retainLastValidBrief(runtime.state),
        error: '学习需求文件过大。',
      });
      this.publishBrief(runtime);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      runtime.state = Object.freeze({
        valid: false,
        ...retainLastValidBrief(runtime.state),
        error: '学习需求 JSON 格式无效。',
      });
      this.publishBrief(runtime);
      return;
    }
    if (!isLearningBrief(parsed)) {
      runtime.state = Object.freeze({
        valid: false,
        ...retainLastValidBrief(runtime.state),
        error: '学习需求结构或版本无效。',
      });
      this.publishBrief(runtime);
      return;
    }
    const brief = cloneLearningBrief(parsed);
    const revision = briefRevision(brief);
    if (runtime.state.valid && runtime.state.revision === revision) return;
    const attachment = await this.saveSnapshot(runtime, brief, revision);
    runtime.state = Object.freeze({
      valid: true,
      ready: brief.readiness === 'ready',
      revision,
      updatedTime: attachment.updatedTime,
      brief,
    });
    this.publishBrief(runtime);
  }

  private async saveSnapshot(
    runtime: BriefRuntime,
    brief: LearningBrief,
    revision: string,
  ): Promise<AssetAttachment> {
    const existing = findBriefAttachment(
      await this.attachments.listByAsset(runtime.projectId, runtime.assetId),
    );
    const metadata = {
      format: LEARNING_BRIEF_FORMAT,
      version: LEARNING_BRIEF_VERSION,
      revision,
    } as const;
    if (existing) {
      if (
        existing.metadata &&
        typeof existing.metadata === 'object' &&
        !Array.isArray(existing.metadata) &&
        (existing.metadata as Record<string, unknown>).revision === revision
      )
        return existing;
      return this.attachments.updateWithContent({
        projectId: runtime.projectId,
        attachmentId: existing.id,
        target: createAssetTarget(),
        metadata,
        content: {
          fileName: `brief-${revision}.json`,
          mediaType: 'application/json',
          data: jsonBytes(brief),
        },
      });
    }
    return this.attachments.createWithContent({
      projectId: runtime.projectId,
      assetId: runtime.assetId,
      typeId: LEARNING_OUTLINE_BRIEF_ATTACHMENT_TYPE,
      typeVersion: LEARNING_OUTLINE_BRIEF_ATTACHMENT_VERSION,
      target: createAssetTarget(),
      metadata,
      content: {
        fileName: `brief-${revision}.json`,
        mediaType: 'application/json',
        data: jsonBytes(brief),
      },
    });
  }

  private publishBrief(runtime: BriefRuntime): void {
    this.publish({
      type: 'brief-changed',
      projectId: runtime.projectId,
      assetId: runtime.assetId,
      ...(runtime.state.revision ? { revision: runtime.state.revision } : {}),
      state: runtime.state,
    });
  }

  private publish(event: LearningOutlineChangedEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('Learning Outline 事件订阅失败', error);
      }
    }
  }
}
