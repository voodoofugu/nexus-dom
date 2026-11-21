import type { CommitEvent, UpdateContext } from "nexus-dom";

export function createPlaygroundDiagnostics() {
  let commits = 0;
  let views = 0;
  let commitOutput: HTMLOutputElement | null = null;
  let viewOutput: HTMLOutputElement | null = null;
  let history: HTMLOListElement | null = null;
  let surface: HTMLElement | null = null;

  const Panel = () => (
    <aside class="diagnostics">
      <div class="diagnostic-copy">
        <p class="eyebrow">Runtime evidence</p>
        <h2>Tracked regions and provenance</h2>
        <p>View runs count local region evaluations. DOM commits keep the Nexus action that caused them.</p>
      </div>
      <div class="metrics">
        <p><span>View runs</span><output ref={(node) => (viewOutput = node as HTMLOutputElement)}>{views}</output></p>
        <p><span>DOM commits</span><output ref={(node) => (commitOutput = node as HTMLOutputElement)}>0</output></p>
      </div>
      <ol class="history" ref={(node) => (history = node as HTMLOListElement)}><li>Waiting for an update</li></ol>
    </aside>
  );

  return {
    Panel,
    surfaceRef(node: unknown) {
      surface = node as HTMLElement | null;
    },
    viewRun(_name: string) {
      views++;
      if (viewOutput) viewOutput.value = String(views);
    },
    onCommit(event: CommitEvent<UpdateContext>) {
      commits++;
      if (commitOutput) commitOutput.value = String(commits);
      const source = event.contexts.at(-1)?.source ?? "manual";
      if (history) {
        const entry = document.createElement("li");
        const label = document.createElement("strong");
        const updates = document.createElement("span");
        label.textContent = source;
        updates.textContent = `${event.updates} update${event.updates === 1 ? "" : "s"}`;
        entry.append(label, updates);
        history.prepend(entry);
        while (history.children.length > 6) history.lastElementChild?.remove();
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
