/** @jsxImportSource nexus-dom */
import { store, view } from "nexus-dom";

type IssueStatus = "backlog" | "active" | "done";
type IssueFilter = "all" | IssueStatus;

interface Issue {
  id: number;
  title: string;
  status: IssueStatus;
}

const issues = store({
  state: {
    issues: [] as Issue[],
    selectedIssueId: null as number | null,
  },
  refs: {
    inspector: null as HTMLElement | null,
  },
  acts: (get, set, refs) => ({
    selectIssue(id: number) {
      set({ selectedIssueId: id });
      refs.inspector.current?.focus();
    },
    cycleStatus(id: number) {
      const next: Record<IssueStatus, IssueStatus> = {
        backlog: "active",
        active: "done",
        done: "backlog",
      };
      set({
        issues: get("issues").map((issue) =>
          issue.id === id ? { ...issue, status: next[issue.status] } : issue
        ),
      });
    },
  }),
});

const filters = store({
  state: {
    query: "",
    filter: "all" as IssueFilter,
    compact: false,
  },
  refs: {
    search: null as HTMLInputElement | null,
  },
  acts: (_get, set, refs) => ({
    setQuery(query: string) {
      set({ query });
    },
    setFilter(filter: IssueFilter) {
      set({ filter });
    },
    focusSearch() {
      refs.search.current?.focus();
    },
  }),
});

// No props: all application data comes from the declared store dependency.
export const Summary = view(
  ({ state }) => {
    const counts = state.issues.reduce(
      (result, issue) => {
        result[issue.status]++;
        return result;
      },
      { backlog: 0, active: 0, done: 0 }
    );

    return (
      <section class="summary">
        <strong>{state.issues.length}</strong>
        <span>{counts.backlog}</span>
        <span>{counts.active}</span>
        <span>{counts.done}</span>
      </section>
    );
  },
  [issues]
);

// Multiple stores form one fully typed scope.
export const Toolbar = view(
  ({ state, $, acts, refs }) => (
    <section class={$.compact.map((compact) => (compact ? "compact" : ""))}>
      <input
        ref={refs.search}
        value={state.query}
        onInput={(event) =>
          acts.setQuery((event.currentTarget as HTMLInputElement).value)
        }
      />
      <button onClick={() => acts.setFilter("active")}>Active</button>
      <button onClick={acts.focusSearch}>Focus</button>
      <button onClick={() => acts.selectIssue(1)}>Select first</button>
    </section>
  ),
  [issues, filters]
);

// Requiring the same descriptor in another view reuses the app-scoped store;
// the dependency remains explicit so the callback is independently typed.
export const Inspector = view(
  ({ state, acts, refs }) => {
    const issue = state.issues.find(
      (candidate) => candidate.id === state.selectedIssueId
    );
    return issue ? (
      <aside ref={refs.inspector} tabIndex={-1}>
        <strong>{issue.title}</strong>
        <button onClick={() => acts.cycleStatus(issue.id)}>Next status</button>
      </aside>
    ) : null;
  },
  [issues]
);

// The store-driven form is concise for the dogfood's single active selection.
export const SelectedIssueTitle = view(
  ({ state }) => {
    const issue = state.issues.find(
      (candidate) => candidate.id === state.selectedIssueId
    );
    return <strong>{issue?.title}</strong>;
  },
  [issues]
);

interface IssueTitleInput {
  issueId: number;
  emphasis?: "normal" | "strong";
  children?: import("../src/index.js").Renderable;
}

// JSX attributes remain the explicit per-instance input. Destructuring keeps
// the values direct inside user logic rather than requiring `props.issueId`.
export const IssueTitle = view(
  (
    { state },
    { issueId, emphasis = "normal", children }: IssueTitleInput
  ) => {
    const issue = state.issues.find((candidate) => candidate.id === issueId);
    return emphasis === "strong" ? (
      <strong>{issue?.title}{children}</strong>
    ) : (
      <span>{issue?.title}{children}</span>
    );
  },
  [issues]
);

const jsxInputProof = <IssueTitle issueId={1} emphasis="strong">!</IssueTitle>;
void jsxInputProof;

// @ts-expect-error issueId is a required JSX attribute.
const missingInputProof = <IssueTitle />;
void missingInputProof;

// @ts-expect-error optional JSX attributes retain their declared union.
const invalidInputProof = <IssueTitle issueId={1} emphasis="loud" />;
void invalidInputProof;

// The complete screen is also a view; no component closes over an `app` value.
export const DogfoodApp = view(
  ({ $ }) => (
    <main class={$.compact.map((compact) => (compact ? "compact" : ""))}>
      <Toolbar />
      <Summary />
      <Inspector />
      <section><IssueTitle issueId={1} /></section>
    </main>
  ),
  [issues, filters]
);

view(
  ({ state }) => {
    // @ts-expect-error filters was not declared as a dependency.
    state.query;
    return null;
  },
  [issues]
);

const conflictingIssues = store({
  state: { issues: "not an issue array" },
});

view(
  () => null,
  // @ts-expect-error duplicate state keys are rejected before runtime.
  [issues, conflictingIssues]
);
