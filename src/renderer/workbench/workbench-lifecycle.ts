export interface WorkbenchLifecycleLease {
  readonly previous: Promise<void>;
  readonly completed: Promise<void>;
  release(): void;
}

export class WorkbenchLifecycleCoordinator {
  private tail: Promise<void> = Promise.resolve();

  acquire(): WorkbenchLifecycleLease {
    const previous = this.tail;
    let released = false;
    let releaseSignal!: () => void;
    const releasedTask = new Promise<void>((resolve) => {
      releaseSignal = resolve;
    });
    const completed = Promise.allSettled([
      previous,
      releasedTask,
    ]).then(() => undefined);

    this.tail = completed;

    return {
      previous,
      completed,
      release() {
        if (released) {
          return;
        }

        released = true;
        releaseSignal();
      },
    };
  }

  whenIdle(): Promise<void> {
    return this.tail;
  }
}
