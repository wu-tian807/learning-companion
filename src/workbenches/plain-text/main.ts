import {
  DefaultTextContentAdapter,
  type TextContentAdapter,
  type ResolvedTextContent,
  type WriteTextContentResult,
} from '../../main/content/text-content';
import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
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
  DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
  isPlainTextEncoding,
  isPlainTextEncodingPayload,
  isPlainTextBufferPayload,
  isPlainTextLineEndingPayload,
  normalizePlainTextViewOptions,
  isPlainTextViewOptions,
  isPlainTextViewStatePayload,
  isPlainTextWorkbenchStateV1,
  isPlainTextWorkbenchStateV2,
  PLAIN_TEXT_RECOVERY_DATA_KEY,
  PLAIN_TEXT_STATE_SCHEMA_VERSION,
  PLAIN_TEXT_STATE_SCHEMA_VERSION_V1,
  PLAIN_TEXT_WORKBENCH_ID,
  plainTextCommands,
  plainTextWorkbenchManifest,
  type PlainTextRecoveryState,
  type PlainTextLineEnding,
  type PlainTextViewOptions,
  type PlainTextViewState,
  type PlainTextWorkbenchStateV2,
} from './shared';

interface PlainTextSessionRuntime {
  readonly assetId: string;
  readonly handle: NonNullable<
    Parameters<MainWorkbenchProvider['open']>[0]['content']['handle']
  >;
  source: ResolvedTextContent;
  bufferContent: string;
  currentLineEnding: PlainTextLineEnding;
  viewOptions: PlainTextViewOptions;
  viewState: PlainTextViewState | undefined;
  recovery: PlainTextRecoveryState | undefined;
  recoveryTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface PlainTextWorkbenchProviderDependencies {
  readonly now: () => number;
  readonly textContentAdapter: TextContentAdapter;
}

function cloneViewOptions(
  viewOptions: PlainTextViewOptions,
): JsonValue & PlainTextViewOptions {
  return {
    wordWrap: viewOptions.wordWrap,
    lineNumbers: viewOptions.lineNumbers,
    readMode: viewOptions.readMode,
  };
}

function toJsonState(state: PlainTextWorkbenchStateV2): JsonValue {
  const payload: {
    viewOptions: JsonValue;
    viewState?: JsonValue;
    recovery?: JsonValue;
  } = {
    viewOptions: cloneViewOptions(state.viewOptions),
  };

  if (state.viewState) {
    payload.viewState = {
      anchor: state.viewState.anchor,
      head: state.viewState.head,
      scrollTop: state.viewState.scrollTop,
    };
  }

  if (state.recovery) {
    payload.recovery = {
      dataKey: state.recovery.dataKey,
      baseRevision: state.recovery.baseRevision,
      encoding: state.recovery.encoding,
      lineEnding: state.recovery.lineEnding,
      hasByteOrderMark: state.recovery.hasByteOrderMark,
      updatedTime: state.recovery.updatedTime,
    };
  }

  return payload;
}

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

export class PlainTextWorkbenchProvider
  implements MainWorkbenchProvider {
  readonly manifest = plainTextWorkbenchManifest;
  private readonly sessions = new Map<string, PlainTextSessionRuntime>();
  private readonly now: () => number;
  private readonly textContentAdapter: TextContentAdapter;

  constructor(
    private readonly stateDatabase: WorkbenchStateDatabaseApi,
    private readonly dataDatabase: WorkbenchStateDataDatabaseApi,
    dependencies: Partial<PlainTextWorkbenchProviderDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.textContentAdapter =
      dependencies.textContentAdapter ?? new DefaultTextContentAdapter();
  }

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    const handle = context.content.handle;

    if (
      context.selectionReason !== 'matched' ||
      !handle?.readBytes ||
      !handle.writeBytes
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    if (this.sessions.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    const source = await this.textContentAdapter.read(handle);
    let state = this.readState(context.state);
    let recoveryContent: string | undefined;

    if (state.recovery) {
      const data = await this.dataDatabase.get(
        context.asset.id,
        PLAIN_TEXT_WORKBENCH_ID,
        state.recovery.dataKey,
      );

      if (data) {
        recoveryContent = new TextDecoder('utf-8', { fatal: true }).decode(
          data.data,
        );
      } else {
        state = {
          viewState: state.viewState,
          viewOptions: state.viewOptions,
        };
        await this.saveState(context.asset.id, state);
      }
    }

    if (
      recoveryContent === source.content &&
      state.recovery?.encoding === source.encoding &&
      state.recovery.lineEnding === source.lineEnding &&
      state.recovery.hasByteOrderMark === source.hasByteOrderMark
    ) {
      await this.clearRecovery(
        context.asset.id,
        state.viewState,
        state.viewOptions,
      );
      state = {
        viewState: state.viewState,
        viewOptions: state.viewOptions,
      };
      recoveryContent = undefined;
    }

    this.sessions.set(context.sessionId, {
      assetId: context.asset.id,
      handle,
      source,
      bufferContent: source.content,
      currentLineEnding: source.lineEnding,
      viewOptions: state.viewOptions,
      viewState: state.viewState,
      recovery: state.recovery,
      recoveryTimer: undefined,
    });

    return {
      payload: {
        content: source.content,
        encoding: source.encoding,
        lineEnding: source.lineEnding,
        hasByteOrderMark: source.hasByteOrderMark,
        revision: source.revision,
        viewOptions: cloneViewOptions(state.viewOptions),
        ...(state.viewState
          ? {
              viewState: {
                anchor: state.viewState.anchor,
                head: state.viewState.head,
                scrollTop: state.viewState.scrollTop,
              },
            }
          : {}),
        ...(state.recovery && recoveryContent !== undefined
          ? {
              recovery: {
                content: recoveryContent,
                baseRevision: state.recovery.baseRevision,
                encoding: state.recovery.encoding,
                lineEnding: state.recovery.lineEnding,
                hasByteOrderMark: state.recovery.hasByteOrderMark,
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

    switch (command.type) {
      case plainTextCommands.syncBuffer: {
        const payload = this.requireBufferPayload(command.payload);
        this.updateRuntime(
          runtime,
          payload.content,
          payload.lineEnding,
          payload.viewState,
        );
        await this.scheduleRecovery(runtime);
        return createResult({ accepted: true });
      }
      case plainTextCommands.backup: {
        const payload = this.requireBufferPayload(command.payload);
        this.updateRuntime(
          runtime,
          payload.content,
          payload.lineEnding,
          payload.viewState,
        );
        this.cancelScheduledRecovery(runtime);
        const backedUpTime = await this.persistRecovery(runtime);
        return createResult({ backedUpTime });
      }
      case plainTextCommands.save: {
        const payload = this.requireBufferPayload(command.payload);
        this.updateRuntime(
          runtime,
          payload.content,
          payload.lineEnding,
          payload.viewState,
        );
        this.cancelScheduledRecovery(runtime);
        const result = await this.saveSource(runtime);
        return createResult({
          revision: result.revision,
          savedTime: this.now(),
        });
      }
      case plainTextCommands.saveViewState: {
        if (!isPlainTextViewStatePayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        runtime.viewState = command.payload;
        await this.saveState(runtime.assetId, {
          viewState: runtime.viewState,
          viewOptions: runtime.viewOptions,
          recovery: runtime.recovery,
        });
        return createResult({ saved: true });
      }
      case plainTextCommands.setViewOptions: {
        if (!isPlainTextViewOptions(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        runtime.viewOptions = cloneViewOptions(command.payload);
        await this.saveState(runtime.assetId, {
          viewState: runtime.viewState,
          viewOptions: runtime.viewOptions,
          recovery: runtime.recovery,
        });
        return createResult(cloneViewOptions(runtime.viewOptions));
      }
      case plainTextCommands.setLineEnding: {
        if (!isPlainTextLineEndingPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        runtime.currentLineEnding = command.payload.lineEnding;
        await this.scheduleRecovery(runtime);
        return createResult({
          lineEnding: runtime.currentLineEnding,
          dirty: this.isDirty(runtime),
        });
      }
      case plainTextCommands.reopenWithEncoding: {
        if (!isPlainTextEncodingPayload(command.payload)) {
          throw new AppError('INVALID_IPC_REQUEST');
        }
        if (this.isDirty(runtime) || runtime.recovery) {
          throw new AppError('CONTENT_HAS_UNSAVED_CHANGES');
        }

        const source = await this.textContentAdapter.read(runtime.handle, {
          encoding: command.payload.encoding,
        });

        if (!isPlainTextEncoding(source.encoding)) {
          throw new AppError('CONTENT_ENCODING_UNSUPPORTED');
        }

        runtime.source = source;
        runtime.bufferContent = source.content;
        runtime.currentLineEnding = source.lineEnding;

        return createResult({
          content: source.content,
          encoding: source.encoding,
          lineEnding: source.lineEnding,
          hasByteOrderMark: source.hasByteOrderMark,
          revision: source.revision,
        });
      }
      case plainTextCommands.discardRecovery: {
        this.cancelScheduledRecovery(runtime);
        runtime.recovery = undefined;
        runtime.bufferContent = runtime.source.content;
        runtime.currentLineEnding = runtime.source.lineEnding;
        await this.clearRecovery(
          runtime.assetId,
          runtime.viewState,
          runtime.viewOptions,
        );
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
      if (this.isDirty(runtime)) {
        await this.persistRecovery(runtime);
      }
    } finally {
      this.sessions.delete(context.sessionId);
    }
  }

  private findRuntime(sessionId: string): PlainTextSessionRuntime {
    const runtime = this.sessions.get(sessionId);

    if (!runtime) {
      throw new AppError('WORKBENCH_SESSION_NOT_FOUND');
    }

    return runtime;
  }

  private readState(
    record: WorkbenchStateRecord | undefined,
  ): PlainTextWorkbenchStateV2 {
    if (!record || record.workbenchId !== PLAIN_TEXT_WORKBENCH_ID) {
      return {
        viewOptions: cloneViewOptions(DEFAULT_PLAIN_TEXT_VIEW_OPTIONS),
      };
    }

    if (
      record.schemaVersion === PLAIN_TEXT_STATE_SCHEMA_VERSION &&
      isPlainTextWorkbenchStateV2(record.payload)
    ) {
      return {
        viewState: record.payload.viewState,
        viewOptions: cloneViewOptions(record.payload.viewOptions),
        recovery: record.payload.recovery,
      };
    }

    if (record.schemaVersion === PLAIN_TEXT_STATE_SCHEMA_VERSION) {
      const rawPayload = record.payload;
      const payload =
        typeof rawPayload === 'object' &&
        rawPayload !== null &&
        !Array.isArray(rawPayload)
          ? (rawPayload as Record<string, unknown>)
          : undefined;
      const viewOptions = normalizePlainTextViewOptions(
        payload?.viewOptions,
      );
      const candidate = {
        ...payload,
        ...(viewOptions ? { viewOptions } : {}),
      };

      if (
        viewOptions &&
        isPlainTextWorkbenchStateV2(candidate)
      ) {
        return {
          viewState: candidate.viewState,
          viewOptions: cloneViewOptions(viewOptions),
          recovery: candidate.recovery,
        };
      }
    }

    if (
      record.schemaVersion === PLAIN_TEXT_STATE_SCHEMA_VERSION_V1 &&
      isPlainTextWorkbenchStateV1(record.payload)
    ) {
      return {
        viewState: record.payload.viewState,
        viewOptions: cloneViewOptions(DEFAULT_PLAIN_TEXT_VIEW_OPTIONS),
        recovery: record.payload.recovery,
      };
    }

    return {
      viewOptions: cloneViewOptions(DEFAULT_PLAIN_TEXT_VIEW_OPTIONS),
    };
  }

  private requireBufferPayload(
    payload: Parameters<MainWorkbenchProvider['command']>[1]['payload'],
  ) {
    if (!isPlainTextBufferPayload(payload)) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    return payload;
  }

  private updateRuntime(
    runtime: PlainTextSessionRuntime,
    content: string,
    lineEnding: PlainTextLineEnding,
    viewState: PlainTextViewState,
  ): void {
    runtime.bufferContent = content;
    runtime.currentLineEnding = lineEnding;
    runtime.viewState = viewState;
  }

  private isDirty(runtime: PlainTextSessionRuntime): boolean {
    return (
      runtime.bufferContent !== runtime.source.content ||
      runtime.currentLineEnding !== runtime.source.lineEnding
    );
  }

  private async scheduleRecovery(
    runtime: PlainTextSessionRuntime,
  ): Promise<void> {
    this.cancelScheduledRecovery(runtime);

    if (!this.isDirty(runtime)) {
      if (runtime.recovery) {
        runtime.recovery = undefined;
        await this.clearRecovery(
          runtime.assetId,
          runtime.viewState,
          runtime.viewOptions,
        );
      }
      return;
    }

    runtime.recoveryTimer = setTimeout(() => {
      runtime.recoveryTimer = undefined;
      void this.persistRecovery(runtime).catch((error: unknown) => {
        console.error('Plain Text Workbench 自动恢复快照保存失败', error);
      });
    }, 800);
  }

  private cancelScheduledRecovery(runtime: PlainTextSessionRuntime): void {
    if (runtime.recoveryTimer) {
      clearTimeout(runtime.recoveryTimer);
      runtime.recoveryTimer = undefined;
    }
  }

  private async persistRecovery(
    runtime: PlainTextSessionRuntime,
  ): Promise<number> {
    if (!this.isDirty(runtime)) {
      runtime.recovery = undefined;
      await this.clearRecovery(
        runtime.assetId,
        runtime.viewState,
        runtime.viewOptions,
      );
      return this.now();
    }

    const updatedTime = this.now();
    const recovery: PlainTextRecoveryState = {
      dataKey: PLAIN_TEXT_RECOVERY_DATA_KEY,
      baseRevision: runtime.source.revision,
      encoding: runtime.source.encoding,
      lineEnding: runtime.currentLineEnding,
      hasByteOrderMark: runtime.source.hasByteOrderMark,
      updatedTime,
    };

    await this.dataDatabase.save({
      assetId: runtime.assetId,
      workbenchId: PLAIN_TEXT_WORKBENCH_ID,
      dataKey: PLAIN_TEXT_RECOVERY_DATA_KEY,
      data: new TextEncoder().encode(runtime.bufferContent),
      updatedTime,
    });
    await this.saveState(runtime.assetId, {
      viewState: runtime.viewState,
      viewOptions: runtime.viewOptions,
      recovery,
    });
    runtime.recovery = recovery;
    return updatedTime;
  }

  private async saveSource(
    runtime: PlainTextSessionRuntime,
  ): Promise<WriteTextContentResult> {
    const result = await this.textContentAdapter.write(runtime.handle, {
      content: runtime.bufferContent,
      encoding: runtime.source.encoding,
      lineEnding: runtime.currentLineEnding,
      hasByteOrderMark: runtime.source.hasByteOrderMark,
      expectedRevision: runtime.source.revision,
    });
    runtime.source = {
      ...runtime.source,
      content: runtime.bufferContent,
      lineEnding: runtime.currentLineEnding,
      revision: result.revision,
    };
    runtime.recovery = undefined;
    await this.clearRecovery(
      runtime.assetId,
      runtime.viewState,
      runtime.viewOptions,
    );
    return result;
  }

  private async clearRecovery(
    assetId: string,
    viewState: PlainTextViewState | undefined,
    viewOptions: PlainTextViewOptions,
  ): Promise<void> {
    await this.dataDatabase.delete(
      assetId,
      PLAIN_TEXT_WORKBENCH_ID,
      PLAIN_TEXT_RECOVERY_DATA_KEY,
    );
    await this.saveState(assetId, { viewState, viewOptions });
  }

  private async saveState(
    assetId: string,
    state: PlainTextWorkbenchStateV2,
  ): Promise<void> {
    await this.stateDatabase.save({
      assetId,
      workbenchId: PLAIN_TEXT_WORKBENCH_ID,
      schemaVersion: PLAIN_TEXT_STATE_SCHEMA_VERSION,
      payload: toJsonState(state),
      updatedTime: this.now(),
    });
  }
}
