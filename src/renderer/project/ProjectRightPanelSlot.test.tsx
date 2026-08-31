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

  it('renders exactly one selected panel in the inline third column', () => {
    const generation = render('generation');

    expect(generation).toContain('id="project-right-panel"');
    expect(generation).toContain('data-project-right-panel="generation"');
    expect(generation).toContain('data-panel-content="generation"');
    expect(generation).not.toContain('data-panel-content="conversation"');
  });

  it('uses the same right slot for the conversation overlay', () => {
    const conversation = render('conversation', false);

    expect(conversation).toContain('data-project-right-panel="conversation"');
    expect(conversation).toContain('data-panel-content="conversation"');
    expect(conversation).not.toContain('data-panel-content="generation"');
    expect(conversation).toContain('absolute');
    expect(conversation).toContain('right-0');
  });
});
