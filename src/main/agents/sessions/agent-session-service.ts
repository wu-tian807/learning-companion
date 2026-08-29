import { isAgentProviderId } from '../../../shared/agent-providers';
import { AppError } from '../../errors/app-error';
import type { ProjectLookup } from '../../projects/project-database';
import {
  AgentSession,
  createAgentSessionLocator,
  type AgentProviderSessionBinding,
  type AgentSessionLocator,
  type AgentSessionSnapshot,
} from './agent-session';
import {
  AgentSessionFile,
  type AgentSessionFileApi,
} from './agent-session-file';

export interface BindAgentSessionProviderRequest {
  readonly locator: AgentSessionLocator;
  readonly providerId: string;
  readonly sessionId: string;
}

export interface ReplaceAgentSessionProviderRequest
  extends BindAgentSessionProviderRequest {
  readonly expectedSessionId: string;
}

export interface AgentSessionProjectLifecycle {
  loadFromProject(projectId: string): void;
  unloadProject(): Promise<void>;
}

export interface AgentSessionServiceApi
  extends AgentSessionProjectLifecycle {
  getActiveProjectId(): string | undefined;
  get(
    locator: AgentSessionLocator,
  ): Promise<AgentSessionSnapshot | undefined>;
  getProviderBinding(
    locator: AgentSessionLocator,
    providerId: string,
  ): Promise<AgentProviderSessionBinding | undefined>;
  bindProvider(
    request: BindAgentSessionProviderRequest,
  ): Promise<AgentProviderSessionBinding>;
  replaceProviderBinding(
    request: ReplaceAgentSessionProviderRequest,
  ): Promise<AgentProviderSessionBinding>;
}

interface AgentSessionServiceDependencies {
  readonly now: () => number;
  readonly createFile: (projectWorkspacePath: string) => AgentSessionFileApi;
}

interface ActiveAgentSessionProject {
  readonly projectId: string;
  readonly file: AgentSessionFileApi;
  readonly token: symbol;
}

const defaultDependencies: AgentSessionServiceDependencies = {
  now: Date.now,
  createFile: (projectWorkspacePath) =>
    new AgentSessionFile(projectWorkspacePath),
};

function requireId(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized !== value) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

function locatorKey(locator: AgentSessionLocator): string {
  return JSON.stringify([
    locator.projectId,
    locator.workspaceKey,
    locator.instanceKey,
  ]);
}

export class AgentSessionService implements AgentSessionServiceApi {
  private readonly dependencies: AgentSessionServiceDependencies;
  private readonly sessions = new Map<string, AgentSession | null>();
  private readonly operationTails = new Map<string, Promise<void>>();
  private activeProject: ActiveAgentSessionProject | undefined;

  constructor(
    private readonly projectLookup: ProjectLookup,
    dependencies: Partial<AgentSessionServiceDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  loadFromProject(projectId: string): void {
    const normalizedProjectId = requireId(projectId);
    const project = this.projectLookup.get(normalizedProjectId);

    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    this.sessions.clear();
    this.activeProject = Object.freeze({
      projectId: normalizedProjectId,
      file: this.dependencies.createFile(project.workspacePath),
      token: Symbol(normalizedProjectId),
    });
  }

  async unloadProject(): Promise<void> {
    this.sessions.clear();
    this.activeProject = undefined;
    await Promise.allSettled(this.operationTails.values());
  }

  getActiveProjectId(): string | undefined {
    return this.activeProject?.projectId;
  }

  async get(
    locator: AgentSessionLocator,
  ): Promise<AgentSessionSnapshot | undefined> {
    const normalized = createAgentSessionLocator(locator);
    const context = this.requireContext(normalized);

    return this.enqueue(context, normalized, async () =>
      (await this.loadSession(context, normalized))?.getSnapshot(),
    );
  }

  async getProviderBinding(
    locator: AgentSessionLocator,
    providerId: string,
  ): Promise<AgentProviderSessionBinding | undefined> {
    if (!isAgentProviderId(providerId)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const normalized = createAgentSessionLocator(locator);
    const context = this.requireContext(normalized);

    return this.enqueue(context, normalized, async () =>
      (await this.loadSession(context, normalized))?.getProviderBinding(
        providerId,
      ),
    );
  }

  async bindProvider(
    request: BindAgentSessionProviderRequest,
  ): Promise<AgentProviderSessionBinding> {
    const locator = createAgentSessionLocator(request.locator);
    const context = this.requireContext(locator);

    return this.enqueue(context, locator, async () => {
      const current = await this.loadSession(context, locator);
      const currentSnapshot = current?.getSnapshot();
      const operationTime = this.nextTimestamp(
        currentSnapshot?.updatedTime,
      );
      const candidate = currentSnapshot
        ? new AgentSession(currentSnapshot)
        : AgentSession.create(locator, operationTime);
      const changed = candidate.bindProvider({
        providerId: request.providerId,
        sessionId: request.sessionId,
        updatedTime: operationTime,
      });

      if (changed) {
        this.requireCurrentContext(context, locator);
        await context.file.write(candidate.getSnapshot());
        this.requireCurrentContext(context, locator);
        this.sessions.set(locatorKey(locator), candidate);
      }

      return candidate.getProviderBinding(request.providerId)!;
    });
  }

  async replaceProviderBinding(
    request: ReplaceAgentSessionProviderRequest,
  ): Promise<AgentProviderSessionBinding> {
    const locator = createAgentSessionLocator(request.locator);
    const context = this.requireContext(locator);

    return this.enqueue(context, locator, async () => {
      const current = await this.loadSession(context, locator);

      if (!current) {
        throw new AppError('AGENT_SESSION_CONFLICT');
      }

      const currentSnapshot = current.getSnapshot();
      const candidate = new AgentSession(currentSnapshot);
      const changed = candidate.replaceProviderBinding({
        providerId: request.providerId,
        expectedSessionId: request.expectedSessionId,
        sessionId: request.sessionId,
        updatedTime: this.nextTimestamp(
          currentSnapshot.updatedTime,
        ),
      });

      if (changed) {
        this.requireCurrentContext(context, locator);
        await context.file.write(candidate.getSnapshot());
        this.requireCurrentContext(context, locator);
        this.sessions.set(locatorKey(locator), candidate);
      }

      return candidate.getProviderBinding(request.providerId)!;
    });
  }

  private async loadSession(
    context: ActiveAgentSessionProject,
    locator: AgentSessionLocator,
  ): Promise<AgentSession | undefined> {
    const key = locatorKey(locator);

    if (this.sessions.has(key)) {
      return this.sessions.get(key) ?? undefined;
    }

    const snapshot = await context.file.read(locator);
    this.requireCurrentContext(context, locator);
    const session = snapshot ? new AgentSession(snapshot) : undefined;
    this.sessions.set(key, session ?? null);
    return session;
  }

  private requireContext(
    locator: AgentSessionLocator,
  ): ActiveAgentSessionProject {
    const context = this.activeProject;

    if (!context) {
      throw new AppError('SERVICE_NOT_READY');
    }

    if (context.projectId !== locator.projectId) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }

    return context;
  }

  private requireCurrentContext(
    context: ActiveAgentSessionProject,
    locator: AgentSessionLocator,
  ): void {
    if (
      this.activeProject?.token !== context.token ||
      context.projectId !== locator.projectId
    ) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }
  }

  private nextTimestamp(previous?: number): number {
    return Math.max(this.dependencies.now(), previous ?? 0);
  }

  private enqueue<T>(
    context: ActiveAgentSessionProject,
    locator: AgentSessionLocator,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = locatorKey(locator);
    const previous = this.operationTails.get(key) ?? Promise.resolve();
    const result = previous
      .catch(() => undefined)
      .then(async () => {
        this.requireCurrentContext(context, locator);
        return operation();
      });
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.operationTails.set(key, tail);
    void tail.then(() => {
      if (this.operationTails.get(key) === tail) {
        this.operationTails.delete(key);
      }
    });
    return result;
  }
}
