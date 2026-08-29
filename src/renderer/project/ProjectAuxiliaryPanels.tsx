import type { ReactNode } from 'react';

import type { ProjectContentLayout } from './use-project-layout';

export function ProjectAuxiliaryPanels({
  contentLayout,
  conversationActive,
  conversationOpen,
  conversationPanel,
  generationPanel,
}: {
  readonly contentLayout: ProjectContentLayout;
  readonly conversationActive: boolean;
  readonly conversationOpen: boolean;
  readonly conversationPanel: ReactNode;
  readonly generationPanel: ReactNode;
}) {
  return (
    <>
      {conversationActive && (
        <div
          data-project-panel="conversation"
          className={
            conversationOpen
              ? contentLayout.conversationContainerClassName
              : 'hidden'
          }
        >
          {conversationPanel}
        </div>
      )}
      {contentLayout.showGenerationPanel && generationPanel}
    </>
  );
}
