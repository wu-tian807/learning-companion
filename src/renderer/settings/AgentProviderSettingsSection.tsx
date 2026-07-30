import { useCallback, useEffect, useState } from 'react';

import {
  isAgentProviderSetupSnapshot,
  type AgentProviderSetupSnapshot,
} from '../../shared/agent-providers';
import { userMessageFromError } from '../../shared/ipc-error';
import { AgentProviderCard } from '../agents/AgentProviderCard';
import {
  defaultAgentProviderSetupApi,
  type AgentProviderSetupApi,
} from '../agents/agent-provider-api';
import { useAgentProviderSetup } from '../agents/use-agent-provider-setup';
import { ErrorDialog } from '../components/ErrorDialog';

interface LoadedAgentProviderSettingsProps {
  readonly initialSetup: AgentProviderSetupSnapshot;
  readonly api: AgentProviderSetupApi;
}

function LoadedAgentProviderSettings({
  initialSetup,
  api,
}: LoadedAgentProviderSettingsProps) {
  const [setup, setSetup] = useState(initialSetup);
  const controller = useAgentProviderSetup({
    setup,
    onSetupChange: setSetup,
    onCompleted: () => undefined,
    api,
  });

  return (
    <>
      <div className="space-y-3">
        {setup.providers.map((provider) => (
          <AgentProviderCard
            key={provider.id}
            provider={provider}
            loginChallenge={controller.loginChallenge}
            busy={controller.busyProviderId === provider.id}
            checking={controller.checking}
            onLogin={() => {
              void controller.startLogin(provider.id);
            }}
            onSelect={() => {
              void controller.selectProvider(provider.id);
            }}
            onRefresh={() => {
              void controller.refresh();
            }}
            onReopenLogin={controller.reopenLogin}
          />
        ))}
      </div>

      {setup.providers.length === 0 && (
        <p className="text-sm text-slate-400">
          当前没有可用的 AI Provider。
        </p>
      )}

      {controller.error && (
        <ErrorDialog
          message={controller.error}
          onClose={controller.clearError}
        />
      )}
    </>
  );
}

interface AgentProviderSettingsSectionProps {
  readonly api?: AgentProviderSetupApi;
}

async function readSetup(
  api: AgentProviderSetupApi,
): Promise<AgentProviderSetupSnapshot> {
  const setup = await api.getAgentProviderSetup({
    refreshCredentials: true,
  });

  if (!isAgentProviderSetupSnapshot(setup)) {
    throw new Error('Agent Provider 设置状态响应无效');
  }

  return setup;
}

export function AgentProviderSettingsSection({
  api = defaultAgentProviderSetupApi,
}: AgentProviderSettingsSectionProps) {
  const [setup, setSetup] =
    useState<AgentProviderSetupSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setSetup(await readSetup(api));
    } catch (loadError) {
      setError(
        userMessageFromError(
          loadError,
          '无法读取 AI Provider 状态，请重试。',
        ) ?? '无法读取 AI Provider 状态，请重试。',
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    let active = true;

    void readSetup(api)
      .then((next) => {
        if (active) {
          setSetup(next);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            userMessageFromError(
              loadError,
              '无法读取 AI Provider 状态，请重试。',
            ) ?? '无法读取 AI Provider 状态，请重试。',
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [api]);

  return (
    <section>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-200">
          AI Provider
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          选择用于 AI 功能的账号。
        </p>
      </div>

      {loading && (
        <div className="animate-pulse rounded-[18px] border border-white/[0.08] bg-white/[0.025] p-5">
          <div className="h-4 w-24 rounded bg-white/[0.08]" />
          <div className="mt-3 h-3 w-48 rounded bg-white/[0.05]" />
        </div>
      )}

      {!loading && error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-rose-300/15 bg-rose-400/[0.05] px-3.5 py-3 text-xs text-rose-200"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              void load();
            }}
            className="ui-control h-8 shrink-0 rounded-full border border-rose-200/15 px-3"
          >
            重试
          </button>
        </div>
      )}

      {!loading && setup && (
        <LoadedAgentProviderSettings
          initialSetup={setup}
          api={api}
        />
      )}
    </section>
  );
}
