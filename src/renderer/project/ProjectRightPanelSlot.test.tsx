import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProjectRightPanelSlot } from './ProjectRightPanelSlot';

function render(panel: 'generation' | 'conversation' | null, inline = true) {
  return renderToStaticMarkup(
    <ProjectRightPanelSlot
      panel={panel}
      inline={inline}
      generation={<div data-panel-content="generation" />}
      conversation={<div data-panel-content="conversation" />}
    />,
  );
}

describe('ProjectRightPanelSlot', () => {
  it('renders no right column when the shared slot is closed', () => {
    expect(render(null)).toBe('');
  });

  it('keeps both panels mounted while showing only the selected inline view', () => {
    const generation = render('generation');

    expect(generation).toContain('id="project-right-panel"');
    expect(generation).toContain('data-project-right-panel="generation"');
    expect(generation).toContain('data-panel-content="generation"');
    expect(generation).toContain('data-panel-content="conversation"');
    expect(generation).toMatch(
      /class="hidden" aria-hidden="true"><div data-panel-content="conversation"/u,
    );
  });

  it('uses the same right slot for the conversation overlay', () => {
    const conversation = render('conversation', false);

    expect(conversation).toContain('data-project-right-panel="conversation"');
    expect(conversation).toContain('data-panel-content="conversation"');
    expect(conversation).toContain('data-panel-content="generation"');
    expect(conversation).toMatch(
      /class="hidden" aria-hidden="true"><div data-panel-content="generation"/u,
    );
    expect(conversation).toContain('absolute');
    expect(conversation).toContain('right-0');
  });
});
