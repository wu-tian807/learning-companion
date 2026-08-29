export interface MediaSubtitleSourceTaskQueueApi {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

/** Serializes local ASR work across every media Workbench in the app. */
export class MediaSubtitleSourceTaskQueue
  implements MediaSubtitleSourceTaskQueueApi
{
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export const mediaSubtitleSourceTaskQueue =
  new MediaSubtitleSourceTaskQueue();
