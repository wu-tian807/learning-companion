import { useCallback, useState } from 'react';

import type { ProjectSnapshot } from '../shared/projects';
import { Home } from './Home';
import { ProjectPage } from './ProjectPage';
import { SettingsDialog } from './components/SettingsDialog';
import { ExternalLibraryRuntimeController } from './external-libraries/ExternalLibraryRuntimeController';
import { NotificationHost } from './notifications/NotificationHost';
import type { SettingsTarget } from './settings/settings-target';

type AppPage =
  | { readonly kind: 'home' }
  | { readonly kind: 'project'; readonly project: ProjectSnapshot };

export function App() {
  const [page, setPage] = useState<AppPage>({ kind: 'home' });
  const [settingsTarget, setSettingsTarget] =
    useState<SettingsTarget | null>(null);
  const openSettings = useCallback((target: SettingsTarget) => {
    setSettingsTarget(target);
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
        <SettingsDialog onClose={() => setSettingsTarget(null)} />
      )}
      <NotificationHost />
    </>
  );
}
