/** @jsxImportSource nexus-dom */
import { store, view, type Renderable, type ViewScope, type VNode } from "nexus-dom";

const issues = store({
  state: { issues: [{ id: 1, title: "Review the renderer" }] },
});
const preferences = store({ state: { compact: false } });
const registry = { issues, preferences };

type Registry = typeof registry;
type Dependencies<Names extends readonly (keyof Registry)[]> = {
  [Index in keyof Names]: Registry[Names[Index]];
};

// Type-only sketch of a view factory bound to the application's registry.
type NamedView = <
  const Names extends readonly (keyof Registry)[],
  Props extends object,
>(
  render: (scope: ViewScope<Dependencies<Names>>, props: Props) => Renderable,
  dependencies: Names
) => (props: Props) => VNode;

export const IssueTitle = view(
  ({ state }, { issueId }: { issueId: number }) =>
    <strong>{state.issues.find((issue) => issue.id === issueId)?.title}</strong>,
  [issues]
);

export function checkNamedDependencies(namedView: NamedView) {
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

  // @ts-expect-error Typo in the registry key.
  namedView(() => <p />, ["isssues"]);

  // @ts-expect-error JSX still requires the correct prop type.
  const invalidTitle = <NamedIssueTitle issueId="1" />;
  void invalidTitle;
  return <><NamedIssueTitle issueId={1} /><IssueCount /></>;
}
