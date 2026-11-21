import type { CommitEvent, RendererOptions } from "./types.js";

interface PendingUpdate<C> {
  run: () => void;
  context?: C;
}

export interface Scheduler<C> {
  enqueue(token: object, run: () => void, context?: C): void;
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
          if (!options.onError) throw error;
          options.onError(error);
        }
      }
    }

    if (updates > 0) {
      options.onCommit?.({ updates, contexts } satisfies CommitEvent<C>);
    }
  };

  return {
    enqueue(token, run, context) {
      pending.set(token, {
        run,
        ...(context === undefined ? {} : { context }),
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
