/** @jsxImportSource nexus-dom */
import { component, componentScope, persist, store } from "nexus-dom";
import { createPlaygroundDiagnostics } from "./diagnostics.js";

type IssueStatus = "backlog" | "active" | "done";
type IssuePriority = "low" | "medium" | "high";
type IssueFilter = "all" | IssueStatus;

interface Issue {
  id: number;
  code: string;
  title: string;
  summary: string;
  status: IssueStatus;
  priority: IssuePriority;
  owner: string;
}

const initialIssues: Issue[] = [
  { id: 1, code: "ND-31", title: "Test tracked views in a real workflow", summary: "Use ordinary expressions for summaries and structural panels.", status: "active", priority: "high", owner: "Georg" },
  { id: 2, code: "ND-28", title: "Preserve focus during keyed moves", summary: "Verify native moveBefore and the WebKit compatibility path.", status: "done", priority: "high", owner: "Renderer" },
  { id: 3, code: "ND-24", title: "Profile dense rows with eight bindings", summary: "Find the point where a local rerun becomes cheaper.", status: "backlog", priority: "medium", owner: "Benchmarks" },
  { id: 4, code: "ND-19", title: "Expose update provenance in tooling", summary: "Connect Nexus action context to visible DOM commits.", status: "active", priority: "medium", owner: "Devtools" },
  { id: 5, code: "ND-12", title: "Evaluate an optional JSX transform", summary: "Wait until runtime view semantics are validated by dogfood.", status: "backlog", priority: "low", owner: "Compiler" },
];

const nextStatus: Record<IssueStatus, IssueStatus> = {
  backlog: "active",
  active: "done",
  done: "backlog",
};

const preferences = store({
  state: { compact: false },
  acts: ({ get, set }) => ({
    toggleCompact() {
      set({ compact: !get("compact") });
    },
  }),
  mount({ nexus }) {
    return persist(nexus, { key: "nexus-dom-workspace", include: ["compact"] });
  },
});

const filters = store({
  state: { query: "", filter: "all" as IssueFilter },
  refs: { search: null as HTMLInputElement | null },
  acts: ({ set, refs }) => ({
    setQuery(query: string) {
      set({ query });
    },
    clearQuery() {
      set({ query: "" });
      refs.search.current?.focus();
    },
    setFilter(filter: IssueFilter) {
      set({ filter });
    },
    focusSearch() {
      refs.search.current?.focus();
    },
  }),
});

const issues = store({
  state: {
    items: initialIssues,
    selectedIssueId: 1 as number | null,
    nextIssueId: 6,
  },
  refs: {
    inspector: null as HTMLElement | null,
    lastSelectedIssue: null as number | null,
  },
  acts: ({ get, set, refs, list }) => {
    const findIssue = (id: number) =>
      get("items").findIndex((issue) => issue.id === id);
    const focusInspector = () =>
      requestAnimationFrame(() => refs.inspector.current?.focus());

    return {
      selectIssue(id: number) {
        refs.lastSelectedIssue.current = id;
        set({ selectedIssueId: id });
        focusInspector();
      },
      closeInspector() {
        set({ selectedIssueId: null });
      },
      createIssue() {
        const id = get("nextIssueId");
        list("items").insert(0, {
          id,
          code: `ND-${30 + id}`,
          title: `Untitled renderer experiment ${id}`,
          summary: "New issue created through an exact keyed list operation.",
          status: "backlog",
          priority: "medium",
          owner: "Unassigned",
        });
        refs.lastSelectedIssue.current = id;
        set({ selectedIssueId: id, nextIssueId: id + 1 });
        focusInspector();
      },
      cycleStatus(id: number) {
        const index = findIssue(id);
        if (index < 0) return;
        const issue = get("items")[index]!;
        list("items").replace(index, { ...issue, status: nextStatus[issue.status] });
      },
      renameSelected(title: string) {
        const id = get("selectedIssueId");
        if (id === null || title.trim() === "") return;
        const index = findIssue(id);
        if (index < 0) return;
        list("items").replace(index, {
          ...get("items")[index]!,
          title: title.trim(),
        });
      },
      moveSelectedToTop() {
        const id = get("selectedIssueId");
        if (id === null) return;
        const index = findIssue(id);
        if (index > 0) list("items").move(index, 0);
      },
      removeSelected() {
        const id = get("selectedIssueId");
        if (id === null) return;
        const items = get("items");
        const index = items.findIndex((issue) => issue.id === id);
        if (index < 0) return;
        const nextSelected = items[index + 1]?.id ?? items[index - 1]?.id ?? null;
        list("items").remove(index);
        set({ selectedIssueId: nextSelected });
        if (nextSelected !== null) focusInspector();
      },
    };
  },
});

export function createWorkspace() {
  const diagnostics = createPlaygroundDiagnostics();
  const workspaceComponent = componentScope({ issues, filters, preferences });
  const statusLabel = (status: IssueStatus) =>
    status === "backlog" ? "Backlog" : status === "active" ? "In progress" : "Done";

  const CompactToggle = component(({ $, acts }) => (
    <button class="quiet-button" onClick={acts.preferences.toggleCompact}>
      {$.preferences.compact.map((compact) => (compact ? "Comfortable" : "Compact"))}
    </button>
  ), { preferences });

  const Toolbar = workspaceComponent(
    ({ $, acts, refs }) => {
      diagnostics.viewRun("toolbar");
      const statusFilters: Array<{ value: IssueFilter; label: string }> = [
        { value: "all", label: "All issues" },
        { value: "backlog", label: "Backlog" },
        { value: "active", label: "In progress" },
        { value: "done", label: "Done" },
      ];

      return (
        <section class="toolbar" aria-label="Issue filters">
          <label class="search-field">
            <span>Search issues</span>
            <input
              ref={refs.filters.search}
              type="search"
              value={$.filters.query}
              placeholder="Title, code or owner"
              onInput={(event) => acts.filters.setQuery((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <button class="quiet-button" onClick={acts.filters.clearQuery}>Clear</button>
          <div class="filters" role="group" aria-label="Status">
            {statusFilters.map(({ value, label }) => (
              <button
                aria-pressed={$.filters.filter.map((filter) => filter === value)}
                onClick={() => acts.filters.setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <CompactToggle />
        </section>
      );
    }
  );

  const Summary = workspaceComponent(
    ({ state }) => {
      diagnostics.viewRun("summary");
      const items = state.issues.items;
      const counts = items.reduce(
        (result, issue) => {
          result[issue.status]++;
          return result;
        },
        { backlog: 0, active: 0, done: 0 }
      );

      return (
        <section class="summary" aria-label="Issue summary">
          <article><span>Total</span><strong>{items.length}</strong></article>
          <article><span>Backlog</span><strong>{counts.backlog}</strong></article>
          <article><span>In progress</span><strong>{counts.active}</strong></article>
          <article><span>Done</span><strong>{counts.done}</strong></article>
        </section>
      );
    }
  );

  const IssueList = workspaceComponent(
    ({ $, acts }) => {
      diagnostics.viewRun("issue-list");
      const visibleIssues = $.$select((state) => {
        const { query: search, filter } = state.filters;
        const query = search.trim().toLowerCase();
        return state.issues.items.filter((issue) => {
          const matchesFilter = filter === "all" || issue.status === filter;
          const matchesQuery = query === "" ||
            issue.title.toLowerCase().includes(query) ||
            issue.code.toLowerCase().includes(query) ||
            issue.owner.toLowerCase().includes(query);
          return matchesFilter && matchesQuery;
        });
      });

      return (
        <section class="list-panel" aria-label="Issues">
          <div class="panel-heading">
            <div><p class="eyebrow">Keyed collection</p><h2>Renderer work queue</h2></div>
            <button class="primary" onClick={acts.issues.createIssue}>New issue</button>
          </div>

          <ul class="issue-list">
            {visibleIssues.each(
              (issue) => issue.id,
              ($issue) => {
                const id = $issue.id.get();
                return (
                  <li data-status={$issue.status} data-priority={$issue.priority}>
                    <button
                      class="issue-main"
                      aria-current={$.issues.selectedIssueId.map((selected) => selected === id ? "true" : undefined)}
                      onClick={() => acts.issues.selectIssue(id)}
                    >
                      <span class="issue-code">{$issue.code}</span>
                      <strong>{$issue.title}</strong>
                      <span class="issue-summary">{$issue.summary}</span>
                      <span class="issue-owner">{$issue.owner}</span>
                    </button>
                    <button class="status-button" onClick={() => acts.issues.cycleStatus(id)}>
                      {$issue.status.map(statusLabel)}
                    </button>
                  </li>
                );
              }
            )}
          </ul>

          {visibleIssues.map((items) => items.length === 0).if(
            <div class="empty-state">
              <strong>No matching issues</strong>
              <span>Change the filter or clear the search query.</span>
            </div>
          )}
        </section>
      );
    }
  );

  const Inspector = workspaceComponent(
    ({ state, acts, refs }) => {
      diagnostics.viewRun("inspector");
      const { items, selectedIssueId } = state.issues;
      const issue = items.find((candidate) => candidate.id === selectedIssueId);

      if (!issue) {
        return (
          <aside class="inspector inspector--empty">
            <p class="eyebrow">Tracked view</p>
            <h2>Select an issue</h2>
            <p>The inspector uses ordinary state reads, array methods and a normal conditional. Only this owned region reruns.</p>
            <button onClick={acts.filters.focusSearch}>Focus search</button>
          </aside>
        );
      }

      return (
        <aside class="inspector" tabIndex={-1} ref={refs.issues.inspector}>
          <div class="inspector-heading">
            <div><p class="eyebrow">{issue.code} · tracked view</p><h2>{issue.title}</h2></div>
            <button class="icon-button" aria-label="Close inspector" onClick={acts.issues.closeInspector}>×</button>
          </div>
          <p class="inspector-summary">{issue.summary}</p>
          <dl class="issue-facts">
            <div><dt>Status</dt><dd>{statusLabel(issue.status)}</dd></div>
            <div><dt>Priority</dt><dd>{issue.priority}</dd></div>
            <div><dt>Owner</dt><dd>{issue.owner}</dd></div>
          </dl>
          <label class="title-editor">
            <span>Rename on blur</span>
            <input value={issue.title} onChange={(event) => acts.issues.renameSelected((event.currentTarget as HTMLInputElement).value)} />
          </label>
          <div class="inspector-actions">
            <button onClick={() => acts.issues.cycleStatus(issue.id)}>Next status</button>
            <button onClick={acts.issues.moveSelectedToTop}>Move to top</button>
            <button class="danger" onClick={acts.issues.removeSelected}>Delete</button>
          </div>
          <div class="view-note">
            <strong>What this tests</strong>
            <p>`view` injects state, bindings, actions and refs. Updating this issue replaces only the inspector region; the keyed row keeps its DOM identity.</p>
          </div>
        </aside>
      );
    }
  );

  const App = workspaceComponent(
    ({ $, acts }) => {
      diagnostics.viewRun("app-shell");
      return (
        <main class={$.preferences.compact.map((compact) => compact ? "workspace is-compact" : "workspace")} ref={diagnostics.surfaceRef}>
          <header class="page-header">
            <div>
              <p class="eyebrow">nexus-dom dogfood</p>
              <h1>Issue triage workspace</h1>
              <p>App-scoped state, actions and refs with tracked views for ordinary expressions and fine-grained bindings for hot DOM updates.</p>
            </div>
          <button class="primary" onClick={acts.issues.createIssue}>Create issue</button>
          </header>
          <Toolbar />
          <Summary />
          <div class="workspace-grid"><IssueList /><Inspector /></div>
          <diagnostics.Panel />
        </main>
      );
    }
  );

  return { App, onCommit: diagnostics.onCommit };
}
