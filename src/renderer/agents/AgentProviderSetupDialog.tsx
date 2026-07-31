import type { AgentProviderSetupSnapshot } from '../../shared/agent-providers';
import type { AppSetupSnapshot } from '../../shared/app-setup';
import { ErrorDialog } from '../components/ErrorDialog';
import { AgentProviderCard } from './AgentProviderCard';
import {
  defaultAgentProviderSetupApi,
  type AgentProviderSetupApi,
} from './agent-provider-api';
import { useAgentProviderSetup } from './use-agent-provider-setup';

interface AgentProviderSetupDialogProps {
  readonly setup: AgentProviderSetupSnapshot;
  readonly onSetupChange: (setup: AgentProviderSetupSnapshot) => void;
  readonly onCompleted: (setup: AppSetupSnapshot) => void;
  readonly api?: AgentProviderSetupApi;
}

export function AgentProviderSetupDialog({
  setup,
  onSetupChange,
  onCompleted,
  api = defaultAgentProviderSetupApi,
}: AgentProviderSetupDialogProps) {
  const controller = useAgentProviderSetup({
    setup,
    onSetupChange,
    onCompleted,
    api,
  });

  return (
    <div className="fixed inset-0 z-[54] grid place-items-center bg-[#0c1016]/88 p-6 backdrop-blur-md">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-provider-setup-title"
        className="flex max-h-[min(760px,calc(100vh-48px))] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-white/[0.12] bg-[#252a32] shadow-[0_34px_100px_rgba(0,0,0,0.6)]"
      >
        <header className="border-b border-white/[0.08] px-7 py-6">
          <h1
            id="agent-provider-setup-title"
            className="text-2xl font-semibold text-slate-100"
          >
            选择 AI Provider
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            之后可在右上角“设置”中更改。
          </p>
        </header>

        <div className="overflow-y-auto px-7 py-6">
          <div className="space-y-3">
            {setup.providers.map((provider) => (
              <AgentProviderCard
                key={provider.id}
                provider={provider}
                loginChallenge={controller.loginChallenge}
                busy={controller.busyProviderId === provider.id}
                checking={controller.checking}
                selectedActionLabel="完成"
                onLogin={() => {
                  void controller.startLogin(provider.id);
                }}
                onSelect={() => {
                  void controller.selectProvider(provider.id);
                }}
                onRefresh={() => {
                  void controller.refresh(provider.id);
                }}
                onReopenLogin={controller.reopenLogin}
              />
            ))}
          </div>

          {setup.providers.length === 0 && (
            <div className="rounded-[18px] border border-rose-300/15 bg-rose-400/[0.05] p-5 text-sm text-rose-200">
              当前没有可用的 AI Provider。
            </div>
          )}
        </div>

        <footer className="flex justify-end border-t border-white/[0.08] px-7 py-5">
          <button
            type="button"
            disabled={controller.busyProviderId !== undefined}
            onClick={controller.dismiss}
            className="ui-control h-10 shrink-0 rounded-full border border-white/[0.12] px-4 text-sm text-slate-300 disabled:opacity-40"
          >
            跳过
          </button>
        </footer>
      </section>

      {controller.error && (
        <ErrorDialog
          message={controller.error}
          onClose={controller.clearError}
        />
      )}
    </div>
  );
}
