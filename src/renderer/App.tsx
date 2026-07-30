import { useCallback, useEffect, useState } from 'react';

import {
  isAppSetupSnapshot,
  type AppSetupSnapshot,
} from '../shared/app-setup';
import { userMessageFromError } from '../shared/ipc-error';
import type { ProjectSnapshot } from '../shared/projects';
import { Home } from './Home';
import { ProjectPage } from './ProjectPage';
import { SettingsDialog } from './components/SettingsDialog';
import { ExternalLibraryRuntimeController } from './external-libraries/ExternalLibraryRuntimeController';
import { NotificationHost } from './notifications/NotificationHost';
import { AppSetupGate } from './onboarding/AppSetupGate';
import { FirstRunOnboarding } from './onboarding/FirstRunOnboarding';
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
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupLoadError, setSetupLoadError] =
    useState<string | null>(null);
  const openSettings = useCallback((target: SettingsTarget) => {
    setSettingsTarget(target);
  }, []);
  const loadAppSetup = useCallback(async () => {
    try {
      setAppSetup(await readAppSetup());
    } catch (error) {
      setSetupLoadError(
        userMessageFromError(
          error,
          '无法读取首次运行设置，请重试。',
        ) ?? '无法读取首次运行设置，请重试。',
      );
    } finally {
      setSetupLoading(false);
    }
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
          setSetupLoadError(
            userMessageFromError(
              error,
              '无法读取首次运行设置，请重试。',
            ) ?? '无法读取首次运行设置，请重试。',
          );
        }
      })
      .finally(() => {
        if (active) {
          setSetupLoading(false);
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
          target={settingsTarget}
          onClose={() => setSettingsTarget(null)}
        />
      )}
      <AppSetupGate
        loading={setupLoading}
        error={setupLoadError}
        onRetry={() => {
          setSetupLoading(true);
          setSetupLoadError(null);
          void loadAppSetup();
        }}
      />
      {!setupLoading &&
        !setupLoadError &&
        appSetup?.requiresOnboarding && (
          <FirstRunOnboarding onCompleted={setAppSetup} />
        )}
      <NotificationHost />
    </>
  );
}
