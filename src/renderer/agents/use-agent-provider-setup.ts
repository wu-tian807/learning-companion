import { useEffect, useState } from 'react';

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

const LOGIN_POLL_INTERVAL_MS = 1_200;

function challengeUrl(
  challenge: AgentProviderLoginChallenge,
): string {
  return challenge.type === 'external-browser'
    ? challenge.url
    : challenge.verificationUrl;
}

interface UseAgentProviderSetupInput {
  readonly setup: AgentProviderSetupSnapshot;
  readonly onSetupChange: (setup: AgentProviderSetupSnapshot) => void;
  readonly onCompleted: (setup: AppSetupSnapshot) => void;
  readonly api: AgentProviderSetupApi;
}

export function useAgentProviderSetup({
  setup,
  onSetupChange,
  onCompleted,
  api,
}: UseAgentProviderSetupInput) {
  const [loginChallenge, setLoginChallenge] = useState<
    AgentProviderLoginChallenge | undefined
  >();
  const [busyProviderId, setBusyProviderId] = useState<
    string | undefined
  >();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loginChallenge) {
      return;
    }

    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const next = await api.getAgentProviderSetup({
          refreshCredentials: true,
        });

        if (!isAgentProviderSetupSnapshot(next)) {
          throw new Error('Agent Provider 状态响应无效');
        }
        if (!active) {
          return;
        }

        onSetupChange(next);
        const provider = next.providers.find(
          (candidate) =>
            candidate.id === loginChallenge.providerId,
        );

        if (provider?.credential.status === 'authenticated') {
          setLoginChallenge(undefined);
          return;
        }
      } catch (pollError) {
        if (!active) {
          return;
        }

        setError(
          userMessageFromError(
            pollError,
            '暂时无法验证登录状态，请重试。',
          ) ?? '暂时无法验证登录状态，请重试。',
        );
        return;
      }

      timer = window.setTimeout(poll, LOGIN_POLL_INTERVAL_MS);
    };

    timer = window.setTimeout(poll, LOGIN_POLL_INTERVAL_MS);

    return () => {
      active = false;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [api, loginChallenge, onSetupChange]);

  const refresh = async () => {
    setChecking(true);
    setError(null);

    try {
      const next = await api.getAgentProviderSetup({
        refreshCredentials: true,
      });

      if (!isAgentProviderSetupSnapshot(next)) {
        throw new Error('Agent Provider 状态响应无效');
      }

      onSetupChange(next);
      const provider = loginChallenge
        ? next.providers.find(
            (candidate) =>
              candidate.id === loginChallenge.providerId,
          )
        : undefined;
      if (provider?.credential.status === 'authenticated') {
        setLoginChallenge(undefined);
      }
    } catch (refreshError) {
      setError(
        userMessageFromError(
          refreshError,
          '暂时无法检查 Provider 状态，请重试。',
        ) ?? '暂时无法检查 Provider 状态，请重试。',
      );
    } finally {
      setChecking(false);
    }
  };

  const startLogin = async (providerId: string) => {
    setBusyProviderId(providerId);
    setError(null);
    let challenge: AgentProviderLoginChallenge | undefined;

    try {
      challenge = await api.startAgentProviderLogin({ providerId });

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
      setBusyProviderId(undefined);
    }
  };

  const selectProvider = async (providerId: string) => {
    setBusyProviderId(providerId);
    setError(null);

    try {
      const next = await api.selectAgentProvider({ providerId });

      if (!isAgentProviderSetupSnapshot(next)) {
        throw new Error('Agent Provider 选择响应无效');
      }

      onSetupChange(next);
      const appSetup = await api.completeAgentProviderOnboarding();

      if (!isAppSetupSnapshot(appSetup)) {
        throw new Error('应用设置状态响应无效');
      }

      onCompleted(appSetup);
    } catch (selectionError) {
      setError(
        userMessageFromError(
          selectionError,
          '无法选择该 Provider，请重新检查登录状态。',
        ) ?? '无法选择该 Provider，请重新检查登录状态。',
      );
    } finally {
      setBusyProviderId(undefined);
    }
  };

  const reopenLogin = () => {
    if (!loginChallenge) {
      return;
    }

    void api
      .openExternal({ url: challengeUrl(loginChallenge) })
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
    setBusyProviderId(loginChallenge?.providerId ?? 'onboarding');
    setError(null);

    void (loginChallenge
      ? api
          .cancelAgentProviderLogin({
            providerId: loginChallenge.providerId,
            loginId: loginChallenge.loginId,
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
        setBusyProviderId(undefined);
      });
  };

  return {
    setup,
    loginChallenge,
    busyProviderId,
    checking,
    error,
    clearError: () => setError(null),
    refresh,
    startLogin,
    selectProvider,
    reopenLogin,
    dismiss,
  };
}
