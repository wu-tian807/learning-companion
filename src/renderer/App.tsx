import { useState } from 'react';

import type { ProjectSnapshot } from '../shared/projects';
import { Home } from './Home';
import { ProjectPage } from './ProjectPage';
import { SettingsDialog } from './components/SettingsDialog';

type AppPage =
  | { readonly kind: 'home' }
  | { readonly kind: 'project'; readonly project: ProjectSnapshot };

export function App() {
  const [page, setPage] = useState<AppPage>({ kind: 'home' });
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      {page.kind === 'project' ? (
        <ProjectPage
          project={page.project}
          onBack={() => setPage({ kind: 'home' })}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <Home
          onOpenProject={(project) => {
            setPage({ kind: 'project', project });
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}
