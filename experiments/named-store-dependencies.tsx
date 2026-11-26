/** @jsxImportSource nexus-dom */
import { componentScope, store } from "nexus-dom";

const issues = store({
  state: { items: [{ id: 1, title: "Review the renderer" }] },
});
const preferences = store({ state: { compact: false } });
const draft = store({ name: "draft", state: { editing: false } });
const workspaceComponent = componentScope({ issues, preferences });

const IssueTitle = workspaceComponent(
  ({ state }, { issueId }: { issueId: number }) => {
    const issue = state.issues.items.find((item) => item.id === issueId);
    return <strong class={state.preferences.compact ? "compact" : ""}>
      {state.draft.editing ? "Editing" : issue?.title}
    </strong>;
  },
  [draft]
);

export function checkComponentScopeTypes() {
  workspaceComponent(({ state }) => {
    // @ts-expect-error Draft is local to IssueTitle.
    void state.draft;
    // @ts-expect-error Typo in the registry key.
    void state.isssues;
    return null;
  });

  // @ts-expect-error JSX still requires the correct prop type.
  const invalidTitle = <IssueTitle issueId="1" />;
  void invalidTitle;
  return <IssueTitle issueId={1} />;
}
