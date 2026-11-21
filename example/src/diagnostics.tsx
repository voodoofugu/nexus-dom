import type { CommitEvent, UpdateContext } from "nexus-dom";

export function createPlaygroundDiagnostics() {
  let commits = 0;
  let commitOutput: HTMLOutputElement | null = null;
  let history: HTMLOListElement | null = null;
  let surface: HTMLElement | null = null;

  const Panel = ({ appExecutions }: { appExecutions: number }) => (
    <aside class="diagnostics">
      <div class="metrics">
        <p>
          <span>App executions</span>
          <output>{appExecutions}</output>
        </p>
        <p>
          <span>DOM commits</span>
          <output ref={(node) => (commitOutput = node as HTMLOutputElement)}>
            0
          </output>
        </p>
      </div>

      <div>
        <h2>Commit provenance</h2>
        <ol
          class="history"
          ref={(node) => (history = node as HTMLOListElement)}
        >
          <li>Waiting for an update</li>
        </ol>
      </div>

      <div class="syntax">
        <h2>Runtime ternary</h2>
        <pre>
          <code>{`{positive.render((isPositive) =>
  isPositive
    ? <Positive />
    : <Negative />
)}`}</code>
        </pre>
      </div>
    </aside>
  );

  return {
    Panel,
    surfaceRef(node: unknown) {
      surface = node as HTMLElement | null;
    },
    onCommit(event: CommitEvent<UpdateContext>) {
      commits++;
      if (commitOutput) commitOutput.value = String(commits);

      const source = event.contexts.at(-1)?.source ?? "manual";
      if (history) {
        const entry = document.createElement("li");
        entry.textContent = `${source} → ${event.updates} DOM update${
          event.updates === 1 ? "" : "s"
        }`;
        history.prepend(entry);
        while (history.children.length > 8) history.lastElementChild?.remove();
      }

      if (surface) {
        surface.dataset.committed = "true";
        requestAnimationFrame(() => {
          if (surface) delete surface.dataset.committed;
        });
      }
    },
  };
}
