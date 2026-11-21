import type { CommitEvent, RendererOptions } from "./types.js";

interface PendingUpdate<C> {
  run: () => void;
  context?: C;
  handleError?: (error: unknown) => boolean;
}

export interface Scheduler<C> {
  enqueue(
    token: object,
    run: () => void,
    context?: C,
    handleError?: (error: unknown) => boolean
  ): void;
  cancel(token: object): void;
  flush(): void;
}

export function createScheduler<C>(
  options: RendererOptions<C>
): Scheduler<C> {
  const schedule = options.schedule ?? "microtask";
  const pending = new Map<object, PendingUpdate<C>>();
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    if (pending.size === 0) return;

    let updates = 0;
    const contexts: C[] = [];

    while (pending.size > 0) {
      const batch = Array.from(pending.values());
      pending.clear();

      for (const update of batch) {
        try {
          update.run();
          updates++;
          if (update.context !== undefined) contexts.push(update.context);
        } catch (error) {
          let unhandled = error;
          try {
            if (update.handleError?.(error)) {
              updates++;
              if (update.context !== undefined) contexts.push(update.context);
              continue;
            }
          } catch (boundaryError) {
            unhandled = boundaryError;
          }
          if (options.onError) options.onError(unhandled);
          else throw unhandled;
        }
      }
    }

    if (updates > 0) {
      options.onCommit?.({ updates, contexts } satisfies CommitEvent<C>);
    }
  };

  return {
    enqueue(token, run, context, handleError) {
      pending.set(token, {
        run,
        ...(context === undefined ? {} : { context }),
        ...(handleError === undefined ? {} : { handleError }),
      });

      if (schedule === "manual" || scheduled) return;
      scheduled = true;
      if (schedule === "animationFrame") requestAnimationFrame(flush);
      else queueMicrotask(flush);
    },
    cancel(token) {
      pending.delete(token);
    },
    flush,
  };
}
