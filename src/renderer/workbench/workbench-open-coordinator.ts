export interface AssetWorkbenchOpenStateChange {
  readonly projectId: string;
  readonly assetId: string;
  /** Identity of one Host effect, including retries of the same Asset. */
  readonly attempt: symbol;
  readonly status: 'opening' | 'ready' | 'failed' | 'cancelled';
  readonly error?: unknown;
}

interface OpenWaiter {
  readonly assetId: string;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** Tracks only the mounted Workbench; readiness never survives its lease. */
export class WorkbenchOpenCoordinator {
  private current?: AssetWorkbenchOpenStateChange;
  private readonly waiters = new Set<OpenWaiter>();

  constructor(private readonly projectId: string) {}

  needsRetry(assetId: string): boolean {
    return this.current?.assetId === assetId && this.current.status === 'failed';
  }

  waitFor(assetId: string): Promise<void> {
    if (this.current?.assetId === assetId && this.current.status === 'ready') {
      return Promise.resolve();
    }
    if (this.needsRetry(assetId)) this.current = undefined;
    return new Promise((resolve, reject) => {
      this.waiters.add({ assetId, resolve, reject });
    });
  }

  report = (change: AssetWorkbenchOpenStateChange): void => {
    if (change.projectId !== this.projectId) return;
    if (change.status === 'opening') {
      this.cancelExcept(change.assetId);
      this.current = change;
      return;
    }
    if (change.attempt !== this.current?.attempt) return;
    this.current = change.status === 'cancelled' ? undefined : change;
    for (const waiter of this.waiters) {
      if (waiter.assetId !== change.assetId) continue;
      this.waiters.delete(waiter);
      if (change.status === 'ready') waiter.resolve();
      else waiter.reject(change.error ?? new Error(
        change.status === 'cancelled' ? '工作台打开已取消。' : '无法打开资料工作台，请重试。',
      ));
    }
  };

  cancelExcept(assetId?: string): void {
    for (const waiter of this.waiters) {
      if (waiter.assetId === assetId) continue;
      this.waiters.delete(waiter);
      waiter.reject(new Error('工作台打开已取消。'));
    }
    if (this.current?.assetId !== assetId) this.current = undefined;
  }

  dispose(): void {
    this.cancelExcept();
  }
}
