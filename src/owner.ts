type Cleanup = () => void;

export class Owner {
  readonly children = new Set<Owner>();
  readonly cleanups: Cleanup[] = [];
  private disposed = false;

  constructor(readonly parent?: Owner) {
    parent?.children.add(this);
  }

  addCleanup(cleanup: Cleanup) {
    if (this.disposed) {
      cleanup();
      return;
    }
    this.cleanups.push(cleanup);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    for (const child of Array.from(this.children)) child.dispose();
    this.children.clear();

    for (let index = this.cleanups.length - 1; index >= 0; index--) {
      this.cleanups[index]?.();
    }
    this.cleanups.length = 0;
    this.parent?.children.delete(this);
  }
}

let currentOwner: Owner | undefined;

export function withOwner<T>(owner: Owner, run: () => T): T {
  const previous = currentOwner;
  currentOwner = owner;
  try {
    return run();
  } finally {
    currentOwner = previous;
  }
}

/** Registers component cleanup against its current owner scope. */
export function onCleanup(cleanup: Cleanup) {
  if (!currentOwner) {
    throw new Error("[nexus-dom] onCleanup must run inside a component.");
  }
  currentOwner.addCleanup(cleanup);
}
