import { nexusDOMError } from "./errors.js";

type Cleanup = () => void;

export class Owner {
  private children: Set<Owner> | undefined;
  private cleanups: Cleanup[] | undefined;
  private disposed = false;

  constructor(readonly parent?: Owner) {
    if (parent) (parent.children ??= new Set()).add(this);
  }

  addCleanup(cleanup: Cleanup) {
    if (this.disposed) {
      cleanup();
      return;
    }
    (this.cleanups ??= []).push(cleanup);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.children) {
      for (const child of Array.from(this.children)) child.dispose();
      this.children.clear();
      this.children = undefined;
    }

    const cleanups = this.cleanups;
    if (cleanups) {
      for (let index = cleanups.length - 1; index >= 0; index--) {
        cleanups[index]?.();
      }
      cleanups.length = 0;
      this.cleanups = undefined;
    }
    this.parent?.children?.delete(this);
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
    throw nexusDOMError(
      "CLEANUP_OUTSIDE_COMPONENT",
      "onCleanup() must run inside a component."
    );
  }
  currentOwner.addCleanup(cleanup);
}
