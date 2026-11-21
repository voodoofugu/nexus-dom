import { nexusDOMError } from "./errors.js";

type Cleanup = () => void;
type ErrorHandler = (error: unknown) => void;

export class Owner {
  private children: Set<Owner> | undefined;
  private cleanups: Cleanup | Cleanup[] | undefined;
  private disposed = false;
  private errorHandler: ErrorHandler | undefined;

  constructor(readonly parent?: Owner, tracked = true) {
    if (parent && tracked) (parent.children ??= new Set()).add(this);
  }

  addCleanup(cleanup: Cleanup) {
    if (this.disposed) {
      cleanup();
      return;
    }
    const cleanups = this.cleanups;
    if (!cleanups) this.cleanups = cleanup;
    else if (Array.isArray(cleanups)) cleanups.push(cleanup);
    else this.cleanups = [cleanups, cleanup];
  }

  setErrorHandler(handler: ErrorHandler) {
    this.errorHandler = handler;
  }

  handleError(error: unknown): boolean {
    if (this.errorHandler) {
      try {
        this.errorHandler(error);
        return true;
      } catch (nextError) {
        if (this.parent) return this.parent.handleError(nextError);
        throw nextError;
      }
    }
    return this.parent?.handleError(error) ?? false;
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
    if (Array.isArray(cleanups)) {
      for (let index = cleanups.length - 1; index >= 0; index--) {
        cleanups[index]?.();
      }
      cleanups.length = 0;
    } else cleanups?.();
    this.cleanups = undefined;
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
