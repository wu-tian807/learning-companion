import { cloneConversationRecords } from '../../shared/project-conversations';
import type { LearningCompanionApi } from '../../shared/ipc';
import type { ConversationHistoryStore } from './conversation-contracts';
import {
  migrateLegacyProjectConversations,
  type LegacyConversationStorage,
} from './legacy-project-conversation-migration';

type ProjectConversationApi = Pick<
  LearningCompanionApi,
  | 'listProjectConversations'
  | 'saveProjectConversation'
  | 'deleteProjectConversation'
> &
  Partial<
    Pick<
      LearningCompanionApi,
      | 'getOrCreateBoundProjectConversation'
      | 'rebuildBoundProjectConversation'
    >
  >;

interface ProjectConversationHistoryStoreOptions {
  readonly projectId: string;
  readonly api?: ProjectConversationApi;
  readonly legacyStorage?: LegacyConversationStorage;
}

function defaultApi(): ProjectConversationApi | undefined {
  return globalThis.window?.learningCompanion;
}

export function createProjectConversationHistoryStore({
  projectId,
  api = defaultApi(),
  legacyStorage,
}: ProjectConversationHistoryStoreOptions): ConversationHistoryStore {
  if (!projectId.trim() || !api) {
    throw new Error('Project Conversation Store 初始化失败');
  }
  let memory = cloneConversationRecords([]);
  let loaded = false;
  let loadTask: Promise<typeof memory> | undefined;
  const listeners = new Set<() => void>();

  const publish = (records: typeof memory) => {
    memory = cloneConversationRecords(records);
    for (const listener of [...listeners]) listener();
    return memory;
  };

  const load = async (): Promise<typeof memory> => {
    if (loaded) return memory;
    loadTask ??= (async () => {
      const migrated = await migrateLegacyProjectConversations({
        projectId,
        api,
        ...(legacyStorage ? { storage: legacyStorage } : {}),
      });
      const records = migrated ?? await api.listProjectConversations({ projectId });
      loaded = true;
      return publish(records);
    })().finally(() => {
      loadTask = undefined;
    });
    return loadTask;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return memory;
    },
    list: load,
    async save(record) {
      await load();
      return publish(
        await api.saveProjectConversation({
          projectId,
          conversation: record,
        }),
      );
    },
    async remove(conversationId) {
      await load();
      return publish(
        await api.deleteProjectConversation({
          projectId,
          conversationId,
        }),
      );
    },
    async getOrCreateBoundConversation(boundAssetId, modeId) {
      await load();
      if (!api.getOrCreateBoundProjectConversation) {
        throw new Error('绑定对话恢复能力未接入');
      }
      const conversation = await api.getOrCreateBoundProjectConversation({
        projectId,
        boundAssetId,
        modeId,
      });
      const records = await api.listProjectConversations({ projectId });
      publish(records);
      return conversation;
    },
    async rebuildBoundConversation(boundAssetId, modeId) {
      await load();
      if (!api.rebuildBoundProjectConversation) {
        throw new Error('绑定对话重建能力未接入');
      }
      const conversation = await api.rebuildBoundProjectConversation({
        projectId,
        boundAssetId,
        modeId,
      });
      const records = await api.listProjectConversations({ projectId });
      publish(records);
      return conversation;
    },
  };
}
