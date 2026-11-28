# Changelog

## 1.0.0

- Render standard JSX with fine-grained DOM bindings, tracked components and keyed lists.
- Declare stores with `store` and share lazy namespaces through `componentScope`.
- Mount the first root with `createApp(view, target)` and switch live branches with `.if(...)`.
- Configure application state, actions and refs with `store()`.
- Use `component` and `componentScope` in place of the pre-release `app.view` method.
- Read a stable `id` string in components. Render to HTML and hydrate it with matching IDs and JSON store snapshots.
- Install ESM or CommonJS with declarations for each module format.
