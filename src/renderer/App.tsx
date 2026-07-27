import { useState } from 'react';

import type { ProjectSnapshot } from '../shared/projects';
import { Home } from './Home';
import { ProjectPage } from './ProjectPage';

type AppPage =
  | { readonly kind: 'home' }
  | { readonly kind: 'project'; readonly project: ProjectSnapshot };

export function App() {
  const [page, setPage] = useState<AppPage>({ kind: 'home' });

  if (page.kind === 'project') {
    return <ProjectPage project={page.project} onBack={() => setPage({ kind: 'home' })} />;
  }

  return (
    <Home
      onOpenProject={(project) => {
        setPage({ kind: 'project', project });
      }}
    />
  );
}
