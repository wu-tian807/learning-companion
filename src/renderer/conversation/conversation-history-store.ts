import { cloneConversationRecords } from '../../shared/project-conversations';
import type { LearningCompanionApi } from '../../shared/ipc';
import type { ConversationHistoryStore } from './conversation-contracts';

type ProjectConversationApi = Pick<
  LearningCompanionApi,
  | 'listProjectConversations'
  | 'saveProjectConversation'
  | 'deleteProjectConversation'
>;

interface ProjectConversationHistoryStoreOptions {
  readonly projectId: string;
  readonly api?: ProjectConversationApi;
}

function defaultApi(): ProjectConversationApi | undefined {
  return globalThis.window?.learningCompanion;
}

export function createProjectConversationHistoryStore({
  projectId,
  api = defaultApi(),
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
      const records = await api.listProjectConversations({ projectId });
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
  };
}
