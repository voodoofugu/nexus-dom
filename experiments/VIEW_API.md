# Component and lazy-store design

This directory checks the standalone `component` and lazy-store authoring model
against focused issue-triage examples with the normal project TypeScript
configuration. The live playground uses the same public API.

```tsx
const Summary = component(
  ({ state, $, acts, refs }) => {
    return <section>{state.issues.length}</section>;
  },
  [issuesStore, filtersStore]
);
```

## Current semantics

- `store(options)` declares state, actions and refs but does not create a
  module-global state instance.
- `component(render, dependencies)` defines a component. Its dependency tuple is
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

### Read-based store namespaces

`componentScope({ issues, preferences })` puts the groups under
`state.issues` and `state.preferences`, with the same names under `$`,
`acts` and `refs`. An array such as `[draft]` adds named stores to one
component. `component(render, [draft])` uses the same namespace from the
descriptor's `name`. Reading one group's state subscribes the view to that store.
Conditional reads add or remove subscriptions on the next render.

The dogfood uses this form throughout. The keyed list uses `$.$select` to
derive its rows from the issues and filters stores. Evaluate field-level
tracking inside a group before choosing the release API.

### Instance input

The dogfood screens need no props: selection, filters and issue data naturally
belong to shared stores. This spike intentionally has no props object. For
example, the selected issue title reads `selectedIssueId` from the same
dependency as the issue collection:

```tsx
const SelectedIssueTitle = component(
  ({ state }) => {
    return <strong>{findSelectedIssue(state)?.title}</strong>;
  },
  [issuesStore]
);
```

That is a good fit for one globally selected issue. Independently parameterized
instances use normal JSX attributes, destructured directly into local values:

```tsx
const IssueTitle = component(
  ({ state }, { issueId }: { issueId: number }) => {
    return <strong>{findIssue(state.issues, issueId)?.title}</strong>;
  },
  [issuesStore]
);

return <li><IssueTitle issueId={issue.id} /></li>;
```

The JSX boundary remains conventional while the implementation uses `issueId`
directly rather than `props.issueId`. Required and optional attributes and
`children` remain statically checked.

## Still unresolved

- Field-level tracking inside component scopes.
- Whether `app.view` still earns a public entry before the first stable release.
