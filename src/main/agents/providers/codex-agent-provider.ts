import type {
  AgentProviderCredentialSnapshot,
  AgentProviderLoginChallenge,
} from '../../../shared/agent-providers';
import type { AgentProviderApi } from '../agent-provider';
import type { CodexRuntimeServiceApi } from '../codex/codex-runtime-service-api';

export const CODEX_AGENT_PROVIDER_ID = 'codex';

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export class CodexAgentProvider implements AgentProviderApi {
  readonly id = CODEX_AGENT_PROVIDER_ID;
  readonly displayName = 'Codex';
  readonly description =
    '使用 ChatGPT 账号运行 Codex。';
  readonly loginLabel = '使用 ChatGPT 登录';

  constructor(private readonly runtime: CodexRuntimeServiceApi) {}

  async getCredentialState(
    refreshCredentials = false,
  ): Promise<AgentProviderCredentialSnapshot> {
    const state = await this.runtime.getAccount(refreshCredentials);

    if (!state.account) {
      return { status: 'unauthenticated' };
    }

    return {
      status: 'authenticated',
      account: {
        email: optionalText(state.account.email),
        planType: optionalText(state.account.planType),
        authenticationMethod: optionalText(state.account.type),
      },
    };
  }

  async startLogin(): Promise<AgentProviderLoginChallenge> {
    const challenge = await this.runtime.startChatGptLogin('browser');

    if (challenge.type === 'chatgpt') {
      return {
        type: 'external-browser',
        providerId: this.id,
        loginId: challenge.loginId,
        url: challenge.authUrl,
      };
    }

    return {
      type: 'device-code',
      providerId: this.id,
      loginId: challenge.loginId,
      verificationUrl: challenge.verificationUrl,
      userCode: challenge.userCode,
    };
  }

  cancelLogin(loginId: string): Promise<void> {
    return this.runtime.cancelLogin(loginId);
  }
}
