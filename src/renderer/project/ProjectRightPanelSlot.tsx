import type { ReactNode } from 'react';

import type { ProjectRightPanelKind } from './use-project-layout';

export function ProjectRightPanelSlot({
  panel,
  inline,
  generation,
  conversation,
}: {
  readonly panel: ProjectRightPanelKind | null;
  readonly inline: boolean;
  readonly generation: ReactNode;
  readonly conversation: ReactNode;
}) {
  if (!panel) return null;

  return (
    <div
      id="project-right-panel"
      data-project-right-panel={panel}
      className={
        inline
          ? 'h-full min-h-0 w-[clamp(318px,20vw,390px)] min-w-0 shrink-0'
          : 'absolute inset-y-0 right-0 z-30 h-full min-h-0 w-[min(390px,calc(100%-20px))] min-w-0 shadow-2xl'
      }
    >
      {panel === 'conversation' ? conversation : generation}
    </div>
  );
}
