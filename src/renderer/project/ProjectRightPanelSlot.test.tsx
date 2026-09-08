import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProjectRightPanelSlot } from './ProjectRightPanelSlot';

function render(
  panel: 'generation' | 'conversation' | 'learning-note' | null,
  inline = true,
) {
  return renderToStaticMarkup(
    <ProjectRightPanelSlot
      panel={panel}
      inline={inline}
      generation={<div data-panel-content="generation" />}
      conversation={<div data-panel-content="conversation" />}
      learningNote={<div data-panel-content="learning-note" />}
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

  it('uses the same right slot for the Project learning note', () => {
    const note = render('learning-note');

    expect(note).toContain('data-project-right-panel="learning-note"');
    expect(note).toContain('data-panel-content="learning-note"');
    expect(note).toContain('data-panel-content="generation"');
    expect(note).toContain('data-panel-content="conversation"');
    expect(note).toMatch(
      /class="hidden" aria-hidden="true"><div data-panel-content="generation"/u,
    );
    expect(note).toMatch(
      /class="hidden" aria-hidden="true"><div data-panel-content="conversation"/u,
    );
    expect(note).toContain('role="separator"');
    expect(note).toContain('aria-label="调整学习笔记宽度"');
    expect(note).toContain('aria-valuemin="318"');
    expect(note).toContain('aria-valuemax="720"');
    expect(note).toContain('cursor-col-resize');
  });

  it('does not expose the resize handle for the other shared panels', () => {
    expect(render('generation')).not.toContain('role="separator"');
    expect(render('conversation')).not.toContain('role="separator"');
  });
});
