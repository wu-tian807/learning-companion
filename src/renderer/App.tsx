import { useCallback, useEffect, useState } from 'react';

import {
  isAppSetupSnapshot,
  type AppSetupSnapshot,
} from '../shared/app-setup';
import type { ProjectSnapshot } from '../shared/projects';
import { Home } from './Home';
import { ProjectPage } from './ProjectPage';
import { AgentProviderSetupDialog } from './agents/AgentProviderSetupDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { ExternalLibraryRuntimeController } from './external-libraries/ExternalLibraryRuntimeController';
import { NotificationHost } from './notifications/NotificationHost';
import { FirstRunOnboarding } from './onboarding/FirstRunOnboarding';
import { notifySetupReadFailure } from './onboarding/setup-read-failure-notification';
import type { SettingsTarget } from './settings/settings-target';

type AppPage =
  | { readonly kind: 'home' }
  | { readonly kind: 'project'; readonly project: ProjectSnapshot };

async function readAppSetup(): Promise<AppSetupSnapshot> {
  const setup = await window.learningCompanion.getAppSetup();

  if (!isAppSetupSnapshot(setup)) {
    throw new Error('应用设置状态响应无效');
  }

  return setup;
}

export function App() {
  const [page, setPage] = useState<AppPage>({ kind: 'home' });
  const [settingsTarget, setSettingsTarget] =
    useState<SettingsTarget | null>(null);
  const [appSetup, setAppSetup] =
    useState<AppSetupSnapshot | null>(null);
  const openSettings = useCallback((target: SettingsTarget) => {
    setSettingsTarget(target);
  }, []);
  useEffect(() => {
    let active = true;

    void readAppSetup()
      .then((setup) => {
        if (active) {
          setAppSetup(setup);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          notifySetupReadFailure('app-onboarding', error);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <ExternalLibraryRuntimeController
        onOpenSettings={openSettings}
      />
      {page.kind === 'project' ? (
        <ProjectPage
          key={page.project.id}
          project={page.project}
          onBack={() => setPage({ kind: 'home' })}
          onOpenSettings={() =>
            openSettings({ section: 'general' })
          }
        />
      ) : (
        <Home
          onOpenProject={(project) => {
            setPage({ kind: 'project', project });
          }}
          onOpenSettings={() =>
            openSettings({ section: 'general' })
          }
        />
      )}
      {settingsTarget && (
        <SettingsDialog
          key={
            settingsTarget.section === 'external-libraries'
              ? `${settingsTarget.section}:${settingsTarget.libraryId ?? ''}`
              : settingsTarget.section
          }
          target={settingsTarget}
          onClose={() => setSettingsTarget(null)}
        />
      )}
      {appSetup?.pendingOnboardingStep === 'external-library' && (
        <FirstRunOnboarding onCompleted={setAppSetup} />
      )}
      {appSetup?.pendingOnboardingStep === 'agent-provider' && (
        <AgentProviderSetupDialog onCompleted={setAppSetup} />
      )}
      <NotificationHost />
    </>
  );
}
