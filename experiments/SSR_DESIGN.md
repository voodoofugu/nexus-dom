# SSR, hydration and deterministic component IDs

SSR must be designed together with component identity. A random or process-wide
counter cannot promise the same output on the server and client.

## Public surface

```tsx
const Field = view(
  ({ id }, { name }: { name: string }) => {
    const inputId = id("input");
    const hintId = id("hint");
    return <label for={inputId}><input id={inputId} name={name} aria-describedby={hintId} /><small id={hintId}>Required</small></label>;
  },
  [form]
);

const html = renderToString(<App />, { idPrefix: "account" });
hydrate(<App />, document.querySelector("#app")!, { idPrefix: "account" });
```

`id(localKey)` is preferable to an order-only hook: explicit local keys remain
stable when an unrelated conditional ID is added. Calling it with the same key
in one component returns the same value.

## Identity contract

- Every mounted component has an owner path scoped to one root.
- A root has an explicit or generated `idPrefix`; generated prefixes are unique,
  while callers must keep explicit prefixes unique when roots share a document.
- Component IDs hash `contractVersion + idPrefix + ownerPath + localKey`; the
  fixed markup form is `nxs-` plus seven alphanumeric base62 characters.
- Keyed rows use type-preserving keyed owner segments, so moves and initial
  order changes preserve IDs.
- A per-root claim map detects a hash collision before duplicate DOM IDs can be
  emitted. Hashing keeps markup compact but does not protect sensitive inputs.
- A disposed and remounted component at the same structural owner path reuses
  its ID; moving it to a different unkeyed path changes the ID.
- Server and hydration traversal must produce identical owner paths.
- View reruns and bounded reconciliation reuse the existing owner path.

## Rendering phases

1. **Implemented:** add owner identity and `id(localKey)` to the browser renderer
   without changing DOM output unless requested. Tracked, dynamic, keyed and
   boundary traversals now match on browser and server; reruns and keyed moves
   retain their identity.
2. **Implemented:** synchronous `renderToString` for elements, fragments,
   components, store views, text, keyed/dynamic regions, boundaries and current
   `LiveValue` values. Each call gets independent lazy stores; setup is skipped
   because there is no server-safe opt-in contract yet.
3. Define hydration markers for empty text, dynamic regions and keyed blocks.
   Plain stable element trees should hydrate by structural walking; structural
   regions need minimal deterministic boundaries.
4. Implement hydration that reuses DOM, attaches events/refs/subscriptions and
   reports a structured mismatch before falling back to local replacement.
5. Verify identical HTML/IDs, keyed moves, multiple roots, nested boundaries,
   failed hydration cleanup and client-only store setup.

## Open decisions

- Whether server rendering may await store initialization; the first version
  should remain synchronous unless an explicit async contract is introduced.
- Marker format and the cost of comment-free hydration.
- Serialization/hydration of initial lazy-store state.
- Development-only mismatch diagnostics versus production fallback behavior.
