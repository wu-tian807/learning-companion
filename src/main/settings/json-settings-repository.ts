import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, normalize } from 'node:path';

import {
  APP_PREFERENCES_SCHEMA_VERSION,
  DEFAULT_APP_PREFERENCES,
  isAppPreferences,
  type AppPreferences,
  type HomePreferences,
} from '../../shared/app-preferences';
import {
  createAppSetupSnapshot,
  CURRENT_ONBOARDING_VERSION,
  EXTERNAL_LIBRARY_ONBOARDING_VERSION,
  isCompletedOnboardingVersion,
  type AppSetupSnapshot,
} from '../../shared/app-setup';
import {
  cloneAgentProviderConnectionConfiguration,
  cloneAgentProviderSelectorSelection,
  isAgentProviderBaseUrl,
  isAgentProviderConnectionConfiguration,
  isAgentProviderConnectionId,
  isAgentProviderId,
  isAgentProviderSelectorId,
  isAgentProviderSelectorSelectionSnapshot,
  type AgentProviderConnectionConfiguration,
  type AgentProviderSelectorSelectionSnapshot,
} from '../../shared/agent-providers';
import { GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID } from '../../shared/agent-provider-selectors';
import type { SettingsRepository } from './settings-repository';

export interface SettingsLogger {
  warn(message: string, error?: unknown): void;
}

interface JsonSettingsRepositoryOptions {
  readonly logger?: SettingsLogger;
  readonly defaultProjectWorkspace?: string;
  readonly defaultExternalLibrariesPath?: string;
}

interface StoredSettingsState {
  readonly preferences: AppPreferences;
  readonly defaultProjectWorkspace: string;
  readonly externalLibrariesPath: string;
  readonly completedOnboardingVersion: number;
  readonly agentProviderConnections: Readonly<
    Record<string, AgentProviderConnectionConfiguration>
  >;
  /**
   * selectorId → (connectionId → selection)。同一功能的每个 Connection 各存一份
   * 模型/思考力度配置，切换 Connection 时各自恢复。
   */
  readonly agentProviderSelectorSelections: Readonly<
    Record<
      string,
      Readonly<Record<string, AgentProviderSelectorSelectionSnapshot>>
    >
  >;
  /** selectorId → 上次使用的 (providerId, connectionId)，任务执行时使用。 */
  readonly agentProviderSelectorConnections: Readonly<
    Record<string, { readonly providerId: string; readonly connectionId: string }>
  >;
}

interface DeserializedSettings {
  readonly state: StoredSettingsState;
  readonly needsMigration: boolean;
}

function clonePreferences(preferences: AppPreferences): AppPreferences {
  return Object.freeze({
    schemaVersion: preferences.schemaVersion,
    home: Object.freeze({ ...preferences.home }),
  });
}

function normalizeDirectory(directory: string): string {
  const value = directory.trim();

  if (!value || !isAbsolute(value)) {
    throw new Error('默认 Project 工作区必须是绝对路径');
  }

  return normalize(value);
}

function cloneState(state: StoredSettingsState): StoredSettingsState {
  if (!isCompletedOnboardingVersion(state.completedOnboardingVersion)) {
    throw new Error('Settings 首次运行引导版本无效');
  }

  const connections = Object.freeze(
    Object.fromEntries(
      Object.entries(state.agentProviderConnections).map(
        ([connectionId, connection]) => {
          if (
            !isAgentProviderConnectionId(connectionId) ||
            connection.id !== connectionId
          ) {
            throw new Error('Settings Agent Provider Connection 无效');
          }

          return [
            connectionId,
            cloneAgentProviderConnectionConfiguration(connection),
          ] as const;
        },
      ),
    ),
  );
  const selections = Object.freeze(
    Object.fromEntries(
      Object.entries(state.agentProviderSelectorSelections).map(
        ([selectorId, byConnection]) => {
          if (
            !isAgentProviderSelectorId(selectorId) ||
            !isRecord(byConnection)
          ) {
            throw new Error('Settings Agent Provider Selector 配置无效');
          }

          const normalized = Object.freeze(
            Object.fromEntries(
              Object.entries(byConnection).map(
                ([connectionId, selection]) => {
                  if (
                    !isAgentProviderConnectionId(connectionId) ||
                    !isAgentProviderSelectorSelectionSnapshot(selection) ||
                    selection.selectorId !== selectorId ||
                    selection.connectionId !== connectionId
                  ) {
                    throw new Error(
                      'Settings Agent Provider Selector 配置无效',
                    );
                  }

                  return [
                    connectionId,
                    cloneAgentProviderSelectorSelection(selection),
                  ] as const;
                },
              ),
            ),
          );
          return [selectorId, normalized] as const;
        },
      ),
    ),
  );
  const selectorConnections = Object.freeze(
    Object.fromEntries(
      Object.entries(state.agentProviderSelectorConnections).map(
        ([selectorId, record]) => {
          if (
            !isAgentProviderSelectorId(selectorId) ||
            !isRecord(record) ||
            !isAgentProviderId(record.providerId) ||
            !isAgentProviderConnectionId(record.connectionId)
          ) {
            throw new Error('Settings Agent Provider Selector 配置无效');
          }

          return [
            selectorId,
            Object.freeze({
              providerId: record.providerId,
              connectionId: record.connectionId,
            }),
          ] as const;
        },
      ),
    ),
  );

  return Object.freeze({
    preferences: clonePreferences(state.preferences),
    defaultProjectWorkspace: normalizeDirectory(state.defaultProjectWorkspace),
    externalLibrariesPath: normalizeDirectory(state.externalLibrariesPath),
    completedOnboardingVersion: state.completedOnboardingVersion,
    agentProviderConnections: connections,
    agentProviderSelectorSelections: selections,
    agentProviderSelectorConnections: selectorConnections,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function builtInAccountConnectionId(providerId: string): string {
  return `${providerId}-account`;
}

export class JsonSettingsRepository implements SettingsRepository {
  private readonly logger: SettingsLogger;
  private readonly fallbackProjectWorkspace: string;
  private readonly fallbackExternalLibrariesPath: string;
  private state: StoredSettingsState;
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly settingsFile: string,
    options: JsonSettingsRepositoryOptions = {},
  ) {
    this.logger = options.logger ?? console;
    this.fallbackProjectWorkspace = normalizeDirectory(
      options.defaultProjectWorkspace ?? dirname(settingsFile),
    );
    this.fallbackExternalLibrariesPath = normalizeDirectory(
      options.defaultExternalLibrariesPath ?? dirname(settingsFile),
    );
    this.state = this.defaultState();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const restored = this.deserialize(await readFile(this.settingsFile, 'utf8'));
      this.state = restored.state;

      if (restored.needsMigration) {
        try {
          await this.persist(this.state);
        } catch (error) {
          this.logger.warn(
            'Settings 默认字段迁移保存失败，将继续使用内存默认值。',
            error,
          );
        }
      }
    } catch (error) {
      this.state = this.defaultState();
      if (!isFileNotFound(error)) {
        this.logger.warn('Settings 读取失败，已恢复默认设置。', error);
      }
    } finally {
      this.initialized = true;
    }
  }

  get(): AppPreferences {
    this.requireInitialized();
    return clonePreferences(this.state.preferences);
  }

  async updateHomePreferences(home: HomePreferences): Promise<AppPreferences> {
    await this.updateState((state) => ({
      ...state,
      preferences: {
        schemaVersion: APP_PREFERENCES_SCHEMA_VERSION,
        home,
      },
    }));
    return this.get();
  }

  getAppSetup(): AppSetupSnapshot {
    this.requireInitialized();
    return createAppSetupSnapshot(this.state.completedOnboardingVersion);
  }

  async completeExternalLibraryOnboarding(): Promise<AppSetupSnapshot> {
    await this.updateState((state) => ({
      ...state,
      completedOnboardingVersion: Math.max(
        state.completedOnboardingVersion,
        EXTERNAL_LIBRARY_ONBOARDING_VERSION,
      ),
    }));
    return this.getAppSetup();
  }

  async completeAgentProviderOnboarding(): Promise<AppSetupSnapshot> {
    await this.updateState((state) => ({
      ...state,
      completedOnboardingVersion: Math.max(
        state.completedOnboardingVersion,
        CURRENT_ONBOARDING_VERSION,
      ),
    }));
    return this.getAppSetup();
  }

  getDefaultProjectWorkspace(): string {
    this.requireInitialized();
    return this.state.defaultProjectWorkspace;
  }

  async updateDefaultProjectWorkspace(directory: string): Promise<void> {
    const normalized = normalizeDirectory(directory);
    await this.updateState((state) => ({
      ...state,
      defaultProjectWorkspace: normalized,
    }));
  }

  getExternalLibrariesPath(): string {
    this.requireInitialized();
    return this.state.externalLibrariesPath;
  }

  async updateExternalLibrariesPath(directory: string): Promise<void> {
    const normalized = normalizeDirectory(directory);
    await this.updateState((state) => ({
      ...state,
      externalLibrariesPath: normalized,
    }));
  }

  listAgentProviderConnections(): readonly AgentProviderConnectionConfiguration[] {
    this.requireInitialized();
    return Object.freeze(
      Object.values(this.state.agentProviderConnections).map(
        cloneAgentProviderConnectionConfiguration,
      ),
    );
  }

  getAgentProviderConnection(
    connectionId: string,
  ): AgentProviderConnectionConfiguration | undefined {
    this.requireInitialized();

    if (!isAgentProviderConnectionId(connectionId)) {
      throw new Error('Settings Agent Provider Connection ID 无效');
    }

    const connection = this.state.agentProviderConnections[connectionId];
    return connection
      ? cloneAgentProviderConnectionConfiguration(connection)
      : undefined;
  }

  async updateAgentProviderConnection(
    connection: AgentProviderConnectionConfiguration,
  ): Promise<void> {
    const normalized = cloneAgentProviderConnectionConfiguration(connection);
    await this.updateState((state) => ({
      ...state,
      agentProviderConnections: {
        ...state.agentProviderConnections,
        [normalized.id]: normalized,
      },
    }));
  }

  async deleteAgentProviderConnection(connectionId: string): Promise<void> {
    if (!isAgentProviderConnectionId(connectionId)) {
      throw new Error('Settings Agent Provider Connection ID 无效');
    }

    await this.updateState((state) => {
      const connections = { ...state.agentProviderConnections };
      delete connections[connectionId];
      const selections = Object.fromEntries(
        Object.entries(state.agentProviderSelectorSelections).map(
          ([selectorId, byConnection]) => {
            const next = { ...byConnection };
            delete next[connectionId];
            return [selectorId, next] as const;
          },
        ),
      );
      const selectorConnections = Object.fromEntries(
        Object.entries(state.agentProviderSelectorConnections).filter(
          ([, record]) => record.connectionId !== connectionId,
        ),
      );
      return {
        ...state,
        agentProviderConnections: connections,
        agentProviderSelectorSelections: selections,
        agentProviderSelectorConnections: selectorConnections,
      };
    });
  }

  listAgentProviderSelectorSelections(): readonly AgentProviderSelectorSelectionSnapshot[] {
    this.requireInitialized();
    return Object.freeze(
      Object.values(this.state.agentProviderSelectorSelections).flatMap(
        (byConnection) =>
          Object.values(byConnection).map(
            cloneAgentProviderSelectorSelection,
          ),
      ),
    );
  }

  getAgentProviderSelectorSelection(
    selectorId: string,
    connectionId: string,
  ): AgentProviderSelectorSelectionSnapshot | undefined {
    this.requireInitialized();

    if (!isAgentProviderSelectorId(selectorId)) {
      throw new Error('Settings Agent Provider Selector ID 无效');
    }
    if (!isAgentProviderConnectionId(connectionId)) {
      throw new Error('Settings Agent Provider Connection ID 无效');
    }

    const selection =
      this.state.agentProviderSelectorSelections[selectorId]?.[connectionId];
    return selection ? cloneAgentProviderSelectorSelection(selection) : undefined;
  }

  async updateAgentProviderSelectorSelection(
    selection: AgentProviderSelectorSelectionSnapshot,
  ): Promise<void> {
    const normalized = cloneAgentProviderSelectorSelection(selection);
    await this.updateState((state) => {
      const bySelector = {
        ...state.agentProviderSelectorSelections,
        [normalized.selectorId]: {
          ...state.agentProviderSelectorSelections[normalized.selectorId],
          [normalized.connectionId]: normalized,
        },
      };
      return {
        ...state,
        agentProviderSelectorSelections: bySelector,
      };
    });
  }

  getAgentProviderSelectorConnection(
    selectorId: string,
  ): { providerId: string; connectionId: string } | undefined {
    this.requireInitialized();

    if (!isAgentProviderSelectorId(selectorId)) {
      throw new Error('Settings Agent Provider Selector ID 无效');
    }

    const record = this.state.agentProviderSelectorConnections[selectorId];
    return record ? Object.freeze({ ...record }) : undefined;
  }

  async updateAgentProviderSelectorConnection(
    selectorId: string,
    providerId: string,
    connectionId: string,
  ): Promise<void> {
    if (
      !isAgentProviderSelectorId(selectorId) ||
      !isAgentProviderId(providerId) ||
      !isAgentProviderConnectionId(connectionId)
    ) {
      throw new Error('Settings Agent Provider Selector 配置无效');
    }

    await this.updateState((state) => ({
      ...state,
      agentProviderSelectorConnections: {
        ...state.agentProviderSelectorConnections,
        [selectorId]: Object.freeze({ providerId, connectionId }),
      },
    }));
  }

  private defaultState(): StoredSettingsState {
    return cloneState({
      preferences: DEFAULT_APP_PREFERENCES,
      defaultProjectWorkspace: this.fallbackProjectWorkspace,
      externalLibrariesPath: this.fallbackExternalLibrariesPath,
      completedOnboardingVersion: 0,
      agentProviderConnections: {},
      agentProviderSelectorSelections: {},
      agentProviderSelectorConnections: {},
    });
  }

  private async updateState(
    update: (state: StoredSettingsState) => StoredSettingsState,
  ): Promise<void> {
    this.requireInitialized();
    const task = this.writeQueue.then(async () => {
      const next = cloneState(update(this.state));
      await this.persist(next);
      this.state = next;
    });
    this.writeQueue = task.catch(() => undefined);
    await task;
  }

  private serialize(state: StoredSettingsState): string {
    return `${JSON.stringify(
      {
        ...state.preferences,
        defaultProjectWorkspace: state.defaultProjectWorkspace,
        externalLibrariesPath: state.externalLibrariesPath,
        completedOnboardingVersion: state.completedOnboardingVersion,
        agentProviderConnections: state.agentProviderConnections,
        agentProviderSelectorSelections: state.agentProviderSelectorSelections,
        agentProviderSelectorConnections:
          state.agentProviderSelectorConnections,
      },
      null,
      2,
    )}\n`;
  }

  private deserialize(content: string): DeserializedSettings {
    const value: unknown = JSON.parse(content);

    if (!isAppPreferences(value) || !isRecord(value)) {
      throw new Error('Settings 数据结构或版本无效');
    }

    let defaultProjectWorkspace = this.fallbackProjectWorkspace;
    let externalLibrariesPath = this.fallbackExternalLibrariesPath;
    let completedOnboardingVersion = 0;
    let connections: Record<string, AgentProviderConnectionConfiguration> = {};
    const selections: Record<
      string,
      Record<string, AgentProviderSelectorSelectionSnapshot>
    > = {};
    let selectorConnections: Record<
      string,
      { providerId: string; connectionId: string }
    > = {};
    let needsMigration = false;

    if ('defaultProjectWorkspace' in value) {
      if (typeof value.defaultProjectWorkspace !== 'string') {
        throw new Error('Settings 默认 Project 工作区无效');
      }
      defaultProjectWorkspace = normalizeDirectory(value.defaultProjectWorkspace);
    } else {
      needsMigration = true;
    }

    if ('externalLibrariesPath' in value) {
      if (typeof value.externalLibrariesPath !== 'string') {
        throw new Error('Settings 外部运行时目录无效');
      }
      externalLibrariesPath = normalizeDirectory(value.externalLibrariesPath);
    } else {
      needsMigration = true;
    }

    if ('completedOnboardingVersion' in value) {
      if (!isCompletedOnboardingVersion(value.completedOnboardingVersion)) {
        throw new Error('Settings 首次运行引导版本无效');
      }
      completedOnboardingVersion = value.completedOnboardingVersion;
    } else {
      needsMigration = true;
    }

    if ('completedAgentProviderOnboardingVersion' in value) {
      if (!isCompletedOnboardingVersion(value.completedAgentProviderOnboardingVersion)) {
        throw new Error('Settings AI Provider 首次引导版本无效');
      }
      if (value.completedAgentProviderOnboardingVersion > 0) {
        completedOnboardingVersion = Math.max(
          completedOnboardingVersion,
          CURRENT_ONBOARDING_VERSION,
        );
      }
      needsMigration = true;
    }

    if ('agentProviderConnections' in value) {
      if (!isRecord(value.agentProviderConnections)) {
        throw new Error('Settings Agent Provider Connection 配置无效');
      }
      connections = Object.fromEntries(
        Object.entries(value.agentProviderConnections).map(
          ([id, connection]) => {
            if (
              !isAgentProviderConnectionConfiguration(connection) ||
              connection.id !== id
            ) {
              throw new Error('Settings Agent Provider Connection 配置无效');
            }
            return [id, connection] as const;
          },
        ),
      );
    } else {
      needsMigration = true;
    }

    const legacyApiConnections = new Map<string, string>();
    if ('agentProviderAuthentications' in value) {
      if (!isRecord(value.agentProviderAuthentications)) {
        throw new Error('Settings Agent Provider 认证配置无效');
      }
      for (const [providerId, authentication] of Object.entries(
        value.agentProviderAuthentications,
      )) {
        if (!isAgentProviderId(providerId) || !isRecord(authentication)) {
          throw new Error('Settings Agent Provider 认证配置无效');
        }
        if (authentication.method === 'chatgpt') {
          continue;
        }
        if (
          authentication.method !== 'api-key' ||
          !isAgentProviderBaseUrl(authentication.baseUrl)
        ) {
          throw new Error('Settings Agent Provider 认证配置无效');
        }
        const id = `${providerId}-api-legacy`;
        connections[id] = {
          id,
          providerId,
          kind: 'api-key',
          displayName: '已迁移的 API 连接',
          baseUrl: authentication.baseUrl,
        };
        legacyApiConnections.set(providerId, id);
      }
      needsMigration = true;
    }

    if ('agentProviderSelectorSelections' in value) {
      if (!isRecord(value.agentProviderSelectorSelections)) {
        throw new Error('Settings Agent Provider Selector 配置无效');
      }
      const raw = value.agentProviderSelectorSelections as Record<
        string,
        unknown
      >;
      for (const [id, entry] of Object.entries(raw)) {
        if (!isAgentProviderSelectorId(id)) {
          throw new Error('Settings Agent Provider Selector 配置无效');
        }
        // 新结构：selectorId → (connectionId → selection)
        if (isRecord(entry) && isAgentProviderConnectionId(Object.keys(entry)[0] ?? '')) {
          if (
            !Object.entries(entry).every(
              ([connectionId, selection]) =>
                isAgentProviderConnectionId(connectionId) &&
                isAgentProviderSelectorSelectionSnapshot(selection) &&
                selection.selectorId === id &&
                selection.connectionId === connectionId,
            )
          ) {
            throw new Error('Settings Agent Provider Selector 配置无效');
          }
          selections[id] = entry as Record<
            string,
            AgentProviderSelectorSelectionSnapshot
          >;
        } else {
          // 旧结构：selectorId → 单条 selection
          if (!isAgentProviderSelectorSelectionSnapshot(entry)) {
            throw new Error('Settings Agent Provider Selector 配置无效');
          }
          if (entry.selectorId !== id) {
            throw new Error('Settings Agent Provider Selector 配置无效');
          }
          selections[id] = { [entry.connectionId]: entry };
          selectorConnections[id] = {
            providerId: entry.providerId,
            connectionId: entry.connectionId,
          };
          needsMigration = true;
        }
      }
    } else {
      needsMigration = true;
    }

    if ('agentProviderConsumerSelections' in value) {
      if (!isRecord(value.agentProviderConsumerSelections)) {
        throw new Error('Settings Agent Provider 旧配置无效');
      }
      for (const [consumerId, selection] of Object.entries(
        value.agentProviderConsumerSelections,
      )) {
        if (
          !isAgentProviderSelectorId(consumerId) ||
          !isRecord(selection) ||
          selection.consumerId !== consumerId ||
          !isAgentProviderId(selection.providerId) ||
          (selection.modelId !== null && typeof selection.modelId !== 'string') ||
          (selection.reasoningEffort !== null &&
            typeof selection.reasoningEffort !== 'string')
        ) {
          throw new Error('Settings Agent Provider 旧配置无效');
        }
        const connectionId =
          legacyApiConnections.get(selection.providerId) ??
          builtInAccountConnectionId(selection.providerId);
        selections[consumerId] = {
          [connectionId]: {
            selectorId: consumerId,
            providerId: selection.providerId,
            connectionId,
            modelId: selection.modelId,
            reasoningEffort: selection.reasoningEffort,
          },
        };
        selectorConnections[consumerId] = {
          providerId: selection.providerId,
          connectionId,
        };
      }
      needsMigration = true;
    }

    if ('selectedAgentProviderId' in value) {
      if (
        value.selectedAgentProviderId !== null &&
        !isAgentProviderId(value.selectedAgentProviderId)
      ) {
        throw new Error('Settings Agent Provider 无效');
      }
      const providerId = value.selectedAgentProviderId;
      if (
        providerId &&
        !selections[GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID]
      ) {
        const connectionId =
          legacyApiConnections.get(providerId) ??
          builtInAccountConnectionId(providerId);
        selections[GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID] = {
          [connectionId]: {
            selectorId: GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID,
            providerId,
            connectionId,
            modelId: null,
            reasoningEffort: null,
          },
        };
        selectorConnections[GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID] = {
          providerId,
          connectionId,
        };
      }
      needsMigration = true;
    }

    if ('agentProviderSelectorConnections' in value) {
      if (!isRecord(value.agentProviderSelectorConnections)) {
        throw new Error('Settings Agent Provider Selector 配置无效');
      }
      selectorConnections = Object.fromEntries(
        Object.entries(value.agentProviderSelectorConnections).map(
          ([selectorId, record]) => {
            if (
              !isAgentProviderSelectorId(selectorId) ||
              !isRecord(record) ||
              !isAgentProviderId(record.providerId) ||
              !isAgentProviderConnectionId(record.connectionId)
            ) {
              throw new Error('Settings Agent Provider Selector 配置无效');
            }
            return [
              selectorId,
              { providerId: record.providerId, connectionId: record.connectionId },
            ] as const;
          },
        ),
      );
    }

    return {
      state: cloneState({
        preferences: value,
        defaultProjectWorkspace,
        externalLibrariesPath,
        completedOnboardingVersion,
        agentProviderConnections: connections,
        agentProviderSelectorSelections: selections,
        agentProviderSelectorConnections: selectorConnections,
      }),
      needsMigration,
    };
  }

  private async persist(state: StoredSettingsState): Promise<void> {
    const temporary = `${this.settingsFile}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.settingsFile), { recursive: true });

    try {
      await writeFile(temporary, this.serialize(state), 'utf8');
      await rename(temporary, this.settingsFile);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new Error('Settings Repository 尚未初始化');
    }
  }
}
