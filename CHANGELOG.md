# Changelog

## 1.0.0

- Render standard JSX with fine-grained DOM bindings, tracked components and keyed lists.
- Declare stores with `store` and share lazy namespaces through `componentScope`.
- Mount the first root with `createApp(view, target)` and switch live branches with `.if(...)`.
- Use `component` and `componentScope` in place of the pre-release `app.view` method.
- Render to HTML and hydrate it with stable component IDs and JSON store snapshots.
- Install ESM or CommonJS with declarations for each module format.
