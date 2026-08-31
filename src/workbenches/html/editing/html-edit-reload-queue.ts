export class HtmlEditReloadQueue {
  private tail = Promise.resolve();
  private completeActive: (() => void) | undefined;
  private disposed = false;

  enqueue(startReload: () => void): void {
    const queued = this.tail
      .catch(() => undefined)
      .then(() => {
        if (this.disposed) return;
        return new Promise<void>((resolve) => {
          this.completeActive = resolve;
          startReload();
        });
      });
    this.tail = queued;
  }

  complete(): boolean {
    const complete = this.completeActive;
    if (!complete) return false;
    this.completeActive = undefined;
    complete();
    return true;
  }

  async drain(): Promise<void> {
    await this.tail;
  }

  dispose(): void {
    this.disposed = true;
    this.complete();
  }
}
