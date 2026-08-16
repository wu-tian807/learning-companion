import { describe, expect, it } from 'vitest';

import { getGlobalAiChatStore } from '../../workbenches/document-ai/renderer/ai-chat/chat-store';
import { openProjectAiQuestion } from './project-ai-question';

describe('project AI question module', () => {
  it('opens through the Project-level public entry point', () => {
    const store = getGlobalAiChatStore();
    store.setPanelOpen(false);

    openProjectAiQuestion();

    expect(store.getSnapshot().panelOpen).toBe(true);
    store.setPanelOpen(false);
  });
});
