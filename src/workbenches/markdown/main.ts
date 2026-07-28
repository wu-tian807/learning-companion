import {
  DefaultTextContentAdapter,
  type ResolvedTextContent,
  type TextContentAdapter,
  type WriteTextContentResult,
} from '../../main/content/text-content';
import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type { WorkbenchStateDataRepository } from '../../main/workbench/workbench-state-data-repository';
import type {
  WorkbenchStateRecord,
  WorkbenchStateRepository,
} from '../../main/workbench/workbench-state-repository';
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
  isMarkdownSaveNormalizedPayload,
  isMarkdownSourceBufferPayload,
  isMarkdownWorkbenchStateV1,
  isMarkdownWorkbenchViewStatePayload,
  isMarkdownWysiwygBufferPayload,
  MARKDOWN_RECOVERY_DATA_KEY,
  MARKDOWN_STATE_SCHEMA_VERSION,
  MARKDOWN_WORKBENCH_ID,
  markdownCommands,
  markdownWorkbenchManifest,
  type MarkdownEditMode,
  type MarkdownLineEnding,
  type MarkdownNormalizationState,
  type MarkdownRecoveryState,
  type MarkdownWorkbenchStateV1,
  type MarkdownWorkbenchViewState,
} from './shared';

const RECOVERY_DEBOUNCE_MS = 800;

interface MarkdownSessionRuntime {
  readonly assetId: string;
  readonly handle: NonNullable<
    Parameters<MainWorkbenchProvider['open']>[0]['content']['handle']
  >;
  source: ResolvedTextContent;
  workingBuffer: string;
  currentLineEnding: MarkdownLineEnding;
  lastEditMode: MarkdownEditMode;
  normalizationState: MarkdownNormalizationState;
  viewState: MarkdownWorkbenchViewState;
  recovery: MarkdownRecoveryState | undefined;
  recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  recoveryTask: Promise<void>;
}

export interface MarkdownWorkbenchProviderDependencies {
  readonly now: () => number;
  readonly textContentAdapter: TextContentAdapter;
  readonly recoveryDebounceMs: number;
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
    normalizationPending: recovery.normalizationPending,
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
  private readonly now: () => number;
  private readonly textContentAdapter: TextContentAdapter;
  private readonly recoveryDebounceMs: number;

  constructor(
    private readonly stateRepository: WorkbenchStateRepository,
    private readonly dataRepository: WorkbenchStateDataRepository,
    dependencies: Partial<MarkdownWorkbenchProviderDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.textContentAdapter =
      dependencies.textContentAdapter ?? new DefaultTextContentAdapter();
    this.recoveryDebounceMs =
      dependencies.recoveryDebounceMs ?? RECOVERY_DEBOUNCE_MS;
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

    const source = await this.textContentAdapter.read(handle);

    if (!isMarkdownEncoding(source.encoding)) {
      throw new AppError('CONTENT_ENCODING_UNSUPPORTED');
    }

    let state = this.readState(context.state);
    let recoveryContent: string | undefined;

    if (state.recovery) {
      const data = await this.dataRepository.get(
        context.asset.id,
        MARKDOWN_WORKBENCH_ID,
        state.recovery.dataKey,
      );

      if (data) {
        try {
          recoveryContent = new TextDecoder('utf-8', {
            fatal: true,
          }).decode(data.data);
        } catch {
          state = await this.removeInvalidRecovery(
            context.asset.id,
            state,
          );
        }
      } else {
        state = await this.removeInvalidRecovery(context.asset.id, state);
      }
    }

    if (
      recoveryContent === source.content &&
      state.recovery?.encoding === source.encoding &&
      state.recovery.lineEnding === source.lineEnding &&
      state.recovery.hasByteOrderMark === source.hasByteOrderMark
    ) {
      state = await this.removeInvalidRecovery(context.asset.id, state);
      recoveryContent = undefined;
    }

    const viewState = cloneMarkdownWorkbenchViewState(state);
    this.sessions.set(context.sessionId, {
      assetId: context.asset.id,
      handle,
      source,
      workingBuffer: source.content,
      currentLineEnding: source.lineEnding,
      lastEditMode: viewState.viewMode,
      normalizationState: 'clean',
      viewState,
      recovery: state.recovery,
      recoveryTimer: undefined,
      recoveryTask: Promise.resolve(),
    });

    return {
      payload: {
        diskSource: source.content,
        encoding: source.encoding,
        lineEnding: source.lineEnding,
        hasByteOrderMark: source.hasByteOrderMark,
        revision: source.revision,
        state: viewState,
        ...(state.recovery && recoveryContent !== undefined
          ? {
              recovery: {
                content: recoveryContent,
                baseRevision: state.recovery.baseRevision,
                encoding: state.recovery.encoding,
                lineEnding: state.recovery.lineEnding,
                hasByteOrderMark: state.recovery.hasByteOrderMark,
                editedFrom: state.recovery.editedFrom,
                normalizationPending:
                  state.recovery.normalizationPending,
                updatedTime: state.recovery.updatedTime,
                sourceChanged:
                  state.recovery.baseRevision !== source.revision,
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
    this.validateCommand(command);
    this.cancelScheduledRecovery(runtime);
    await this.waitForRecovery(runtime);

    switch (command.type) {
      case markdownCommands.syncSourceBuffer: {
        if (!isMarkdownSourceBufferPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        runtime.workingBuffer = command.payload.content;
        runtime.currentLineEnding = command.payload.lineEnding;
        runtime.lastEditMode = 'source';
        runtime.viewState = {
          ...runtime.viewState,
          viewMode: 'source',
          sourceViewState: command.payload.sourceViewState,
        };
        await this.scheduleRecovery(runtime);
        return this.createSyncResult(runtime);
      }
      case markdownCommands.syncWysiwygBuffer: {
        if (!isMarkdownWysiwygBufferPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        runtime.workingBuffer = command.payload.content;
        runtime.currentLineEnding = command.payload.lineEnding;
        runtime.lastEditMode = 'wysiwyg';
        runtime.normalizationState = 'requires-confirmation';
        runtime.viewState = {
          ...runtime.viewState,
          viewMode: 'wysiwyg',
          wysiwygScrollTop: command.payload.wysiwygScrollTop,
        };
        await this.scheduleRecovery(runtime);
        return this.createSyncResult(runtime);
      }
      case markdownCommands.backup: {
        if (command.payload !== undefined) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        this.cancelScheduledRecovery(runtime);
        return createResult({
          backedUpTime: await this.persistRecovery(runtime),
        });
      }
      case markdownCommands.save: {
        if (command.payload !== undefined) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        if (
          this.isDirty(runtime) &&
          runtime.normalizationState === 'requires-confirmation'
        ) {
          await this.scheduleRecovery(runtime);
          throw new AppError(
            'MARKDOWN_NORMALIZATION_REVIEW_REQUIRED',
          );
        }

        try {
          return this.createSaveResult(await this.saveSource(runtime));
        } catch (error) {
          await this.scheduleRecovery(runtime);
          throw error;
        }
      }
      case markdownCommands.saveNormalized: {
        if (!isMarkdownSaveNormalizedPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        try {
          return this.createSaveResult(await this.saveSource(runtime));
        } catch (error) {
          await this.scheduleRecovery(runtime);
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
        if (this.isDirty(runtime)) {
          await this.scheduleRecovery(runtime);
        }
        return createResult({ saved: true, savedTime: this.now() });
      }
      case markdownCommands.setLineEnding: {
        if (!isMarkdownLineEndingPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        runtime.currentLineEnding = command.payload.lineEnding;
        await this.scheduleRecovery(runtime);
        return createResult({
          lineEnding: runtime.currentLineEnding,
          dirty: this.isDirty(runtime),
        });
      }
      case markdownCommands.reopenWithEncoding: {
        if (!isMarkdownEncodingPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }

        if (this.isDirty(runtime) || runtime.recovery) {
          if (this.isDirty(runtime)) {
            await this.scheduleRecovery(runtime);
          }
          throw new AppError('CONTENT_HAS_UNSAVED_CHANGES');
        }

        const source = await this.textContentAdapter.read(runtime.handle, {
          encoding: command.payload.encoding,
        });

        if (!isMarkdownEncoding(source.encoding)) {
          throw new AppError('CONTENT_ENCODING_UNSUPPORTED');
        }

        runtime.source = source;
        runtime.workingBuffer = source.content;
        runtime.currentLineEnding = source.lineEnding;
        runtime.normalizationState = 'clean';

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

        this.cancelScheduledRecovery(runtime);
        runtime.workingBuffer = runtime.source.content;
        runtime.currentLineEnding = runtime.source.lineEnding;
        runtime.lastEditMode = runtime.viewState.viewMode;
        runtime.normalizationState = 'clean';
        runtime.recovery = undefined;
        await this.clearRecovery(runtime.assetId, runtime.viewState);
        return createResult({ discarded: true });
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
      this.cancelScheduledRecovery(runtime);
      await this.waitForRecovery(runtime);
      if (this.isDirty(runtime)) {
        await this.persistRecovery(runtime);
      }
    } finally {
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
      case markdownCommands.saveNormalized:
        if (!isMarkdownSaveNormalizedPayload(command.payload)) {
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
      default:
        throw new AppError('FEATURE_NOT_SUPPORTED');
    }
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
      dirty: this.isDirty(runtime),
      normalizationState: runtime.normalizationState,
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

  private isDirty(runtime: MarkdownSessionRuntime): boolean {
    return (
      runtime.workingBuffer !== runtime.source.content ||
      runtime.currentLineEnding !== runtime.source.lineEnding
    );
  }

  private async scheduleRecovery(
    runtime: MarkdownSessionRuntime,
  ): Promise<void> {
    this.cancelScheduledRecovery(runtime);

    if (!this.isDirty(runtime)) {
      runtime.normalizationState = 'clean';
      if (runtime.recovery) {
        runtime.recovery = undefined;
        await this.clearRecovery(runtime.assetId, runtime.viewState);
      }
      return;
    }

    runtime.recoveryTimer = setTimeout(() => {
      runtime.recoveryTimer = undefined;
      const recoveryTask = runtime.recoveryTask.then(async () => {
        await this.persistRecovery(runtime);
      });
      runtime.recoveryTask = recoveryTask.catch((error: unknown) => {
        console.error('Markdown Workbench 自动恢复快照保存失败', error);
      });
    }, this.recoveryDebounceMs);
  }

  private cancelScheduledRecovery(runtime: MarkdownSessionRuntime): void {
    if (runtime.recoveryTimer !== undefined) {
      clearTimeout(runtime.recoveryTimer);
      runtime.recoveryTimer = undefined;
    }
  }

  private async waitForRecovery(
    runtime: MarkdownSessionRuntime,
  ): Promise<void> {
    await runtime.recoveryTask;
  }

  private async persistRecovery(
    runtime: MarkdownSessionRuntime,
  ): Promise<number> {
    if (!this.isDirty(runtime)) {
      runtime.normalizationState = 'clean';
      runtime.recovery = undefined;
      await this.clearRecovery(runtime.assetId, runtime.viewState);
      return this.now();
    }

    const updatedTime = this.now();
    const recovery: MarkdownRecoveryState = {
      dataKey: MARKDOWN_RECOVERY_DATA_KEY,
      baseRevision: runtime.source.revision,
      encoding: runtime.source.encoding,
      lineEnding: runtime.currentLineEnding,
      hasByteOrderMark: runtime.source.hasByteOrderMark,
      editedFrom: runtime.lastEditMode,
      normalizationPending:
        runtime.normalizationState === 'requires-confirmation',
      updatedTime,
    };

    await this.dataRepository.save({
      assetId: runtime.assetId,
      workbenchId: MARKDOWN_WORKBENCH_ID,
      dataKey: MARKDOWN_RECOVERY_DATA_KEY,
      data: new TextEncoder().encode(runtime.workingBuffer),
      updatedTime,
    });
    runtime.recovery = recovery;
    await this.saveCurrentState(runtime);
    return updatedTime;
  }

  private async saveSource(
    runtime: MarkdownSessionRuntime,
  ): Promise<WriteTextContentResult> {
    if (!this.isDirty(runtime)) {
      runtime.normalizationState = 'clean';
      runtime.recovery = undefined;
      await this.clearRecovery(runtime.assetId, runtime.viewState);
      return { revision: runtime.source.revision };
    }

    const result = await this.textContentAdapter.write(runtime.handle, {
      content: runtime.workingBuffer,
      encoding: runtime.source.encoding,
      lineEnding: runtime.currentLineEnding,
      hasByteOrderMark: runtime.source.hasByteOrderMark,
      expectedRevision: runtime.source.revision,
    });
    runtime.source = {
      ...runtime.source,
      content: runtime.workingBuffer,
      lineEnding: runtime.currentLineEnding,
      revision: result.revision,
    };
    runtime.normalizationState = 'clean';
    runtime.recovery = undefined;
    await this.clearRecovery(runtime.assetId, runtime.viewState);
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
    await this.dataRepository.delete(
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
      recovery: runtime.recovery,
    });
  }

  private async saveState(
    assetId: string,
    state: MarkdownWorkbenchStateV1,
  ): Promise<void> {
    await this.stateRepository.save({
      assetId,
      workbenchId: MARKDOWN_WORKBENCH_ID,
      schemaVersion: MARKDOWN_STATE_SCHEMA_VERSION,
      payload: toJsonState(state),
      updatedTime: this.now(),
    });
  }
}
