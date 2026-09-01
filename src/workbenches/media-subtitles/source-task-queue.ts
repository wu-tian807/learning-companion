export interface MediaSubtitleSourceTaskQueueApi {
  enqueue<T>(
    key: string,
    task: () => Promise<T>,
    priority?: MediaSubtitleSourceTaskPriority,
  ): Promise<T>;
  promote(key: string): void;
}

export type MediaSubtitleSourceTaskPriority = 'interactive' | 'background';

interface PendingSourceTask {
  readonly key: string;
  readonly run: () => Promise<void>;
  priority: MediaSubtitleSourceTaskPriority;
}

/** Serializes local ASR work across every media Workbench in the app. */
export class MediaSubtitleSourceTaskQueue
  implements MediaSubtitleSourceTaskQueueApi
{
  private readonly pending: PendingSourceTask[] = [];
  private running = false;

  enqueue<T>(
    key: string,
    task: () => Promise<T>,
    priority: MediaSubtitleSourceTaskPriority = 'interactive',
  ): Promise<T> {
    const result = new Promise<T>((resolve, reject) => {
      this.pending.push({
        key,
        priority,
        run: async () => {
          try {
            resolve(await task());
          } catch (error) {
            reject(error);
          }
        },
      });
    });
    this.runNext();
    return result;
  }

  promote(key: string): void {
    const pending = this.pending.find((entry) => entry.key === key);
    if (pending) pending.priority = 'interactive';
  }

  private runNext(): void {
    if (this.running) return;
    const index = this.pending.findIndex(
      ({ priority }) => priority === 'interactive',
    );
    const [next] = this.pending.splice(index >= 0 ? index : 0, 1);
    if (!next) return;

    this.running = true;
    void Promise.resolve()
      .then(next.run)
      .finally(() => {
        this.running = false;
        this.runNext();
      });
  }
}

export const mediaSubtitleSourceTaskQueue =
  new MediaSubtitleSourceTaskQueue();
