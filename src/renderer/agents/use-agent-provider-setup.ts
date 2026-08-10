import { useState } from 'react';

import {
  isAgentProviderLoginChallenge,
  isAgentProviderSetupSnapshot,
  type AgentProviderLoginChallenge,
  type AgentProviderSetupSnapshot,
} from '../../shared/agent-providers';
import {
  isAppSetupSnapshot,
  type AppSetupSnapshot,
} from '../../shared/app-setup';
import { userMessageFromError } from '../../shared/ipc-error';
import type { AgentProviderSetupApi } from './agent-provider-api';

function challengeUrl(
  challenge: AgentProviderLoginChallenge,
): string {
  return challenge.type === 'external-browser'
    ? challenge.url
    : challenge.verificationUrl;
}

interface UseAgentProviderSetupInput {
  readonly setup: AgentProviderSetupSnapshot;
  readonly onCompleted: (setup: AppSetupSnapshot) => void;
  readonly api: AgentProviderSetupApi;
  readonly refreshProvider: (
    providerId: string,
  ) => Promise<AgentProviderSetupSnapshot>;
}

export function useAgentProviderSetup({
  setup,
  onCompleted,
  api,
  refreshProvider,
}: UseAgentProviderSetupInput) {
  const [loginChallenge, setLoginChallenge] = useState<
    AgentProviderLoginChallenge | undefined
  >();
  const [busyConnectionId, setBusyConnectionId] = useState<
    string | undefined
  >();
  const [error, setError] = useState<string | null>(null);
  const currentLoginChallenge =
    loginChallenge &&
    setup.providers
      .find((candidate) => candidate.id === loginChallenge.providerId)
      ?.connections.find(
        (candidate) => candidate.id === loginChallenge.connectionId,
      )?.status !== 'ready'
      ? loginChallenge
      : undefined;

  const refresh = async (providerId: string) => {
    setError(null);

    try {
      const next = await refreshProvider(providerId);

      if (!isAgentProviderSetupSnapshot(next)) {
        throw new Error('Agent Provider 状态响应无效');
      }

      const connection = loginChallenge
        ? next.providers
            .find((candidate) => candidate.id === loginChallenge.providerId)
            ?.connections.find(
              (candidate) => candidate.id === loginChallenge.connectionId,
            )
        : undefined;
      if (connection?.status === 'ready') {
        setLoginChallenge(undefined);
      }
    } catch (refreshError) {
      setError(
        userMessageFromError(
          refreshError,
          '暂时无法检查 Provider 状态，请重试。',
        ) ?? '暂时无法检查 Provider 状态，请重试。',
      );
    }
  };

  const startLogin = async (providerId: string, connectionId: string) => {
    setBusyConnectionId(connectionId);
    setError(null);
    let challenge: AgentProviderLoginChallenge | undefined;

    try {
      challenge = await api.startAgentProviderLogin({
        providerId,
        connectionId,
      });

      if (!isAgentProviderLoginChallenge(challenge)) {
        throw new Error('Agent Provider 登录响应无效');
      }

      await api.openExternal({ url: challengeUrl(challenge) });
      setLoginChallenge(challenge);
    } catch (loginError) {
      if (challenge) {
        await api
          .cancelAgentProviderLogin({
            providerId: challenge.providerId,
            connectionId: challenge.connectionId,
            loginId: challenge.loginId,
          })
          .catch(() => undefined);
      }

      setError(
        userMessageFromError(
          loginError,
          '无法开始 Provider 登录，请重试。',
        ) ?? '无法开始 Provider 登录，请重试。',
      );
    } finally {
      setBusyConnectionId(undefined);
    }
  };

  const complete = async () => {
    setBusyConnectionId('onboarding');
    setError(null);

    try {
      const appSetup = await api.completeAgentProviderOnboarding();

      if (!isAppSetupSnapshot(appSetup)) {
        throw new Error('应用设置状态响应无效');
      }

      onCompleted(appSetup);
    } catch (selectionError) {
      setError(
        userMessageFromError(
          selectionError,
          '无法保存 Provider 设置状态，请重试。',
        ) ?? '无法保存 Provider 设置状态，请重试。',
      );
    } finally {
      setBusyConnectionId(undefined);
    }
  };

  const reopenLogin = () => {
    if (!currentLoginChallenge) {
      return;
    }

    void api
      .openExternal({ url: challengeUrl(currentLoginChallenge) })
      .catch((openError) => {
        setError(
          userMessageFromError(
            openError,
            '无法重新打开登录页面。',
          ) ?? '无法重新打开登录页面。',
        );
      });
  };

  const dismiss = () => {
    setBusyConnectionId(
      currentLoginChallenge?.connectionId ?? 'onboarding',
    );
    setError(null);

    void (currentLoginChallenge
      ? api
          .cancelAgentProviderLogin({
            providerId: currentLoginChallenge.providerId,
            connectionId: currentLoginChallenge.connectionId,
            loginId: currentLoginChallenge.loginId,
          })
          .catch(() => undefined)
      : Promise.resolve())
      .then(() => api.completeAgentProviderOnboarding())
      .then((appSetup) => {
        if (!isAppSetupSnapshot(appSetup)) {
          throw new Error('应用设置状态响应无效');
        }

        setLoginChallenge(undefined);
        onCompleted(appSetup);
      })
      .catch((dismissError) => {
        setError(
          userMessageFromError(
            dismissError,
            '无法保存 AI 设置状态，请重试。',
          ) ?? '无法保存 AI 设置状态，请重试。',
        );
      })
      .finally(() => {
        setBusyConnectionId(undefined);
      });
  };

  return {
    setup,
    loginChallenge: currentLoginChallenge,
    busyConnectionId,
    error,
    clearError: () => setError(null),
    refresh,
    startLogin,
    complete,
    reopenLogin,
    dismiss,
  };
}
