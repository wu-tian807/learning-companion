import { isAgentProviderId } from '../../../shared/agent-providers';
import { AppError } from '../../errors/app-error';
import {
  requireAgentWorkspaceKey,
  requireAgentWorkspacePathSegment,
} from '../workspaces/agent-workspace-paths';

export interface AgentSessionLocator {
  readonly projectId: string;
  readonly workspaceKey: string;
  readonly instanceKey: string;
}

export interface AgentProviderSessionBinding {
  readonly sessionId: string;
  readonly configurationFingerprint: string;
  readonly createdTime: number;
}

export interface AgentSessionSnapshot {
  readonly locator: AgentSessionLocator;
  readonly providerBindings: Readonly<
    Record<string, AgentProviderSessionBinding>
  >;
  readonly createdTime: number;
  readonly updatedTime: number;
}

export interface BindAgentProviderSessionInput {
  readonly providerId: string;
  readonly sessionId: string;
  readonly configurationFingerprint: string;
  readonly updatedTime: number;
}

export interface ReplaceAgentProviderSessionInput
  extends BindAgentProviderSessionInput {
  readonly expectedSessionId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integrityError(cause?: unknown): AppError {
  return new AppError('DATA_INTEGRITY_ERROR',
    cause === undefined ? undefined : { cause });
}

function requireText(
  value: unknown,
  maximumLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value
  ) {
    throw integrityError();
  }

  return value;
}

function requireTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw integrityError();
  }

  return value as number;
}

export function createAgentSessionLocator(input: {
  readonly projectId: string;
  readonly workspaceKey: string;
  readonly instanceKey: string;
}): AgentSessionLocator {
  try {
    if (!isRecord(input)) {
      throw integrityError();
    }

    const workspaceKey = requireAgentWorkspaceKey(input.workspaceKey);

    if (workspaceKey !== input.workspaceKey) {
      throw integrityError();
    }

    return Object.freeze({
      projectId: requireText(input.projectId, 256),
      workspaceKey,
      instanceKey: requireAgentWorkspacePathSegment(input.instanceKey),
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw integrityError(error);
  }
}

export function areAgentSessionLocatorsEqual(
  left: AgentSessionLocator,
  right: AgentSessionLocator,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.workspaceKey === right.workspaceKey &&
    left.instanceKey === right.instanceKey
  );
}

function cloneProviderBinding(
  value: unknown,
): AgentProviderSessionBinding {
  if (!isRecord(value)) {
    throw integrityError();
  }

  const createdTime = requireTimestamp(value.createdTime);

  return Object.freeze({
    sessionId: requireText(value.sessionId, 4096),
    configurationFingerprint: requireText(
      value.configurationFingerprint,
      1024,
    ),
    createdTime,
  });
}

export function cloneAgentSessionSnapshot(
  value: AgentSessionSnapshot,
): AgentSessionSnapshot {
  if (
    !isRecord(value) ||
    !isRecord(value.locator) ||
    !isRecord(value.providerBindings)
  ) {
    throw integrityError();
  }

  const locator = createAgentSessionLocator(
    value.locator as AgentSessionLocator,
  );
  const createdTime = requireTimestamp(value.createdTime);
  const updatedTime = requireTimestamp(value.updatedTime);

  if (updatedTime < createdTime) {
    throw integrityError();
  }

  const entries = Object.entries(value.providerBindings).map(
    ([providerId, binding]) => {
      if (!isAgentProviderId(providerId)) {
        throw integrityError();
      }

      const cloned = cloneProviderBinding(binding);

      if (
        cloned.createdTime < createdTime ||
        cloned.createdTime > updatedTime
      ) {
        throw integrityError();
      }

      return [providerId, cloned] as const;
    },
  );

  return Object.freeze({
    locator,
    providerBindings: Object.freeze(Object.fromEntries(entries)),
    createdTime,
    updatedTime,
  });
}

interface NormalizedAgentProviderSessionInput {
  readonly providerId: string;
  readonly sessionId: string;
  readonly configurationFingerprint: string;
  readonly updatedTime: number;
}

function requireProviderInput(
  input: BindAgentProviderSessionInput,
): NormalizedAgentProviderSessionInput {
  if (!isAgentProviderId(input.providerId)) {
    throw integrityError();
  }

  return Object.freeze({
    providerId: input.providerId,
    sessionId: requireText(input.sessionId, 4096),
    configurationFingerprint: requireText(
      input.configurationFingerprint,
      1024,
    ),
    updatedTime: requireTimestamp(input.updatedTime),
  });
}

export class AgentSession {
  private snapshot: AgentSessionSnapshot;

  constructor(snapshot: AgentSessionSnapshot) {
    this.snapshot = cloneAgentSessionSnapshot(snapshot);
  }

  static create(
    locator: AgentSessionLocator,
    createdTime: number,
  ): AgentSession {
    return new AgentSession({
      locator,
      providerBindings: {},
      createdTime,
      updatedTime: createdTime,
    });
  }

  getSnapshot(): AgentSessionSnapshot {
    return cloneAgentSessionSnapshot(this.snapshot);
  }

  getProviderBinding(
    providerId: string,
  ): AgentProviderSessionBinding | undefined {
    if (!isAgentProviderId(providerId)) {
      throw integrityError();
    }

    const binding = Object.hasOwn(
      this.snapshot.providerBindings,
      providerId,
    )
      ? this.snapshot.providerBindings[providerId]
      : undefined;
    return binding ? cloneProviderBinding(binding) : undefined;
  }

  bindProvider(input: BindAgentProviderSessionInput): boolean {
    const normalized = requireProviderInput(input);
    const existing = Object.hasOwn(
      this.snapshot.providerBindings,
      normalized.providerId,
    )
      ? this.snapshot.providerBindings[normalized.providerId]
      : undefined;

    if (existing) {
      if (
        existing.sessionId === normalized.sessionId &&
        existing.configurationFingerprint ===
          normalized.configurationFingerprint
      ) {
        return false;
      }

      throw new AppError('AGENT_SESSION_CONFLICT');
    }

    this.requireTransitionTime(normalized.updatedTime);
    this.replaceBinding(normalized.providerId, {
      sessionId: normalized.sessionId,
      configurationFingerprint: normalized.configurationFingerprint,
      createdTime: normalized.updatedTime,
    });
    return true;
  }

  replaceProviderBinding(
    input: ReplaceAgentProviderSessionInput,
  ): boolean {
    const normalized = requireProviderInput(input);
    const expectedSessionId = requireText(input.expectedSessionId, 4096);
    const existing = Object.hasOwn(
      this.snapshot.providerBindings,
      normalized.providerId,
    )
      ? this.snapshot.providerBindings[normalized.providerId]
      : undefined;

    if (!existing || existing.sessionId !== expectedSessionId) {
      throw new AppError('AGENT_SESSION_CONFLICT');
    }

    if (existing.sessionId === normalized.sessionId) {
      if (
        existing.configurationFingerprint ===
        normalized.configurationFingerprint
      ) {
        return false;
      }

      throw new AppError('AGENT_SESSION_CONFLICT');
    }

    this.requireTransitionTime(normalized.updatedTime);
    this.replaceBinding(normalized.providerId, {
      sessionId: normalized.sessionId,
      configurationFingerprint: normalized.configurationFingerprint,
      createdTime: normalized.updatedTime,
    });
    return true;
  }

  private requireTransitionTime(updatedTime: number): void {
    if (updatedTime < this.snapshot.updatedTime) {
      throw integrityError();
    }
  }

  private replaceBinding(
    providerId: string,
    binding: AgentProviderSessionBinding,
  ): void {
    this.snapshot = cloneAgentSessionSnapshot({
      ...this.snapshot,
      providerBindings: {
        ...this.snapshot.providerBindings,
        [providerId]: binding,
      },
      updatedTime: binding.createdTime,
    });
  }
}
