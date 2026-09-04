import type { ConversationModeDefinition } from './conversation-mode';
import { projectConversationMode } from './project-conversation-mode';

/** Resolves persisted conversation modes without coupling the host to a feature. */
export class ConversationModeRegistry {
  private readonly modes = new Map<string, ConversationModeDefinition>();

  constructor(modes: readonly ConversationModeDefinition[] = []) {
    this.register(projectConversationMode);
    for (const mode of modes) this.register(mode);
  }

  register(mode: ConversationModeDefinition): void {
    const id = mode.id.trim();
    if (!id || id !== mode.id) {
      throw new Error('Conversation Mode ID 无效');
    }
    const existing = this.modes.get(id);
    if (existing && existing !== mode) {
      throw new Error(`Conversation Mode 已注册：${id}`);
    }
    this.modes.set(id, mode);
  }

  resolve(
    modeId: string | undefined,
    fallback: ConversationModeDefinition,
  ): ConversationModeDefinition {
    if (!modeId || modeId === fallback.id) return fallback;
    return this.modes.get(modeId) ?? fallback;
  }
}

export const defaultConversationModeRegistry =
  new ConversationModeRegistry();
