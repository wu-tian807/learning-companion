export const HTML_STALE_HISTORICAL_ANCHOR_MESSAGE =
  '引用原文已被修改，无法定位到原位置。';

export function staleHistoricalAnchorMessage(
  historicalLookupActive: boolean,
  found: boolean,
): string | undefined {
  return historicalLookupActive && !found
    ? HTML_STALE_HISTORICAL_ANCHOR_MESSAGE
    : undefined;
}

export function shouldRefreshHtmlDraftPreview(
  previewedDraftRevision: string | undefined,
  observedDraftRevision: string,
): boolean {
  return previewedDraftRevision !== observedDraftRevision;
}

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
