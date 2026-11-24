/** @jsxImportSource nexus-dom */
import { defineView, store, view } from "nexus-dom";

const issues = store({
  state: { issues: [{ id: 1, title: "Review the renderer" }] },
});
const preferences = store({ state: { compact: false } });
const namedView = defineView({ issues, preferences }, { default: "issues" });

export const IssueTitle = view(
  ({ state }, { issueId }: { issueId: number }) =>
    <strong>{state.issues.find((issue) => issue.id === issueId)?.title}</strong>,
  [issues]
);

export function checkNamedDependencies() {
  const NamedIssueTitle = namedView(
    ({ state, $ }, { issueId }: { issueId: number }) => {
      // @ts-expect-error preferences is outside this dependency tuple.
      void $.compact;
      return <strong>{state.issues.find((issue) => issue.id === issueId)?.title}</strong>;
    },
    ["issues"]
  );

  const IssueCount = namedView(
    ({ state }) => <p class={state.compact ? "compact" : ""}>{state.issues.length}</p>,
    ["issues", "preferences"]
  );

  const DefaultCount = namedView(({ state }) => {
    // @ts-expect-error Only issues is available through the default scope.
    void state.compact;
    return <p>{state.issues.length}</p>;
  });

  namedView(({ state }) => {
    // @ts-expect-error An explicit list replaces the default scope.
    void state.issues;
    return <p>{String(state.compact)}</p>;
  }, ["preferences"]);

  // @ts-expect-error Typo in the default name.
  defineView({ issues, preferences }, { default: "isssues" });

  // @ts-expect-error Typo in the registry key.
  namedView(() => <p />, ["isssues"]);

  // @ts-expect-error JSX still requires the correct prop type.
  const invalidTitle = <NamedIssueTitle issueId="1" />;
  void invalidTitle;
  return <><NamedIssueTitle issueId={1} /><IssueCount /><DefaultCount /></>;
}
