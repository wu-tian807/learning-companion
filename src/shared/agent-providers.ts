export type AgentProviderConnectionKind = 'account' | 'api-key';

export type AgentProviderConnectionStatus =
  | 'unconfigured'
  | 'ready'
  | 'unavailable';

export interface AgentProviderAccountSnapshot {
  readonly email?: string;
  readonly planType?: string;
  readonly authenticationMethod?: string;
}

export type AgentProviderConnectionConfiguration =
  | {
      readonly id: string;
      readonly providerId: string;
      readonly kind: 'account';
      readonly displayName: string;
    }
  | {
      readonly id: string;
      readonly providerId: string;
      readonly kind: 'api-key';
      readonly displayName: string;
      readonly baseUrl: string;
    };

export interface AgentProviderConnectionSnapshot {
  readonly id: string;
  readonly providerId: string;
  readonly kind: AgentProviderConnectionKind;
  readonly displayName: string;
  readonly baseUrl?: string;
  readonly status: AgentProviderConnectionStatus;
  readonly statusMessage?: string;
  readonly account?: AgentProviderAccountSnapshot;
  readonly hasApiKey: boolean;
  readonly refreshing: boolean;
  readonly removable: boolean;
}

export interface AgentProviderApiConnectionDefaultsSnapshot {
  readonly displayName: string;
  readonly baseUrl: string;
}

export interface AgentProviderSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly supportedConnectionKinds: readonly AgentProviderConnectionKind[];
  readonly connections: readonly AgentProviderConnectionSnapshot[];
  readonly apiConnectionDefaults?: AgentProviderApiConnectionDefaultsSnapshot;
}

export interface AgentProviderSelectorDefinitionSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly defaultSelection?: AgentProviderSelectorDefaultSelectionSnapshot;
}

export interface AgentProviderSelectorDefaultSelectionSnapshot {
  readonly providerId: string;
  readonly connectionId: string;
  readonly modelId: string | null;
  readonly reasoningEffort: string | null;
}

export interface AgentProviderSelectorSelectionSnapshot {
  readonly selectorId: string;
  readonly providerId: string;
  readonly connectionId: string;
  readonly modelId: string | null;
  readonly reasoningEffort: string | null;
}

export interface AgentProviderSelectorConnectionSnapshot {
  readonly selectorId: string;
  readonly providerId: string;
  readonly connectionId: string;
}

export interface AgentProviderSetupSnapshot {
  readonly revision: number;
  readonly providers: readonly AgentProviderSnapshot[];
  readonly selectors: readonly AgentProviderSelectorDefinitionSnapshot[];
  readonly selections: readonly AgentProviderSelectorSelectionSnapshot[];
  readonly selectorConnections: readonly AgentProviderSelectorConnectionSnapshot[];
}

export interface AgentProviderReasoningEffortSnapshot {
  readonly id: string;
  readonly displayName: string;
}

export interface AgentProviderModelSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly reasoningEfforts: readonly AgentProviderReasoningEffortSnapshot[];
  readonly defaultReasoningEffort: string | null;
}

export interface AgentProviderModelCatalogSnapshot {
  readonly providerId: string;
  readonly connectionId: string;
  readonly allowsCustomModel: boolean;
  readonly models: readonly AgentProviderModelSnapshot[];
}

export type AgentProviderLoginChallenge =
  | {
      readonly type: 'external-browser';
      readonly providerId: string;
      readonly connectionId: string;
      readonly loginId: string;
      readonly url: string;
    }
  | {
      readonly type: 'device-code';
      readonly providerId: string;
      readonly connectionId: string;
      readonly loginId: string;
      readonly verificationUrl: string;
      readonly userCode: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown, maxLength = 2_048): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim()
  );
}

function isNullableText(value: unknown): value is string | null {
  return value === null || isRequiredText(value);
}

export function isAgentProviderId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  );
}

export function isAgentProviderConnectionId(value: unknown): value is string {
  return isAgentProviderId(value);
}

export function isAgentProviderSelectorId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[a-z][a-z0-9-]*$/u.test(value)
  );
}

export function isAgentProviderConnectionKind(
  value: unknown,
): value is AgentProviderConnectionKind {
  return value === 'account' || value === 'api-key';
}

export function isAgentProviderConnectionStatus(
  value: unknown,
): value is AgentProviderConnectionStatus {
  return (
    value === 'unconfigured' || value === 'ready' || value === 'unavailable'
  );
}

export function isAgentProviderBaseUrl(value: unknown): value is string {
  if (!isRequiredText(value) || value.length > 2_048) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

export function isAgentProviderConnectionConfiguration(
  value: unknown,
): value is AgentProviderConnectionConfiguration {
  if (
    !isRecord(value) ||
    !isAgentProviderConnectionId(value.id) ||
    !isAgentProviderId(value.providerId) ||
    !isAgentProviderConnectionKind(value.kind) ||
    !isRequiredText(value.displayName, 128)
  ) {
    return false;
  }

  return value.kind === 'account'
    ? value.baseUrl === undefined
    : isAgentProviderBaseUrl(value.baseUrl);
}

export function isAgentProviderAccountSnapshot(
  value: unknown,
): value is AgentProviderAccountSnapshot {
  return (
    isRecord(value) &&
    (value.email === undefined || typeof value.email === 'string') &&
    (value.planType === undefined || typeof value.planType === 'string') &&
    (value.authenticationMethod === undefined ||
      typeof value.authenticationMethod === 'string')
  );
}

export function isAgentProviderConnectionSnapshot(
  value: unknown,
): value is AgentProviderConnectionSnapshot {
  if (!isRecord(value) || !isAgentProviderConnectionConfiguration(value)) {
    return false;
  }

  const snapshot = value as unknown as Record<string, unknown>;
  return (
    isAgentProviderConnectionStatus(snapshot.status) &&
    (snapshot.statusMessage === undefined || isRequiredText(snapshot.statusMessage)) &&
    (snapshot.account === undefined || isAgentProviderAccountSnapshot(snapshot.account)) &&
    typeof snapshot.hasApiKey === 'boolean' &&
    typeof snapshot.refreshing === 'boolean' &&
    typeof snapshot.removable === 'boolean' &&
    (value.kind === 'api-key' || !snapshot.hasApiKey)
  );
}

export function isAgentProviderSnapshot(
  value: unknown,
): value is AgentProviderSnapshot {
  return (
    isRecord(value) &&
    isAgentProviderId(value.id) &&
    isRequiredText(value.displayName, 128) &&
    typeof value.description === 'string' &&
    Array.isArray(value.supportedConnectionKinds) &&
    value.supportedConnectionKinds.every(isAgentProviderConnectionKind) &&
    new Set(value.supportedConnectionKinds).size ===
      value.supportedConnectionKinds.length &&
    Array.isArray(value.connections) &&
    value.connections.every(
      (connection) =>
        isAgentProviderConnectionSnapshot(connection) &&
        connection.providerId === value.id,
    ) &&
    new Set(value.connections.map((connection) => connection.id)).size ===
      value.connections.length &&
    (value.apiConnectionDefaults === undefined ||
      (isRecord(value.apiConnectionDefaults) &&
        isRequiredText(value.apiConnectionDefaults.displayName, 128) &&
        isAgentProviderBaseUrl(value.apiConnectionDefaults.baseUrl)))
  );
}

export function isAgentProviderSelectorDefinitionSnapshot(
  value: unknown,
): value is AgentProviderSelectorDefinitionSnapshot {
  return (
    isRecord(value) &&
    isAgentProviderSelectorId(value.id) &&
    isRequiredText(value.displayName, 128) &&
    isRequiredText(value.description) &&
    (value.defaultSelection === undefined ||
      isAgentProviderSelectorDefaultSelectionSnapshot(value.defaultSelection))
  );
}

export function isAgentProviderSelectorDefaultSelectionSnapshot(
  value: unknown,
): value is AgentProviderSelectorDefaultSelectionSnapshot {
  return (
    isRecord(value) &&
    isAgentProviderId(value.providerId) &&
    isAgentProviderConnectionId(value.connectionId) &&
    isNullableText(value.modelId) &&
    isNullableText(value.reasoningEffort)
  );
}

export function isAgentProviderSelectorSelectionSnapshot(
  value: unknown,
): value is AgentProviderSelectorSelectionSnapshot {
  return (
    isRecord(value) &&
    isAgentProviderSelectorId(value.selectorId) &&
    isAgentProviderId(value.providerId) &&
    isAgentProviderConnectionId(value.connectionId) &&
    isNullableText(value.modelId) &&
    isNullableText(value.reasoningEffort)
  );
}

export function isAgentProviderSetupSnapshot(
  value: unknown,
): value is AgentProviderSetupSnapshot {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Array.isArray(value.providers) ||
    !value.providers.every(isAgentProviderSnapshot) ||
    !Array.isArray(value.selectors) ||
    !value.selectors.every(isAgentProviderSelectorDefinitionSnapshot) ||
    !Array.isArray(value.selections) ||
    !value.selections.every(isAgentProviderSelectorSelectionSnapshot) ||
    !Array.isArray(value.selectorConnections) ||
    !value.selectorConnections.every(
      isAgentProviderSelectorConnectionSnapshot,
    )
  ) {
    return false;
  }

  const selections = value.selections;
  const selectorConnections = value.selectorConnections;
  const providers = new Map(value.providers.map((provider) => [provider.id, provider]));
  const selectorIds = new Set(value.selectors.map((selector) => selector.id));
  if (
    value.selectors.some((selector) => {
      const defaultSelection = selector.defaultSelection;
      if (!defaultSelection) return false;
      return !providers
        .get(defaultSelection.providerId)
        ?.connections.some(
          (connection) => connection.id === defaultSelection.connectionId,
        );
    })
  ) {
    return false;
  }
  const selectionPairs = new Set(
    selections.map(
      (selection) => `${selection.selectorId}:${selection.connectionId}`,
    ),
  );
  const activeSelectorIds = new Set(
    selectorConnections.map(({ selectorId }) => selectorId),
  );

  return (
    providers.size === value.providers.length &&
    selectorIds.size === value.selectors.length &&
    selectionPairs.size === selections.length &&
    activeSelectorIds.size === selectorConnections.length &&
    selections.every((selection) => {
      const provider = providers.get(selection.providerId);
      return (
        selectorIds.has(selection.selectorId) &&
        provider?.connections.some(
          (connection) => connection.id === selection.connectionId,
        ) === true
      );
    }) &&
    selectorConnections.every((active) =>
      selections.some(
        (selection) =>
          selection.selectorId === active.selectorId &&
          selection.providerId === active.providerId &&
          selection.connectionId === active.connectionId,
      ),
    )
  );
}

export function isAgentProviderSelectorConnectionSnapshot(
  value: unknown,
): value is AgentProviderSelectorConnectionSnapshot {
  return (
    isRecord(value) &&
    isAgentProviderSelectorId(value.selectorId) &&
    isAgentProviderId(value.providerId) &&
    isAgentProviderConnectionId(value.connectionId)
  );
}

export function isAgentProviderReasoningEffortSnapshot(
  value: unknown,
): value is AgentProviderReasoningEffortSnapshot {
  return (
    isRecord(value) &&
    isRequiredText(value.id, 128) &&
    isRequiredText(value.displayName, 128)
  );
}

export function isAgentProviderModelSnapshot(
  value: unknown,
): value is AgentProviderModelSnapshot {
  return (
    isRecord(value) &&
    isRequiredText(value.id) &&
    isRequiredText(value.displayName) &&
    typeof value.description === 'string' &&
    typeof value.isDefault === 'boolean' &&
    Array.isArray(value.reasoningEfforts) &&
    value.reasoningEfforts.every(isAgentProviderReasoningEffortSnapshot) &&
    isNullableText(value.defaultReasoningEffort)
  );
}

export function isAgentProviderModelCatalogSnapshot(
  value: unknown,
): value is AgentProviderModelCatalogSnapshot {
  return (
    isRecord(value) &&
    isAgentProviderId(value.providerId) &&
    isAgentProviderConnectionId(value.connectionId) &&
    typeof value.allowsCustomModel === 'boolean' &&
    Array.isArray(value.models) &&
    value.models.every(isAgentProviderModelSnapshot) &&
    new Set(value.models.map((model) => model.id)).size === value.models.length
  );
}

export function isAgentProviderLoginChallenge(
  value: unknown,
): value is AgentProviderLoginChallenge {
  if (
    !isRecord(value) ||
    !isAgentProviderId(value.providerId) ||
    !isAgentProviderConnectionId(value.connectionId) ||
    !isRequiredText(value.loginId)
  ) {
    return false;
  }

  if (value.type === 'external-browser') {
    return isRequiredText(value.url);
  }

  return (
    value.type === 'device-code' &&
    isRequiredText(value.verificationUrl) &&
    isRequiredText(value.userCode)
  );
}

export function cloneAgentProviderConnectionConfiguration(
  value: AgentProviderConnectionConfiguration,
): AgentProviderConnectionConfiguration {
  if (!isAgentProviderConnectionConfiguration(value)) {
    throw new Error('Agent Provider Connection 配置无效');
  }

  return Object.freeze({ ...value });
}

export function cloneAgentProviderSelectorSelection(
  value: AgentProviderSelectorSelectionSnapshot,
): AgentProviderSelectorSelectionSnapshot {
  if (!isAgentProviderSelectorSelectionSnapshot(value)) {
    throw new Error('Agent Provider Selector 配置无效');
  }

  return Object.freeze({ ...value });
}
