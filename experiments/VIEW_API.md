# Type-only `view` / lazy-store experiment

This directory does not change the runtime or public package API. It checks a
candidate authoring model against the issue-triage dogfood with the normal
project TypeScript configuration.

```tsx
const Summary = view(
  ({ state, $, acts, refs }) => {
    return <section>{state.issues.length}</section>;
  },
  [issuesStore, filtersStore]
);
```

## Candidate semantics

- `store(options)` declares state, actions and refs but does not create a
  module-global state instance.
- `view(render, dependencies)` defines a component. Its dependency tuple is
  static and supplies the complete types of `state`, `$`, `acts` and `refs`.
- On first mount in an app, a descriptor is resolved to a new app-scoped store.
  Later views requiring the same descriptor reuse that instance and its current
  values. Different apps get independent instances.
- A view does not implicitly inherit every store mounted by an ancestor. This
  avoids render-order-dependent types and hidden dependencies.
- Store instances live until app disposal. Unmounting the first consumer does
  not destroy shared state.
- Duplicate state, action or ref keys across one dependency tuple are invalid.

## Props experiment

The dogfood screens need no props: selection, filters and issue data naturally
belong to shared stores. This spike intentionally has no props object. For
example, the selected issue title reads `selectedIssueId` from the same
dependency as the issue collection:

```tsx
const SelectedIssueTitle = view(
  ({ state }) => {
    return <strong>{findSelectedIssue(state)?.title}</strong>;
  },
  [issuesStore]
);
```

That is a good fit for one globally selected issue. For two independently
parameterized instances, the spike tests direct positional input rather than a
props container:

```tsx
const IssueTitle = view(
  ({ state }, issueId: number) => {
    return <strong>{findIssue(state.issues, issueId)?.title}</strong>;
  },
  [issuesStore]
);

return <li>{IssueTitle(issue.id)}</li>;
```

`issueId` is inferred at the call site and is used directly in the view logic.
This loses conventional `<IssueTitle issueId={...} />` syntax, so the experiment
must compare readability and ownership behavior before choosing it. It does
avoid both a global `selectedIssueId` workaround and `props.issueId` access.

## Still unresolved

- Whether stores merge into one flat scope or retain namespaces.
- Whether direct calls such as `IssueTitle(id)` are clearer than JSX props, and
  how their identity and ownership behave when the surrounding view reruns.
- How one store explicitly depends on another store inside its actions.
- Cross-store batching and update provenance.
- Reset, persistence, devtools and initialization cleanup for late stores.
- Whether `refs` belong in a store descriptor or in a DOM-specific companion.
- The final bootstrap surface: keep `createApp()` or rename the runtime/root.
