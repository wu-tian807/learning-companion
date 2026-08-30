import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
} from '../../../main/generation/generation-task-service';
import type { GenerationTaskSnapshot } from '../../../main/generation/generation-task';

export interface HtmlEditGenerationLifecycle {
  handleTaskSnapshot(snapshot: GenerationTaskSnapshot): Promise<void>;
  handleTaskDiscarded(projectId: string, taskId: string): Promise<void>;
}

export class HtmlEditGenerationObserver {
  private readonly unsubscribe: () => void;
  private readonly pending = new Set<Promise<void>>();
  private disposed = false;

  constructor(
    tasks: GenerationTaskServiceApi,
    private readonly lifecycle: HtmlEditGenerationLifecycle,
    private readonly logger: Pick<Console, 'error'> = console,
  ) {
    this.unsubscribe = tasks.subscribe((event) => this.accept(event));
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
  }

  private accept(event: GenerationTaskServiceEvent): void {
    if (this.disposed) return;
    let operation: Promise<void> | undefined;
    if (event.type === 'task-completed' || event.type === 'task-changed') {
      if (
        event.snapshot.completed ||
        event.snapshot.failure ||
        event.snapshot.cancelledTime !== undefined
      ) {
        operation = this.lifecycle.handleTaskSnapshot(event.snapshot);
      }
    } else if (event.type === 'task-discarded') {
      operation = this.lifecycle.handleTaskDiscarded(
        event.projectId,
        event.taskId,
      );
    }
    if (!operation) return;

    this.pending.add(operation);
    void operation
      .catch((error) => {
        this.logger.error('[html-editing] GenerationTask 收口失败', error);
      })
      .finally(() => this.pending.delete(operation!));
  }
}
