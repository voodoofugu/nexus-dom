# `view` / lazy-store design validation

This directory checks the standalone `view` and lazy-store authoring model
against focused issue-triage examples with the normal project TypeScript
configuration. The live playground uses the same public API.

```tsx
const Summary = view(
  ({ state, $, acts, refs }) => {
    return <section>{state.issues.length}</section>;
  },
  [issuesStore, filtersStore]
);
```

## Current semantics

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

### Named dependencies

A typed registry can provide autocomplete for `["issues"]` and infer the
scope from that tuple. The type-only experiment in
`named-store-dependencies.tsx` checks that a typo, access to an undeclared
store and incorrect JSX props all fail type checking.

One possible API is a view factory bound to an application registry:

```tsx
// workspace/model.ts
export const workspaceView = defineViews({ issues, preferences });

// workspace/IssueCount.tsx
import { workspaceView } from "./model";

export const IssueCount = workspaceView(
  ({ state }) => <p>{state.issues.length} issues</p>,
  ["issues"]
);
```

`defineViews` is a proposed API. A registry-backed factory could resolve names
to descriptors at definition time and keep the same app-scoped store lifetime
as `view` today.

Ancestor lookup would be a different contract. The registry can tell
TypeScript which fields an `"issues"` consumer receives. JSX composition does
not guarantee that the component is mounted under a provider. A component
could move into a preview, test or separate root and fail at runtime. A
tree-scoped API would also need rules for missing providers and duplicate
names in nested scopes.

Keep descriptor tuples as the default while evaluating whether a registry
reduces repetition across several modules in the same feature.

### Instance input

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

That is a good fit for one globally selected issue. Independently parameterized
instances use normal JSX attributes, destructured directly into local values:

```tsx
const IssueTitle = view(
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

- Whether stores merge into one flat scope or retain namespaces.
- The exact internal type signature needed to keep JSX input and dependency
  scope inference stable without exposing overload complexity to users.
- How one store explicitly depends on another store inside its actions.
- Cross-store batching and update provenance.
- Reset, persistence, devtools and initialization cleanup for late stores.
- Whether `refs` belong in a store descriptor or in a DOM-specific companion.
- The final bootstrap surface: keep `createApp()` or rename the runtime/root.
