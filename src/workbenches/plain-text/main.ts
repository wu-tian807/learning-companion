import type {
  ResolvedTextContent,
  WriteTextContentResult,
} from '../../main/content/content-handle';
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
  isPlainTextBufferPayload,
  isPlainTextViewStatePayload,
  isPlainTextWorkbenchStateV1,
  PLAIN_TEXT_RECOVERY_DATA_KEY,
  PLAIN_TEXT_STATE_SCHEMA_VERSION,
  PLAIN_TEXT_WORKBENCH_ID,
  plainTextCommands,
  plainTextWorkbenchManifest,
  type PlainTextRecoveryState,
  type PlainTextViewState,
  type PlainTextWorkbenchStateV1,
} from './shared';

interface PlainTextSessionRuntime {
  readonly assetId: string;
  readonly handle: NonNullable<
    Parameters<MainWorkbenchProvider['open']>[0]['content']['handle']
  >;
  source: ResolvedTextContent;
  bufferContent: string;
  viewState: PlainTextViewState | undefined;
  recovery: PlainTextRecoveryState | undefined;
  recoveryTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface PlainTextWorkbenchProviderDependencies {
  readonly now: () => number;
}

function toJsonState(state: PlainTextWorkbenchStateV1): JsonValue {
  const payload: {
    viewState?: JsonValue;
    recovery?: JsonValue;
  } = {};

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

  constructor(
    private readonly stateRepository: WorkbenchStateRepository,
    private readonly dataRepository: WorkbenchStateDataRepository,
    dependencies: Partial<PlainTextWorkbenchProviderDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    const handle = context.content.handle;

    if (
      context.selectionReason !== 'matched' ||
      !handle?.readText ||
      !handle.writeText
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    if (this.sessions.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    const source = await handle.readText();
    let state = this.readState(context.state);
    let recoveryContent: string | undefined;

    if (state.recovery) {
      const data = await this.dataRepository.get(
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
        };
        await this.saveState(context.asset.id, state);
      }
    }

    if (recoveryContent === source.content) {
      await this.clearRecovery(context.asset.id, state.viewState);
      state = { viewState: state.viewState };
      recoveryContent = undefined;
    }

    this.sessions.set(context.sessionId, {
      assetId: context.asset.id,
      handle,
      source,
      bufferContent: source.content,
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
        this.updateRuntime(runtime, payload.content, payload.viewState);
        this.scheduleRecovery(runtime);
        return createResult({ accepted: true });
      }
      case plainTextCommands.backup: {
        const payload = this.requireBufferPayload(command.payload);
        this.updateRuntime(runtime, payload.content, payload.viewState);
        this.cancelScheduledRecovery(runtime);
        const backedUpTime = await this.persistRecovery(runtime);
        return createResult({ backedUpTime });
      }
      case plainTextCommands.save: {
        const payload = this.requireBufferPayload(command.payload);
        this.updateRuntime(runtime, payload.content, payload.viewState);
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
          recovery: runtime.recovery,
        });
        return createResult({ saved: true });
      }
      case plainTextCommands.discardRecovery: {
        this.cancelScheduledRecovery(runtime);
        runtime.recovery = undefined;
        runtime.bufferContent = runtime.source.content;
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
      if (runtime.bufferContent !== runtime.source.content) {
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
  ): PlainTextWorkbenchStateV1 {
    if (
      !record ||
      record.workbenchId !== PLAIN_TEXT_WORKBENCH_ID ||
      record.schemaVersion !== PLAIN_TEXT_STATE_SCHEMA_VERSION ||
      !isPlainTextWorkbenchStateV1(record.payload)
    ) {
      return {};
    }

    return record.payload;
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
    viewState: PlainTextViewState,
  ): void {
    runtime.bufferContent = content;
    runtime.viewState = viewState;
  }

  private scheduleRecovery(runtime: PlainTextSessionRuntime): void {
    this.cancelScheduledRecovery(runtime);

    if (runtime.bufferContent === runtime.source.content) {
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
    if (runtime.bufferContent === runtime.source.content) {
      runtime.recovery = undefined;
      await this.clearRecovery(runtime.assetId, runtime.viewState);
      return this.now();
    }

    const updatedTime = this.now();
    const recovery: PlainTextRecoveryState = {
      dataKey: PLAIN_TEXT_RECOVERY_DATA_KEY,
      baseRevision: runtime.source.revision,
      encoding: runtime.source.encoding,
      lineEnding: runtime.source.lineEnding,
      hasByteOrderMark: runtime.source.hasByteOrderMark,
      updatedTime,
    };

    await this.dataRepository.save({
      assetId: runtime.assetId,
      workbenchId: PLAIN_TEXT_WORKBENCH_ID,
      dataKey: PLAIN_TEXT_RECOVERY_DATA_KEY,
      data: new TextEncoder().encode(runtime.bufferContent),
      updatedTime,
    });
    await this.saveState(runtime.assetId, {
      viewState: runtime.viewState,
      recovery,
    });
    runtime.recovery = recovery;
    return updatedTime;
  }

  private async saveSource(
    runtime: PlainTextSessionRuntime,
  ): Promise<WriteTextContentResult> {
    const writeText = runtime.handle.writeText;

    if (!writeText) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const result = await writeText.call(runtime.handle, {
      content: runtime.bufferContent,
      encoding: runtime.source.encoding,
      lineEnding: runtime.source.lineEnding,
      hasByteOrderMark: runtime.source.hasByteOrderMark,
      expectedRevision: runtime.source.revision,
    });
    runtime.source = {
      ...runtime.source,
      content: runtime.bufferContent,
      revision: result.revision,
    };
    runtime.recovery = undefined;
    await this.clearRecovery(runtime.assetId, runtime.viewState);
    return result;
  }

  private async clearRecovery(
    assetId: string,
    viewState: PlainTextViewState | undefined,
  ): Promise<void> {
    await this.dataRepository.delete(
      assetId,
      PLAIN_TEXT_WORKBENCH_ID,
      PLAIN_TEXT_RECOVERY_DATA_KEY,
    );
    await this.saveState(assetId, { viewState });
  }

  private async saveState(
    assetId: string,
    state: PlainTextWorkbenchStateV1,
  ): Promise<void> {
    await this.stateRepository.save({
      assetId,
      workbenchId: PLAIN_TEXT_WORKBENCH_ID,
      schemaVersion: PLAIN_TEXT_STATE_SCHEMA_VERSION,
      payload: toJsonState(state),
      updatedTime: this.now(),
    });
  }
}
