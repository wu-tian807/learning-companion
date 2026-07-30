export type AgentProviderCredentialStatus =
  | 'authenticated'
  | 'unauthenticated'
  | 'unavailable';

export interface AgentProviderAccountSnapshot {
  readonly email?: string;
  readonly planType?: string;
  readonly authenticationMethod?: string;
}

export type AgentProviderCredentialSnapshot =
  | {
      readonly status: 'authenticated';
      readonly account: AgentProviderAccountSnapshot;
    }
  | {
      readonly status: 'unauthenticated';
    }
  | {
      readonly status: 'unavailable';
      readonly message: string;
    };

export interface AgentProviderSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly loginLabel: string;
  readonly selected: boolean;
  readonly credential: AgentProviderCredentialSnapshot;
}

export interface AgentProviderSetupSnapshot {
  readonly selectedProviderId: string | null;
  readonly activeProviderId: string | null;
  readonly requiresSelection: boolean;
  readonly providers: readonly AgentProviderSnapshot[];
}

export type AgentProviderLoginChallenge =
  | {
      readonly type: 'external-browser';
      readonly providerId: string;
      readonly loginId: string;
      readonly url: string;
    }
  | {
      readonly type: 'device-code';
      readonly providerId: string;
      readonly loginId: string;
      readonly verificationUrl: string;
      readonly userCode: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAgentProviderId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  );
}

export function isAgentProviderAccountSnapshot(
  value: unknown,
): value is AgentProviderAccountSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.email === undefined || typeof value.email === 'string') &&
    (value.planType === undefined ||
      typeof value.planType === 'string') &&
    (value.authenticationMethod === undefined ||
      typeof value.authenticationMethod === 'string')
  );
}

export function isAgentProviderCredentialSnapshot(
  value: unknown,
): value is AgentProviderCredentialSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  if (value.status === 'authenticated') {
    return isAgentProviderAccountSnapshot(value.account);
  }

  if (value.status === 'unauthenticated') {
    return true;
  }

  return (
    value.status === 'unavailable' &&
    typeof value.message === 'string' &&
    value.message.length > 0
  );
}

export function isAgentProviderSnapshot(
  value: unknown,
): value is AgentProviderSnapshot {
  return (
    isRecord(value) &&
    isAgentProviderId(value.id) &&
    typeof value.displayName === 'string' &&
    value.displayName.length > 0 &&
    typeof value.description === 'string' &&
    typeof value.loginLabel === 'string' &&
    value.loginLabel.length > 0 &&
    typeof value.selected === 'boolean' &&
    isAgentProviderCredentialSnapshot(value.credential)
  );
}

export function isAgentProviderSetupSnapshot(
  value: unknown,
): value is AgentProviderSetupSnapshot {
  if (
    !isRecord(value) ||
    !(
      value.selectedProviderId === null ||
      isAgentProviderId(value.selectedProviderId)
    ) ||
    !(
      value.activeProviderId === null ||
      isAgentProviderId(value.activeProviderId)
    ) ||
    typeof value.requiresSelection !== 'boolean' ||
    !Array.isArray(value.providers) ||
    !value.providers.every(isAgentProviderSnapshot)
  ) {
    return false;
  }

  const providerIds = new Set(
    value.providers.map((provider) => provider.id),
  );
  const selected = value.providers.filter((provider) => provider.selected);
  const activeProvider =
    value.activeProviderId === null
      ? undefined
      : value.providers.find(
          (provider) => provider.id === value.activeProviderId,
        );

  return (
    providerIds.size === value.providers.length &&
    selected.length <= 1 &&
    (value.selectedProviderId === null
      ? selected.length === 0
      : selected.length === 1 &&
        selected[0]?.id === value.selectedProviderId) &&
    (activeProvider === undefined ||
      activeProvider.credential.status === 'authenticated') &&
    value.requiresSelection === (value.activeProviderId === null)
  );
}

export function isAgentProviderLoginChallenge(
  value: unknown,
): value is AgentProviderLoginChallenge {
  if (
    !isRecord(value) ||
    !isAgentProviderId(value.providerId) ||
    typeof value.loginId !== 'string' ||
    value.loginId.length === 0
  ) {
    return false;
  }

  if (value.type === 'external-browser') {
    return typeof value.url === 'string' && value.url.length > 0;
  }

  return (
    value.type === 'device-code' &&
    typeof value.verificationUrl === 'string' &&
    value.verificationUrl.length > 0 &&
    typeof value.userCode === 'string' &&
    value.userCode.length > 0
  );
}
