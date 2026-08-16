import type {
  GenerationTaskEvent,
  GenerationTaskView,
  StartGenerationTaskRequest,
} from '../../shared/generation-tasks';

export interface StartedConversationTask {
  readonly taskId: string;
  readonly snapshot?: GenerationTaskView;
}

export interface ConversationTaskClient {
  start(request: StartGenerationTaskRequest): Promise<StartedConversationTask>;
  retry(projectId: string, taskId: string): Promise<StartedConversationTask>;
  get(projectId: string, taskId: string): Promise<GenerationTaskView | undefined>;
  cancel(projectId: string, taskId: string): Promise<void>;
  subscribe(listener: (event: GenerationTaskEvent) => void): () => void;
}

async function latestSnapshot(
  projectId: string,
  taskId: string,
): Promise<GenerationTaskView | undefined> {
  try {
    return await window.learningCompanion.getGenerationTask({ projectId, taskId });
  } catch {
    return undefined;
  }
}

const defaultConversationTaskClient: ConversationTaskClient = {
  async start(request) {
    const started = await window.learningCompanion.startGenerationTask(request);
    return {
      taskId: started.id,
      snapshot: await latestSnapshot(request.projectId, started.id),
    };
  },
  async retry(projectId, taskId) {
    const retried = await window.learningCompanion.retryGenerationTask({
      projectId,
      taskId,
    });
    return {
      taskId: retried.id,
      snapshot: await latestSnapshot(projectId, retried.id),
    };
  },
  get: latestSnapshot,
  async cancel(projectId, taskId) {
    await window.learningCompanion.cancelGenerationTask({ projectId, taskId });
  },
  subscribe(listener) {
    return window.learningCompanion.onGenerationTaskChanged(listener);
  },
};

export const conversationTaskClient: ConversationTaskClient = Object.freeze(
  defaultConversationTaskClient,
);
