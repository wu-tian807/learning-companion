import {
  DefaultTextContentAdapter,
  type ResolvedTextContent,
  type TextContentAdapter,
  type WriteTextContentResult,
} from '../../main/content/text-content';
import {
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  join,
  resolve,
  sep,
} from 'node:path';
import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type { WorkbenchEventBusApi } from '../../main/workbench/workbench-event-bus';
import type { WorkbenchStateDataDatabaseApi } from '../../main/workbench/workbench-state-data-database';
import type {
  WorkbenchStateRecord,
  WorkbenchStateDatabaseApi,
} from '../../main/workbench/workbench-state-database';
import type {
  JsonValue,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import {
  cloneMarkdownWorkbenchViewState,
  DEFAULT_MARKDOWN_WORKBENCH_STATE,
  isMarkdownEncoding,
  isMarkdownEncodingPayload,
  isMarkdownLineEndingPayload,
  isMarkdownSourceBufferPayload,
  isMarkdownWorkbenchStateV1,
  isMarkdownWorkbenchViewStatePayload,
  isMarkdownWysiwygBufferPayload,
  MARKDOWN_RECOVERY_DATA_KEY,
  MARKDOWN_STATE_SCHEMA_VERSION,
  MARKDOWN_WORKBENCH_ID,
  MARKDOWN_IMAGE_DIRECTORY,
  MARKDOWN_MAX_IMAGE_BYTES,
  isMarkdownInsertImagePayload,
  isMarkdownReadImagePayload,
  markdownCommands,
  markdownWorkbenchManifest,
  markdownImageExtensionFromMediaType,
  markdownImageMediaTypeFromName,
  type MarkdownEditMode,
  type MarkdownLineEnding,
  type MarkdownRecoveryState,
  type MarkdownWorkbenchStateV1,
  type MarkdownWorkbenchViewState,
} from './shared';

const RECOVERY_DEBOUNCE_MS = 800;

interface MarkdownSessionRuntime {
  readonly sessionId: string;
  readonly assetId: string;
  readonly handle: NonNullable<
    Parameters<MainWorkbenchProvider['open']>[0]['content']['handle']
  >;
  /** Markdown 源文件所在目录；缺失时图片命令不可用。 */
  readonly assetDirectory?: string;
  viewState: MarkdownWorkbenchViewState;
  readonly document: MarkdownDocumentRuntime;
}

/**
 * The editable file is deliberately owned by the asset, not by a viewport
 * session.  Sessions only own presentation state (cursor, scroll and mode).
 * This is not a CRDT: concurrent stale writers are rejected instead of being
 * silently merged.
 */
interface MarkdownDocumentRuntime {
  readonly assetId: string;
  handle: MarkdownSessionRuntime['handle'];
  source: ResolvedTextContent;
  workingBuffer: string;
  currentLineEnding: MarkdownLineEnding;
  lastEditMode: MarkdownEditMode;
  recovery: MarkdownRecoveryState | undefined;
  recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  recoveryTask: Promise<void>;
  documentVersion: number;
  lastWriterSessionId: string | undefined;
  lastWriterUpdateId: number;
  readonly sessionIds: Set<string>;
  writeTask: Promise<void>;
}

export interface MarkdownImageFileSystemApi {
  readonly mkdir: (directory: string) => Promise<void>;
  readonly writeFile: (
    filePath: string,
    data: Uint8Array,
  ) => Promise<void>;
  readonly readFile: (filePath: string) => Promise<Buffer>;
}

const defaultImageFileSystem: MarkdownImageFileSystemApi = {
  mkdir: async (directory) => {
    await mkdir(directory, { recursive: true });
  },
  writeFile,
  readFile,
};

export interface MarkdownWorkbenchProviderDependencies {
  readonly now: () => number;
  readonly textContentAdapter: TextContentAdapter;
  readonly recoveryDebounceMs: number;
  readonly imageFileSystem?: Partial<MarkdownImageFileSystemApi>;
  readonly workbenchEvents?: WorkbenchEventBusApi;
}

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

function cloneRecoveryState(
  recovery: MarkdownRecoveryState,
): MarkdownRecoveryState {
  return {
    dataKey: recovery.dataKey,
    baseRevision: recovery.baseRevision,
    encoding: recovery.encoding,
    lineEnding: recovery.lineEnding,
    hasByteOrderMark: recovery.hasByteOrderMark,
    editedFrom: recovery.editedFrom,
    updatedTime: recovery.updatedTime,
  };
}

function toJsonState(state: MarkdownWorkbenchStateV1): JsonValue {
  return {
    ...cloneMarkdownWorkbenchViewState(state),
    ...(state.recovery
      ? { recovery: cloneRecoveryState(state.recovery) }
      : {}),
  };
}

export class MarkdownWorkbenchProvider
  implements MainWorkbenchProvider {
  readonly manifest = markdownWorkbenchManifest;
  private readonly sessions = new Map<string, MarkdownSessionRuntime>();
  private readonly documents = new Map<string, MarkdownDocumentRuntime>();
  private readonly openingDocuments = new Map<
    string,
    Promise<{
      readonly document: MarkdownDocumentRuntime;
      readonly recoveryContent: string | undefined;
      readonly state?: MarkdownWorkbenchStateV1;
    }>
  >();
  private readonly now: () => number;
  private readonly textContentAdapter: TextContentAdapter;
  private readonly recoveryDebounceMs: number;
  private readonly imageFileSystem: MarkdownImageFileSystemApi;
  private readonly workbenchEvents: WorkbenchEventBusApi | undefined;

  constructor(
    private readonly stateDatabase: WorkbenchStateDatabaseApi,
    private readonly dataDatabase: WorkbenchStateDataDatabaseApi,
    dependencies: Partial<MarkdownWorkbenchProviderDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.textContentAdapter =
      dependencies.textContentAdapter ?? new DefaultTextContentAdapter();
    this.recoveryDebounceMs =
      dependencies.recoveryDebounceMs ?? RECOVERY_DEBOUNCE_MS;
    this.imageFileSystem = {
      ...defaultImageFileSystem,
      ...dependencies.imageFileSystem,
    };
    this.workbenchEvents = dependencies.workbenchEvents;
  }

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    const handle = context.content.handle;

    if (
      context.selectionReason !== 'matched' ||
      !handle?.capabilities.has('read-bytes') ||
      !handle.capabilities.has('write-bytes') ||
      !handle.readBytes ||
      !handle.writeBytes
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    if (this.sessions.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    let state = this.readState(context.state);
    const opened = await this.getOrOpenDocument(
      context.asset.id,
      handle,
      state,
    );
    const document = opened.document;
    const recoveryContent = opened.recoveryContent;
    state = opened.state ?? state;

    const viewState = cloneMarkdownWorkbenchViewState(state);
    const assetLocation = context.content.location;
    const assetDirectory =
      assetLocation?.kind === 'local-file'
        ? dirname(assetLocation.absolutePath)
        : undefined;
    this.sessions.set(context.sessionId, {
      sessionId: context.sessionId,
      assetId: context.asset.id,
      handle,
      ...(assetDirectory ? { assetDirectory } : {}),
      viewState,
      document,
    });
    document.sessionIds.add(context.sessionId);

    return {
      payload: {
        diskSource: document.source.content,
        ...(this.isDirty(document)
          ? {
              workingBuffer: document.workingBuffer,
              documentDirty: true,
            }
          : {}),
        encoding: document.source.encoding,
        lineEnding: document.source.lineEnding,
        hasByteOrderMark: document.source.hasByteOrderMark,
        revision: document.source.revision,
        documentVersion: document.documentVersion,
        state: viewState,
        ...(document.recovery && recoveryContent !== undefined
          ? {
              recovery: {
                content: recoveryContent,
                baseRevision: document.recovery.baseRevision,
                encoding: document.recovery.encoding,
                lineEnding: document.recovery.lineEnding,
                hasByteOrderMark: document.recovery.hasByteOrderMark,
                editedFrom: document.recovery.editedFrom,
                updatedTime: document.recovery.updatedTime,
                sourceChanged:
                  document.recovery.baseRevision !== document.source.revision,
              },
            }
          : {}),
      },
    };
  }

  async command(
    context: Parameters<MainWorkbenchProvider['command']>[0],
    command: Parameters<MainWorkbenchProvider['command']>[1],
  ): Promise<WorkbenchCommandResult> {
    const runtime = this.findRuntime(context.sessionId);
    const document = runtime.document;
    this.validateCommand(command);
    this.cancelScheduledRecovery(document);
    await this.waitForRecovery(document);

    switch (command.type) {
      case markdownCommands.syncSourceBuffer: {
        if (!isMarkdownSourceBufferPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        this.acceptDocumentBuffer(
          runtime,
          command.payload.content,
          command.payload.lineEnding,
          'source',
          command.payload.baseDocumentVersion,
          command.payload.updateId,
        );
        runtime.viewState = {
          ...runtime.viewState,
          viewMode: 'source',
          sourceViewState: command.payload.sourceViewState,
        };
        await this.scheduleRecovery(document, runtime.viewState);
        return this.createSyncResult(runtime);
      }
      case markdownCommands.syncWysiwygBuffer: {
        if (!isMarkdownWysiwygBufferPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        this.acceptDocumentBuffer(
          runtime,
          command.payload.content,
          command.payload.lineEnding,
          'wysiwyg',
          command.payload.baseDocumentVersion,
          command.payload.updateId,
        );
        runtime.viewState = {
          ...runtime.viewState,
          viewMode: 'wysiwyg',
          wysiwygScrollTop: command.payload.wysiwygScrollTop,
        };
        await this.scheduleRecovery(document, runtime.viewState);
        return this.createSyncResult(runtime);
      }
      case markdownCommands.backup: {
        if (command.payload !== undefined) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        this.cancelScheduledRecovery(document);
        return createResult({
          backedUpTime: await this.persistRecovery(document, runtime.viewState),
        });
      }
      case markdownCommands.save: {
        if (command.payload !== undefined) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        try {
          return this.createSaveResult(await this.saveSource(document, runtime.viewState));
        } catch (error) {
          await this.scheduleRecovery(document, runtime.viewState);
          throw error;
        }
      }
      case markdownCommands.saveViewState: {
        if (!isMarkdownWorkbenchViewStatePayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        runtime.viewState = cloneMarkdownWorkbenchViewState(
          command.payload,
        );
        await this.saveCurrentState(runtime);
        if (this.isDirty(document)) {
          await this.scheduleRecovery(document, runtime.viewState);
        }
        return createResult({ saved: true, savedTime: this.now() });
      }
      case markdownCommands.setLineEnding: {
        if (!isMarkdownLineEndingPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        document.currentLineEnding = command.payload.lineEnding;
        document.documentVersion += 1;
        this.publishDocumentChange(document, context.sessionId);
        await this.scheduleRecovery(document, runtime.viewState);
        return createResult({
          lineEnding: document.currentLineEnding,
          dirty: this.isDirty(document),
        });
      }
      case markdownCommands.reopenWithEncoding: {
        if (!isMarkdownEncodingPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        if (this.isDirty(document) || document.recovery) {
          if (this.isDirty(document)) {
            await this.scheduleRecovery(document, runtime.viewState);
          }
          throw new AppError('CONTENT_HAS_UNSAVED_CHANGES');
        }

        const source = await this.textContentAdapter.read(document.handle, {
          encoding: command.payload.encoding,
        });

        if (!isMarkdownEncoding(source.encoding)) {
          throw new AppError('CONTENT_ENCODING_UNSUPPORTED');
        }

        document.source = source;
        document.workingBuffer = source.content;
        document.currentLineEnding = source.lineEnding;
        document.documentVersion += 1;
        this.publishDocumentChange(document, context.sessionId);

        return createResult({
          diskSource: source.content,
          encoding: source.encoding,
          lineEnding: source.lineEnding,
          hasByteOrderMark: source.hasByteOrderMark,
          revision: source.revision,
        });
      }
      case markdownCommands.discardRecovery: {
        if (command.payload !== undefined) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        this.cancelScheduledRecovery(document);
        document.workingBuffer = document.source.content;
        document.currentLineEnding = document.source.lineEnding;
        document.lastEditMode = runtime.viewState.viewMode;
        document.recovery = undefined;
        document.documentVersion += 1;
        this.publishDocumentChange(document, context.sessionId);
        await this.clearRecovery(runtime.assetId, runtime.viewState);
        return createResult({ discarded: true });
      }
      case markdownCommands.insertImage: {
        if (!isMarkdownInsertImagePayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        const relativePath = await this.storeInsertedImage(runtime, {
          name: command.payload.name,
          mediaType: command.payload.mediaType,
          data: command.payload.data,
        });
        return createResult({ relativePath });
      }
      case markdownCommands.readImage: {
        if (!isMarkdownReadImagePayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        const dataUrl = await this.readStoredImage(
          runtime,
          command.payload.relativePath,
        );
        return createResult({ dataUrl });
      }
      default:
        throw new AppError('FEATURE_NOT_SUPPORTED');
    }
  }

  async close(
    context: Parameters<MainWorkbenchProvider['close']>[0],
  ): Promise<void> {
    const runtime = this.sessions.get(context.sessionId);

    if (!runtime) {
      return;
    }

    try {
      const document = runtime.document;
      document.sessionIds.delete(context.sessionId);
      if (document.handle === runtime.handle) {
        const replacementId = document.sessionIds.values().next()
          .value as string | undefined;
        const replacement = replacementId
          ? this.sessions.get(replacementId)
          : undefined;
        if (replacement) document.handle = replacement.handle;
      }
      if (document.sessionIds.size === 0 && this.isDirty(document)) {
        this.cancelScheduledRecovery(document);
        await this.waitForRecovery(document);
        await this.persistRecovery(document, runtime.viewState);
      }
    } finally {
      if (runtime.document.sessionIds.size === 0) {
        this.documents.delete(runtime.assetId);
      }
      this.sessions.delete(context.sessionId);
    }
  }

  private findRuntime(sessionId: string): MarkdownSessionRuntime {
    const runtime = this.sessions.get(sessionId);

    if (!runtime) {
      throw new AppError('WORKBENCH_SESSION_NOT_FOUND');
    }

    return runtime;
  }

  private async openDocument(
    assetId: string,
    handle: MarkdownSessionRuntime['handle'],
    initialState: MarkdownWorkbenchStateV1,
  ): Promise<{
    readonly document: MarkdownDocumentRuntime;
    readonly recoveryContent: string | undefined;
    readonly state?: MarkdownWorkbenchStateV1;
  }> {
    const source = await this.textContentAdapter.read(handle);
    if (!isMarkdownEncoding(source.encoding)) {
      throw new AppError('CONTENT_ENCODING_UNSUPPORTED');
    }

    let state = initialState;
    let recoveryContent: string | undefined;
    if (state.recovery) {
      const data = await this.dataDatabase.get(
        assetId,
        MARKDOWN_WORKBENCH_ID,
        state.recovery.dataKey,
      );
      if (data) {
        try {
          recoveryContent = new TextDecoder('utf-8', { fatal: true }).decode(
            data.data,
          );
        } catch {
          state = await this.removeInvalidRecovery(assetId, state);
        }
      } else {
        state = await this.removeInvalidRecovery(assetId, state);
      }
    }
    if (
      recoveryContent === source.content &&
      state.recovery?.encoding === source.encoding &&
      state.recovery.lineEnding === source.lineEnding &&
      state.recovery.hasByteOrderMark === source.hasByteOrderMark
    ) {
      state = await this.removeInvalidRecovery(assetId, state);
      recoveryContent = undefined;
    }

    const document: MarkdownDocumentRuntime = {
      assetId,
      handle,
      source,
      workingBuffer: source.content,
      currentLineEnding: source.lineEnding,
      lastEditMode: state.viewMode,
      recovery: state.recovery,
      recoveryTimer: undefined,
      recoveryTask: Promise.resolve(),
      documentVersion: 0,
      lastWriterSessionId: undefined,
      lastWriterUpdateId: 0,
      sessionIds: new Set(),
      writeTask: Promise.resolve(),
    };
    this.documents.set(assetId, document);
    return { document, recoveryContent, state };
  }

  private getOrOpenDocument(
    assetId: string,
    handle: MarkdownSessionRuntime['handle'],
    state: MarkdownWorkbenchStateV1,
  ): Promise<{
    readonly document: MarkdownDocumentRuntime;
    readonly recoveryContent: string | undefined;
    readonly state?: MarkdownWorkbenchStateV1;
  }> {
    const existing = this.documents.get(assetId);
    if (existing) {
      return Promise.resolve({
        document: existing,
        recoveryContent: undefined,
      });
    }
    const opening = this.openingDocuments.get(assetId);
    if (opening) return opening;
    const task = this.openDocument(assetId, handle, state).finally(() => {
      if (this.openingDocuments.get(assetId) === task) {
        this.openingDocuments.delete(assetId);
      }
    });
    this.openingDocuments.set(assetId, task);
    return task;
  }

  private acceptDocumentBuffer(
    runtime: MarkdownSessionRuntime,
    content: string,
    lineEnding: MarkdownLineEnding,
    editedFrom: MarkdownEditMode,
    baseDocumentVersion: number | undefined,
    updateId: number | undefined,
  ): void {
    const document = runtime.document;
    // New renderers identify every optimistic edit. A late writer may append
    // only to its own immediately preceding version; otherwise it must retain
    // a conflict draft instead of replacing another viewport's full buffer.
    if (
      updateId !== undefined &&
      updateId > 0 &&
      baseDocumentVersion !== document.documentVersion &&
      !(
        baseDocumentVersion !== undefined &&
        baseDocumentVersion < document.documentVersion &&
        document.lastWriterSessionId === runtime.sessionId &&
        updateId > document.lastWriterUpdateId
      )
    ) {
      throw new AppError('CONTENT_HAS_UNSAVED_CHANGES');
    }
    document.workingBuffer = content;
    document.currentLineEnding = lineEnding;
    document.lastEditMode = editedFrom;
    document.lastWriterSessionId = runtime.sessionId;
    document.lastWriterUpdateId = updateId ?? 0;
    document.documentVersion += 1;
    this.publishDocumentChange(document, runtime.sessionId);
  }

  private publishDocumentChange(
    document: MarkdownDocumentRuntime,
    originSessionId?: string,
  ): void {
    if (!this.workbenchEvents) return;
    for (const sessionId of document.sessionIds) {
      if (sessionId === originSessionId) continue;
      this.workbenchEvents.publish({
        sessionId,
        type: 'markdown:document-changed',
        payload: {
          content: document.workingBuffer,
          diskSource: document.source.content,
          lineEnding: document.currentLineEnding,
          savedLineEnding: document.source.lineEnding,
          revision: document.source.revision,
          dirty: this.isDirty(document),
          documentVersion: document.documentVersion,
          ...(originSessionId ? { originSessionId } : {}),
        },
      });
    }
  }

  private validateCommand(
    command: Parameters<MainWorkbenchProvider['command']>[1],
  ): void {
    switch (command.type) {
      case markdownCommands.syncSourceBuffer:
        if (!isMarkdownSourceBufferPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        return;
      case markdownCommands.syncWysiwygBuffer:
        if (!isMarkdownWysiwygBufferPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        return;
      case markdownCommands.backup:
      case markdownCommands.save:
      case markdownCommands.discardRecovery:
        if (command.payload !== undefined) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        return;
      case markdownCommands.saveViewState:
        if (!isMarkdownWorkbenchViewStatePayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        return;
      case markdownCommands.setLineEnding:
        if (!isMarkdownLineEndingPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        return;
      case markdownCommands.reopenWithEncoding:
        if (!isMarkdownEncodingPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        return;
      case markdownCommands.insertImage:
        if (!isMarkdownInsertImagePayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        return;
      case markdownCommands.readImage:
        if (!isMarkdownReadImagePayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        return;
      default:
        throw new AppError('FEATURE_NOT_SUPPORTED');
    }
  }

  private requireAssetDirectory(
    runtime: MarkdownSessionRuntime,
  ): string {
    if (!runtime.assetDirectory) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    return runtime.assetDirectory;
  }

  private async storeInsertedImage(
    runtime: MarkdownSessionRuntime,
    input: {
      readonly name: string;
      readonly mediaType: Parameters<
        typeof markdownImageExtensionFromMediaType
      >[0];
      readonly data: string;
    },
  ): Promise<string> {
    const assetDirectory = this.requireAssetDirectory(runtime);
    const bytes = Buffer.from(input.data, 'base64');
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MARKDOWN_MAX_IMAGE_BYTES
    ) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
    const extension = markdownImageExtensionFromMediaType(
      input.mediaType,
    );
    const baseName = this.sanitizeImageBaseName(input.name);
    const imageDirectory = join(
      assetDirectory,
      MARKDOWN_IMAGE_DIRECTORY,
    );
    await this.imageFileSystem.mkdir(imageDirectory);
    const storedName = await this.nextAvailableImageName(
      imageDirectory,
      baseName,
      extension,
    );
    await this.imageFileSystem.writeFile(
      join(imageDirectory, storedName),
      bytes,
    );
    return `${MARKDOWN_IMAGE_DIRECTORY}/${storedName}`;
  }

  private async readStoredImage(
    runtime: MarkdownSessionRuntime,
    relativePath: string,
  ): Promise<string> {
    const assetDirectory = this.requireAssetDirectory(runtime);
    const absolutePath = this.resolveImageUnderDirectory(
      assetDirectory,
      relativePath,
    );
    const mediaType = markdownImageMediaTypeFromName(relativePath);
    if (!mediaType) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
    const bytes = await this.imageFileSystem.readFile(absolutePath);
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MARKDOWN_MAX_IMAGE_BYTES
    ) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
    return `data:${mediaType};base64,${bytes.toString('base64')}`;
  }

  private resolveImageUnderDirectory(
    assetDirectory: string,
    relativePath: string,
  ): string {
    const decodedSegments = relativePath
      .split('/')
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });
    const root = resolve(assetDirectory);
    const candidate = resolve(root, ...decodedSegments);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
    return candidate;
  }

  private sanitizeImageBaseName(name: string): string {
    const withoutExtension = name.replace(/\.[^.]+$/u, '');
    const normalized = basename(withoutExtension)
      .split('')
      .filter(
        (character) =>
          !'<>:"/\\|?*'.includes(character) &&
          character.charCodeAt(0) >= 32,
      )
      .join('')
      .replace(/[. ]+$/gu, '')
      .trim();
    const base = Array.from(normalized).slice(0, 80).join('').trim();
    return base.length > 0 ? base : 'image';
  }

  private async nextAvailableImageName(
    directory: string,
    baseName: string,
    extension: string,
  ): Promise<string> {
    const exists = async (candidate: string) => {
      try {
        await this.imageFileSystem.readFile(join(directory, candidate));
        return true;
      } catch {
        return false;
      }
    };
    const first = `${baseName}${extension}`;
    if (!(await exists(first))) {
      return first;
    }
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${baseName}-${index}${extension}`;
      if (!(await exists(candidate))) {
        return candidate;
      }
    }
    throw new AppError('INVALID_IPC_REQUEST');
  }

  private readState(
    record: WorkbenchStateRecord | undefined,
  ): MarkdownWorkbenchStateV1 {
    if (
      !record ||
      record.workbenchId !== MARKDOWN_WORKBENCH_ID ||
      record.schemaVersion !== MARKDOWN_STATE_SCHEMA_VERSION ||
      !isMarkdownWorkbenchStateV1(record.payload)
    ) {
      return cloneMarkdownWorkbenchViewState(
        DEFAULT_MARKDOWN_WORKBENCH_STATE,
      );
    }

    return {
      ...cloneMarkdownWorkbenchViewState(record.payload),
      recovery: record.payload.recovery,
    };
  }

  private createSyncResult(
    runtime: MarkdownSessionRuntime,
  ): WorkbenchCommandResult {
    return createResult({
      accepted: true,
      dirty: this.isDirty(runtime.document),
      documentVersion: runtime.document.documentVersion,
    });
  }

  private createSaveResult(
    result: WriteTextContentResult,
  ): WorkbenchCommandResult {
    return createResult({
      revision: result.revision,
      savedTime: this.now(),
    });
  }

  private isDirty(document: MarkdownDocumentRuntime): boolean {
    return (
      document.workingBuffer !== document.source.content ||
      document.currentLineEnding !== document.source.lineEnding
    );
  }

  private async scheduleRecovery(
    document: MarkdownDocumentRuntime,
    viewState: MarkdownWorkbenchViewState,
  ): Promise<void> {
    this.cancelScheduledRecovery(document);

    if (!this.isDirty(document)) {
      if (document.recovery) {
        document.recovery = undefined;
        await this.clearRecovery(document.assetId, viewState);
      }
      return;
    }

    document.recoveryTimer = setTimeout(() => {
      document.recoveryTimer = undefined;
      const recoveryTask = document.recoveryTask.then(async () => {
        await this.persistRecovery(document, viewState);
      });
      document.recoveryTask = recoveryTask.catch((error: unknown) => {
        console.error('Markdown Workbench 自动恢复快照保存失败', error);
      });
    }, this.recoveryDebounceMs);
  }

  private cancelScheduledRecovery(document: MarkdownDocumentRuntime): void {
    if (document.recoveryTimer !== undefined) {
      clearTimeout(document.recoveryTimer);
      document.recoveryTimer = undefined;
    }
  }

  private async waitForRecovery(
    document: MarkdownDocumentRuntime,
  ): Promise<void> {
    await document.recoveryTask;
  }

  private async persistRecovery(
    document: MarkdownDocumentRuntime,
    viewState: MarkdownWorkbenchViewState,
  ): Promise<number> {
    if (!this.isDirty(document)) {
      document.recovery = undefined;
      await this.clearRecovery(document.assetId, viewState);
      return this.now();
    }

    const updatedTime = this.now();
    const recovery: MarkdownRecoveryState = {
      dataKey: MARKDOWN_RECOVERY_DATA_KEY,
      baseRevision: document.source.revision,
      encoding: document.source.encoding,
      lineEnding: document.currentLineEnding,
      hasByteOrderMark: document.source.hasByteOrderMark,
      editedFrom: document.lastEditMode,
      updatedTime,
    };

    await this.dataDatabase.save({
      assetId: document.assetId,
      workbenchId: MARKDOWN_WORKBENCH_ID,
      dataKey: MARKDOWN_RECOVERY_DATA_KEY,
      data: new TextEncoder().encode(document.workingBuffer),
      updatedTime,
    });
    document.recovery = recovery;
    await this.saveState(document.assetId, { ...viewState, recovery });
    return updatedTime;
  }

  private async saveSource(
    document: MarkdownDocumentRuntime,
    viewState: MarkdownWorkbenchViewState,
  ): Promise<WriteTextContentResult> {
    // Saves share one queue per Asset. Two viewport shortcuts therefore
    // coalesce into one physical write; the follower observes the committed
    // source rather than racing the same expectedRevision.
    const task = document.writeTask
      .catch(() => undefined)
      .then(() => this.saveSourceNow(document, viewState));
    document.writeTask = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async saveSourceNow(
    document: MarkdownDocumentRuntime,
    viewState: MarkdownWorkbenchViewState,
  ): Promise<WriteTextContentResult> {
    if (!this.isDirty(document)) {
      document.recovery = undefined;
      await this.clearRecovery(document.assetId, viewState);
      return { revision: document.source.revision };
    }

    // A write is asynchronous.  Freeze both the buffer and its source basis so
    // a sync arriving while the handle is writing cannot be mistaken for disk
    // content when the promise resolves.
    const submittedContent = document.workingBuffer;
    const submittedLineEnding = document.currentLineEnding;
    const submittedSource = document.source;
    const submittedVersion = document.documentVersion;
    const result = await this.textContentAdapter.write(document.handle, {
      content: submittedContent,
      encoding: submittedSource.encoding,
      lineEnding: submittedLineEnding,
      hasByteOrderMark: submittedSource.hasByteOrderMark,
      expectedRevision: submittedSource.revision,
    });
    document.source = {
      ...submittedSource,
      content: submittedContent,
      lineEnding: submittedLineEnding,
      revision: result.revision,
    };
    // A disk commit is a distinct observable document transition. Peers need
    // it even when the text did not change, otherwise they retain a dirty
    // baseline and discard the event by version.
    document.documentVersion += 1;
    if (this.isDirty(document)) {
      // New input landed during the write.  It remains dirty relative to the
      // committed snapshot and must survive close/restart.
      await this.scheduleRecovery(document, viewState);
    } else {
      document.recovery = undefined;
      await this.clearRecovery(document.assetId, viewState);
    }
    // A newer shared edit can arrive during the write.  Never collapse it
    // into the submitted source snapshot; it remains dirty and recoverable.
    if (document.documentVersion !== submittedVersion) {
      await this.scheduleRecovery(document, viewState);
    }
    this.publishDocumentChange(document);
    return result;
  }

  private async removeInvalidRecovery(
    assetId: string,
    state: MarkdownWorkbenchStateV1,
  ): Promise<MarkdownWorkbenchStateV1> {
    const nextState = cloneMarkdownWorkbenchViewState(state);
    await this.clearRecovery(assetId, nextState);
    return nextState;
  }

  private async clearRecovery(
    assetId: string,
    viewState: MarkdownWorkbenchViewState,
  ): Promise<void> {
    await this.dataDatabase.delete(
      assetId,
      MARKDOWN_WORKBENCH_ID,
      MARKDOWN_RECOVERY_DATA_KEY,
    );
    await this.saveState(assetId, viewState);
  }

  private async saveCurrentState(
    runtime: MarkdownSessionRuntime,
  ): Promise<void> {
    await this.saveState(runtime.assetId, {
      ...runtime.viewState,
      ...(runtime.document.recovery
        ? { recovery: runtime.document.recovery }
        : {}),
    });
  }

  private async saveState(
    assetId: string,
    state: MarkdownWorkbenchStateV1,
  ): Promise<void> {
    await this.stateDatabase.save({
      assetId,
      workbenchId: MARKDOWN_WORKBENCH_ID,
      schemaVersion: MARKDOWN_STATE_SCHEMA_VERSION,
      payload: toJsonState(state),
      updatedTime: this.now(),
    });
  }
}
