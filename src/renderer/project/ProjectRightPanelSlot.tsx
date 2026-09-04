import type { ReactNode } from 'react';

import type { ProjectRightPanelKind } from './use-project-layout';

export function ProjectRightPanelSlot({
  panel,
  inline,
  generation,
  conversation,
  learningNote,
}: {
  readonly panel: ProjectRightPanelKind | null;
  readonly inline: boolean;
  readonly generation: ReactNode;
  readonly conversation: ReactNode;
  readonly learningNote: ReactNode;
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
      <div
        className={panel === 'conversation' ? 'h-full min-h-0' : 'hidden'}
        aria-hidden={panel !== 'conversation'}
      >
        {conversation}
      </div>
      <div
        className={panel === 'generation' ? 'h-full min-h-0' : 'hidden'}
        aria-hidden={panel !== 'generation'}
      >
        {generation}
      </div>
      <div
        className={panel === 'learning-note' ? 'h-full min-h-0' : 'hidden'}
        aria-hidden={panel !== 'learning-note'}
      >
        {learningNote}
      </div>
    </div>
  );
}
