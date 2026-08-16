import { getGlobalAiChatStore } from '../../workbenches/document-ai/renderer/ai-chat/chat-store';

/**
 * Public renderer entry point for any Workbench that wants to show the
 * project-level question module. A Workbench may first supply a selected
 * region through the shared chat store, then call this function.
 */
export function openProjectAiQuestion(): void {
  getGlobalAiChatStore().setPanelOpen(true);
}
