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
import {
  HIGH_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
  LOW_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
  MEDIUM_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
} from '../../shared/agent-provider-selectors';
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
  readonly agentProviderSelectorMigrationVersion: number;
  readonly agentProviderConnections: Readonly<
    Record<string, AgentProviderConnectionConfiguration>
  >;
  /** selectorId → the user's explicit selection. Defaults are not persisted. */
  readonly agentProviderSelectorSelections: Readonly<
    Record<string, AgentProviderSelectorSelectionSnapshot>
  >;
}

interface DeserializedSettings {
  readonly state: StoredSettingsState;
  readonly needsMigration: boolean;
}

const LEGACY_GENERATION_CENTER_SELECTOR_ID = 'generation-center';
const LEGACY_WORKBENCH_SELECTOR_ID = 'workbench';
const CURRENT_AGENT_PROVIDER_SELECTOR_MIGRATION_VERSION = 2;

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
        ([selectorId, selection]) => {
          if (
            !isAgentProviderSelectorId(selectorId) ||
            !isAgentProviderSelectorSelectionSnapshot(selection) ||
            selection.selectorId !== selectorId
          ) {
            throw new Error('Settings Agent Provider Selector 配置无效');
          }

          return [
            selectorId,
            cloneAgentProviderSelectorSelection(selection),
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
    agentProviderSelectorMigrationVersion:
      state.agentProviderSelectorMigrationVersion,
    agentProviderConnections: connections,
    agentProviderSelectorSelections: selections,
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
        Object.entries(state.agentProviderSelectorSelections).filter(
          ([, selection]) => selection.connectionId !== connectionId,
        ),
      );
      return {
        ...state,
        agentProviderConnections: connections,
        agentProviderSelectorSelections: selections,
      };
    });
  }

  getAgentProviderSelectorSelection(
    selectorId: string,
  ): AgentProviderSelectorSelectionSnapshot | undefined {
    this.requireInitialized();

    if (!isAgentProviderSelectorId(selectorId)) {
      throw new Error('Settings Agent Provider Selector ID 无效');
    }
    const selection = this.state.agentProviderSelectorSelections[selectorId];
    return selection ? cloneAgentProviderSelectorSelection(selection) : undefined;
  }

  async updateAgentProviderSelectorSelection(
    selection: AgentProviderSelectorSelectionSnapshot,
  ): Promise<void> {
    const normalized = cloneAgentProviderSelectorSelection(selection);
    await this.updateState((state) => ({
      ...state,
      agentProviderSelectorSelections: {
        ...state.agentProviderSelectorSelections,
        [normalized.selectorId]: normalized,
      },
    }));
  }

  private defaultState(): StoredSettingsState {
    return cloneState({
      preferences: DEFAULT_APP_PREFERENCES,
      defaultProjectWorkspace: this.fallbackProjectWorkspace,
      externalLibrariesPath: this.fallbackExternalLibrariesPath,
      completedOnboardingVersion: 0,
      agentProviderSelectorMigrationVersion:
        CURRENT_AGENT_PROVIDER_SELECTOR_MIGRATION_VERSION,
      agentProviderConnections: {},
      agentProviderSelectorSelections: {},
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
        agentProviderSelectorMigrationVersion:
          state.agentProviderSelectorMigrationVersion,
        agentProviderConnections: state.agentProviderConnections,
        agentProviderSelectorSelections: state.agentProviderSelectorSelections,
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
    let agentProviderSelectorMigrationVersion = 0;
    let connections: Record<string, AgentProviderConnectionConfiguration> = {};
    const selections: Record<string, AgentProviderSelectorSelectionSnapshot> = {};
    const legacySelectionsByConnection: Record<
      string,
      Record<string, AgentProviderSelectorSelectionSnapshot>
    > = {};
    let legacySelectorConnections: Record<
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

    if ('agentProviderSelectorMigrationVersion' in value) {
      if (
        !Number.isSafeInteger(value.agentProviderSelectorMigrationVersion) ||
        Number(value.agentProviderSelectorMigrationVersion) < 0 ||
        Number(value.agentProviderSelectorMigrationVersion) >
          CURRENT_AGENT_PROVIDER_SELECTOR_MIGRATION_VERSION
      ) {
        throw new Error('Settings Agent Provider Selector 迁移版本无效');
      }
      agentProviderSelectorMigrationVersion = Number(
        value.agentProviderSelectorMigrationVersion,
      );
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
        // Current structure: selectorId -> one explicit selection.
        if (isAgentProviderSelectorSelectionSnapshot(entry)) {
          if (entry.selectorId !== id) {
            throw new Error('Settings Agent Provider Selector 配置无效');
          }
          selections[id] = entry;
          continue;
        }

        // 2026-08 legacy structure: selectorId -> connectionId -> selection.
        if (
          !isRecord(entry) ||
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
        legacySelectionsByConnection[id] = entry as Record<
          string,
          AgentProviderSelectorSelectionSnapshot
        >;
        needsMigration = true;
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
          selectorId: consumerId,
          providerId: selection.providerId,
          connectionId,
          modelId: selection.modelId,
          reasoningEffort: selection.reasoningEffort,
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
        !selections[HIGH_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID] &&
        !selections[LEGACY_GENERATION_CENTER_SELECTOR_ID]
      ) {
        const connectionId =
          legacyApiConnections.get(providerId) ??
          builtInAccountConnectionId(providerId);
        selections[HIGH_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID] = {
          selectorId: HIGH_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
          providerId,
          connectionId,
          modelId: null,
          reasoningEffort: null,
        };
      }
      needsMigration = true;
    }

    if ('agentProviderSelectorConnections' in value) {
      if (!isRecord(value.agentProviderSelectorConnections)) {
        throw new Error('Settings Agent Provider Selector 配置无效');
      }
      legacySelectorConnections = Object.fromEntries(
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
      needsMigration = true;
    }

    for (const [selectorId, byConnection] of Object.entries(
      legacySelectionsByConnection,
    )) {
      if (selections[selectorId]) {
        continue;
      }
      const active = legacySelectorConnections[selectorId];
      const selection = active ? byConnection[active.connectionId] : undefined;
      if (selection?.providerId === active?.providerId) {
        selections[selectorId] = selection;
      }
    }

    const migrateSelector = (
      targetId: string,
      source: AgentProviderSelectorSelectionSnapshot | undefined,
    ) => {
      if (!source || selections[targetId]) return;
      selections[targetId] = {
        ...source,
        selectorId: targetId,
      };
      needsMigration = true;
    };
    const legacyGeneration = selections[LEGACY_GENERATION_CENTER_SELECTOR_ID];
    const legacyWorkbench = selections[LEGACY_WORKBENCH_SELECTOR_ID];
    migrateSelector(
      HIGH_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
      legacyGeneration,
    );
    migrateSelector(
      MEDIUM_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
      legacyWorkbench,
    );
    if (legacyGeneration || legacyWorkbench) {
      delete selections[LEGACY_GENERATION_CENTER_SELECTOR_ID];
      delete selections[LEGACY_WORKBENCH_SELECTOR_ID];
      needsMigration = true;
    }

    if (agentProviderSelectorMigrationVersion < 2) {
      const medium =
        selections[MEDIUM_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID];
      const low = selections[LOW_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID];
      if (
        medium &&
        low &&
        medium.providerId === low.providerId &&
        medium.connectionId === low.connectionId &&
        medium.modelId === low.modelId &&
        medium.reasoningEffort === low.reasoningEffort
      ) {
        // The first intelligence-tier migration copied the former Workbench
        // choice into both slots. Removing only that duplicate restores the
        // low tier's app default without overriding an independently saved
        // low-tier choice.
        delete selections[LOW_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID];
      }
      agentProviderSelectorMigrationVersion = 2;
      needsMigration = true;
    }

    return {
      state: cloneState({
        preferences: value,
        defaultProjectWorkspace,
        externalLibrariesPath,
        completedOnboardingVersion,
        agentProviderSelectorMigrationVersion,
        agentProviderConnections: connections,
        agentProviderSelectorSelections: selections,
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
