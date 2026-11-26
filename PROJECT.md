# nexus-dom — experiment context

_Started: 2026-11-21 · status: working alpha_

## Goal

Test whether the subscription and provenance model of `nexus-state` can support a small, understandable DOM renderer with precise updates and reliable resource ownership.

This is not currently a framework project. Fine-grained DOM binding is the first hypothesis, not a locked architecture. Component reruns, local reconciliation and hybrid approaches remain valid outcomes of the experiment.

## First hypothesis

A component executes once to create DOM. Stable `LiveValue` objects connect Nexus keys or selectors to concrete text/property bindings. Nexus updates invalidate only those bindings; a scheduler deduplicates them and commits the latest values.

```text
nexus.set
→ subscribed LiveValue
→ dirty binding set
→ DOM commit
```

The renderer preserves the Nexus update context so tooling can explain which state transition caused each DOM commit.

The public application path is deliberately small: `bind(store)` creates (and
caches) the reactive view of Nexus state, while `render(view, target)` owns the
renderer instance. `createDOMRenderer` is a low-level escape hatch rather than a
required setup step.

The new primary authoring experiment uses standalone `store(...)` descriptors
and `component(render, dependencies)` JSX components. `createApp()` owns the renderer
roots and lazily resolves each descriptor to one app-scoped Nexus instance;
different apps stay isolated. Component input remains normal JSX attributes,
destructured directly as the render callback's second argument. The previous
`createApp({ state, refs, acts })` facade remains available while the new model
is validated and still owns the convenient `app.render(...)` entry point.

`app.view(({ state, $, acts, refs }) => JSX)` is the first hybrid-rendering
experiment. It tracks ordinary top-level state reads, reruns only the owned
region through the renderer scheduler, and injects the complete application
scope so the component tree does not have to transport state, actions or
runtime refs. Stable local trees of plain elements, text and unchanged live
bindings are reconciled positionally in place; text, properties, events and
refs update without losing element identity or focus. Structural changes and
component, keyed or dynamic boundaries still use atomic owned replacement.
This is intentionally smaller than a general Virtual DOM renderer; fine-grained
`$` bindings and keyed `.each(...)` remain the primary hot paths.

## Current boundaries

- Browser DOM rendering, synchronous HTML serialization and hydration for the
  current VNode model, including strict JSON state transfer for lazy stores.
- `nexus-state` is a regular dependency, not copied into the renderer runtime.
- The renderer owns DOM and lifecycle; `nexus-state` owns data and actions.
- No general Virtual DOM or whole-tree reconciliation; tracked views only have
  a bounded positional fast path for stable plain-DOM shapes.
- No claim of being universally faster: subscriptions, binding objects and cleanup have their own costs.
- `Show` established branch ownership; keyed lists now reuse the same owner and
  cleanup model without introducing a component-like `<For>` primitive.
- Keyed arrays use `liveArray.each(key, project)` rather than a component-like
  `<For>` control flow. Unchanged rows preserve DOM identity and ownership;
  changed values update `$item` bindings without rerunning or replacing the row.
- General reorders use LIS to minimize physical moves. `app.list(key)` attaches
  insert/remove/move/replace metadata to the existing Nexus `UpdateContext`, so
  direct array bindings can skip the O(n) key scan for known operations.
- Keyed blocks prefer `ParentNode.moveBefore()` so modern browsers retain focus
  and DOM state during moves; `insertBefore()` remains the compatibility path.
- `app.list(key).batch(...)` preserves an ordered set of operations and unique
  operation ids through one automatically batched Nexus notification. Arbitrary
  array replacement still uses O(n) reconciliation because identity alone does
  not describe a diff.
- Keyed blocks and dynamic branches retain their actual top-level nodes. No
  item/dynamic/show comments, wrapper elements or custom Nexus attributes are
  injected into user markup.
- DOM block references remain private renderer ownership. They are not stored in
  Nexus state, because one store may feed several roots and DOM resources must
  follow root disposal. `app.refs` is reserved for explicit user runtime values.
- `nexus-state` is a regular dependency and the default data model. Its core API
  is re-exported so applications can install and import only `nexus-dom`; the
  small structural `NexusSource` contract remains available for future adapters.
- `styled-atom` integration should use lifecycle ownership rather than merging its runtime into this package.
- `app.dispose()` owns all roots and setup cleanups; `setup({ onCleanup })`
  provides lifecycle for sockets and other user runtime refs.
- SVG elements use their native namespace, and `animationFrame` scheduling is
  available for paint-aligned canvas/scroll-style workloads.
- Initial mount failures dispose partial owners before rethrowing. Dynamic
  branches are prepared off-DOM and retain the previous branch on failure;
  scheduled errors can be observed through renderer `onError` without blocking
  unrelated bindings in the same commit.
- Library-owned failures use exported `NexusDOMError` with the visual format
  `nexus-dom: [CODE]` followed by an actionable message. Errors thrown by user
  code remain untouched.

## Structural hash decision

A hash of serialized list or DOM structure is not used as an update protocol.
An order-sensitive hash can show that an arbitrary tree changed, but it cannot
describe which rows moved or which DOM operations restore the new order. A
per-row hash still requires an O(n) pass, duplicates keyed identity and needs a
collision check. Maintaining hashes incrementally would itself require precise
mutation metadata, which `app.list(...)` already provides without losing the
operation. Hashes may still be useful later for hydration or immutable-subtree
memoization, but they do not reduce the physical work of a full reverse.

## Validation questions

1. Is a stable live value in JSX easy to understand?
2. Can components execute once without making dynamic UI awkward?
3. Are selector dependency changes and cleanup correct?
4. Does provenance remain useful at the DOM commit boundary?
5. What are the memory and update costs per binding?
6. At what point is local rerender/reconciliation simpler than more bindings?
7. Is compiler-free `LiveValue.render(value => value ? A : B)` intuitive enough,
   or is a small transform/component rerun worth supporting bare JSX ternaries?
8. Can keyed reordering preserve identity without making worst-case full-list
   permutations disproportionately expensive?
9. Is the current stable plain-DOM reconciliation boundary sufficient for
   useful `app.view(...)` regions without growing into a general VDOM?
10. Should app-scoped imperative refs get an explicit `afterCommit` hook for
    commands such as focus, rather than relying on scheduler timing?
11. Can one deterministic owner-path contract support browser identity,
    `id(localKey)`, SSR output and hydration without turning every node into
    marked framework DOM?

Owners now expose `id(localKey)` through standalone view scope. IDs use
the fixed `nxs-<7-character hash>` form derived from a versioned root prefix,
owner path and exact local key. Typed keyed-row segments make identity
independent of list position. Browser and server rendering now mirror tracked,
dynamic, keyed and boundary ownership and produce matching IDs for the same
explicit `idPrefix` and initial tree. A per-root claim map rejects the unlikely
case of a 42-bit collision. Stable-tree hydration reuses this traversal;
structural regions still need matching boundary markers.

## Current assessment

### Strengths

- Fine-grained bindings update concrete DOM nodes without rerunning a component
  or diffing its complete subtree.
- Nexus update contexts reach the DOM commit boundary, so state provenance can
  support diagnostics and future developer tools.
- Keyed rows retain DOM identity, ownership and focus; exact list operations
  avoid rediscovering a diff that the application already knows.
- Components, runtime ternaries and keyed lists work without a compiler beyond
  the normal JSX runtime transform.
- The renderer has explicit ownership, deterministic cleanup, atomic dynamic
  branch replacement and actionable library errors.
- Local error boundaries dispose failed owned subtrees, render recovery UI and
  can remount their original children from current state.
- Update and reorder performance is already close to Solid in the current
  browser benchmark, while the API remains centered on `nexus-state`.

### Developer value

The current model is most promising for applications with long-lived DOM and
frequent sparse updates: editors, dashboards, interactive tables, task boards,
streaming status screens, scroll-driven interfaces and canvas-adjacent tools.
It is especially useful when focus, selection, element identity or explicit
update provenance matters more than recreating component trees. `createApp`
also gives existing Nexus users one integrated state, action, ref and render
lifecycle instead of another reactive runtime to coordinate.
`app.view(...)` makes that scope available at the rendering boundary, so plain
tracked state, actions, fine-grained bindings and runtime refs do not need prop
drilling or a provider hierarchy.

### Limitations

- Boolean conditional UI has compiler-free `when(live, truthy, fallback)`;
  value-dependent branches still require `.render(...)`. Bare reactive JSX
  expressions cannot work with one-shot components without a compiler or
  component reruns.
- Tracked views preserve identity for stable plain-DOM shapes, but structural
  changes and component, keyed or dynamic boundaries still replace their owned
  branch. Larger focus-sensitive trees must keep stable boundaries or move hot
  values into `$` bindings.
- Arbitrary array replacement needs O(n) keyed reconciliation. Fast exact
  operations require `app.list(...)` metadata.
- Hydration reuses stable elements/text and attaches live bindings, events,
  refs, tracked views, dynamic branches, keyed blocks and error boundaries.
  Root mismatch replacement and lazy-store state transfer exist; branch-local
  fallback does not. Server rendering intentionally skips store setup;
  hydration restores JSON-safe state before running it once on the client.
- Hydration state currently matches stores by deterministic resolution order
  plus exact top-level keys. It rejects lossy JSON values and assumes the same
  server/client view build; explicit store serialization IDs and custom codecs
  remain possible later extensions.
- Branch-local mismatch recovery is intentionally deferred. Root remount has a
  small, deterministic cleanup contract; local recovery needs evidence from
  large SSR views before adding boundary state or server markers.
- Lazy-store `setup` prepares the first client render. The one-time `mount`
  callback connects persistence and devtools after DOM adoption or insertion.
  The app owns both lifecycles and disposes their resources.
- Empty text anchors are still internal structural nodes, even though comments,
  wrappers and custom attributes were removed.
- `moveBefore()` preserves state in Chromium and Firefox. WebKit currently uses
  `insertBefore()`; the renderer keeps the active block stationary during
  general and exact moves, preserving focus in the tested cases, but cannot
  promise every other stateful-move behavior of the native primitive.
- The complete tree-shaken renderer and `nexus-state` runtime currently measure
  about `13.93 KB gzip`; actual application cost still depends on imported APIs
  and bundler behavior.
- Writable `$field.set(value | project)` covers small local
  changes without forcing one-off actions; actions remain the domain-command
  path. Runtime refs stay separate because state participates in cloning,
  reset, persistence, devtools and future server serialization.

### Current problems and likely solutions

1. **Cold mount and tail latency.** A fresh-page, first-call measurement now
   runs each renderer in a new page with balanced order. The current Chrome
   median is about `13.2 ms` for nexus-dom, `15.4 ms` for React, `14.4 ms` for
   Solid and `16.0 ms` for Preact Signals. This excludes network loading and is
   not a full cold-navigation metric; p95 and other browsers still matter.
2. **Per-row allocation.** Every keyed row owns an Owner, mutable LiveItem,
   Proxy, field storage and subscriptions. A focused sampling heap benchmark now
   separates keyed-static infrastructure from one and two DOM bindings. Single
   cleanup/field storage, a shared Proxy handler and scheduler token, a
   prototype row controller, and scalar storage for single-node rows reduced
   one-field rows from roughly `979` to `686 B/row` and two-field rows from
   `1,287` to `996 B/row`. The current ref-mount lifecycle measures keyed-static
   infrastructure at `313 B/row`, Preact Signals at `755 B/row` and Solid at
   `566 B/row`. The remaining gap to Solid is primarily binding/subscription
   state rather than retained leaks; disposal still returns to baseline.
3. **Control-flow ergonomics.** The dogfood workspace now runs on standalone
   `component(render, stores)` components and lazy app-scoped stores. Normal JSX
   attributes provide instance input while the render callback destructures
   values directly; shared state/actions/refs come from the explicit dependency
   tuple. Bounded positional reconciliation preserves stable plain DOM and
   falls back to atomic replacement for structural changes. The next design
   question is whether the flat merged scope remains clear as the application
   grows. Cross-store data writes deliberately remain separate Nexus updates;
   synchronous dependency actions are coalesced into one DOM pass that reads
   every store's final state. Store descriptors can now depend on
   other descriptors for typed action access; cycles fail explicitly, and lazy
   setup resources follow app disposal, including failed initialization.
   Plain `state` and fine-grained `$` are two subscription strategies over the
   same Nexus state. Store actions receive one extensible context with
   get/set/reset/refs/list/dependencies.
   A density benchmark over 500 components now confirms the trade-off: targeted
   `$` updates remain nearly flat as fields increase, while dense all-field
   updates cross tracked-view reconciliation between eight and sixteen fields.
   After deterministic owner paths, the sixteen-field run measured `4.8 ms` for
   bindings versus `3.9 ms` for the view, with roughly `12.2 KB` versus `2.3
   KB` retained JS per component.
4. **Generic list fallback.** Keep O(n) reconciliation for arbitrary `set` and
   improve exact operations instead of hiding scans behind structural hashes.
5. **Error recovery.** The local owned boundary now has explicit fallback,
   reset and outward propagation semantics. Event-handler and arbitrary async
   errors intentionally remain outside its rendering scope; global `onError`
   remains the final renderer-level reporting hook.
6. **Compatibility and evidence.** Chromium, Firefox and WebKit now share the
   same correctness gates and broad relative result. A 4x CPU-throttled Chrome
   run and total bundled dependency cost are recorded; real mobile hardware and
   full network-cold navigation remain necessary before public claims.

## First stable release

`1.0.0` is a possible first public version once the supported API is clear.

1. Decide whether ordinary component reads need field-level tracking inside a
   namespace. Scoped live selectors already track fields and pass the
   selection benchmark and browser smoke checks.
2. Settle the legacy `app.view` contract and supported exports. Publish API
   examples that agree with emitted declarations, following `nexus-state`
   and `morphing-scroll`.
3. Add CI and a license, run the browser smoke matrix, and install the release
   tarball in a separate consumer project.

The issue-triage browser smoke covers separate issue, filter and preference
stores. Keep issue data and selection in one store because a single action
can change both. Run the smoke with `npm run smoke:dogfood`.

## Benchmark policy

`npm run benchmark:selector-selection` changes only `selectedIssueId` in
a keyed list with an unchanged filter. Both variants update the selected ID
and keep the list mounted. In two local Chromium runs with 150 measured
updates per case, the namespaced selector reran 150 times per run. The
median for an update plus DOM flush was about 0.13 ms at 1,000 rows and
1.37 to 1.65 ms at 10,000 rows. The flat selector tracks fields and ran zero times. Its
selection-only timing fell below the fixture's timing resolution.

After adding field tracking to scoped `$.$select`, the scoped selector also
ran zero times at both row counts in the same fixture. The whole-namespace
control deliberately enumerates the issues store and still runs on all 150
updates. Ordinary `state` reads in a scoped component still subscribe at
store granularity.

Microbenchmarks are regression tools, not marketing evidence. Meaningful comparisons must use production browser builds and equal behavior. Measure initial mount, one-of-many updates, bulk updates, structural list changes, branch replacement, event storms, cleanup, heap retention and bundle size. Direct DOM is the lower bound; React, Preact Signals and Solid are comparison points once the model supports equivalent structural behavior.

### November 24 browser comparison

Production builds, 1,000 keyed rows, one local desktop run at 1× CPU.
Chromium medians in milliseconds:

| Renderer | First mount | Warm mount | Last to first | Full reverse |
| --- | ---: | ---: | ---: | ---: |
| nexus-dom | 12.0 | 1.5 | 0.7 | 1.8 |
| React | 13.4 | 1.5 | 2.7 | 2.7 |
| Solid | 12.3 | 1.6 | 0.7 | 1.7 |
| Preact Signals | 14.2 | 2.1 | 0.9 | 4.4 |

All four preserved focus in Chromium and Firefox. In WebKit, where
`moveBefore()` was unavailable, nexus-dom and React preserved focus in the
tested reorder. At 10,000 rows, the Chromium JS heap probe measured about
723 B/row for nexus-dom with one live field, 1,029 with two, 566 for Solid
and 755 for Preact Signals. The probe excludes native DOM memory.

The automated Headless Chrome benchmark covers exact row replacement, adjacent
swap, generic/LIS and exact/context last-to-first moves, full reverse and stable
dynamic branches with forced layout. Exact move is currently around `0.5 ms`
median versus `1.4 ms` for rebuilding 1,000 rows; full reverse remains roughly
equal. Keep the jsdom discrepancy as evidence that browser measurements,
identity semantics and multiple reorder shapes all matter.

The isolated Rollup/Terser ESM benchmark currently measures roughly `8.47 KB
gzip` for core, `11.73 KB` for `createApp`, and `12.37 KB` for the full main entry
with `nexus-state` externalized. The same full entry is `13.93 KB gzip` when the
tree-shaken dependency is bundled. The server entry is `6.76 KB` externalized
or `7.83 KB` with `nexus-state`. Track these separately from the playground
bundle.

The browser runner includes a forced-GC retention probe. The first warm 20-cycle
mount/update/dispose run left zero fixture nodes and about `7 KiB` heap delta;
use it only as a regression baseline because browser heap measurements vary.

The separate production comparison runner covers nexus-dom, React, Solid and
Preact Signals. Each adapter has correctness gates for row count, text update,
DOM identity, focus and keyed order before timing. Mount samples are warmed and
run through balanced permutations so one renderer does not consistently pay for
JIT or preceding allocation. After batching initial keyed construction into one
staging fragment, the current warm Chrome median for 1,000 rows is roughly `1.6
ms` for nexus-dom, `1.5 ms` for React, `1.6 ms` for Solid and `1.9 ms` for Preact
Signals. Fresh-page first-call mount is reported separately from this warm
steady-state result; full network-cold navigation is still unmeasured.

Initial keyed rows now share one staging `DocumentFragment` instead of creating
and transferring one fragment per row. On the balanced Chrome mount benchmark,
the A/B median improved from roughly `2.0 ms` to `1.6 ms` for 1,000 reactive
rows at a cost of about `0.11 KB gzip`.

The comparison runner also measures JS heap after forced GC at 1,000 and 10,000
rows, and again after disposal. The current optimized one-field keyed model uses
about `6.5 MiB` for 10,000 mounted rows and returns to baseline after disposal;
native DOM memory is not represented by `JSHeapUsedSize`, so direct-DOM values
are only a JS-object baseline.

The same production workload passes in Firefox and WebKit. Firefox exposes
`moveBefore()` and retains focus naturally. WebKit does not; a constrained LIS
and neighbor-shifting exact move keep the focused block stationary. WebKit now
retains focus for nexus-dom in the benchmark where Solid and Preact Signals do
not. Absolute Firefox/WebKit timings have coarser resolution than Chrome and are
used mainly for relative behavior and regression detection.

The CPU-throttled Chrome workload uses a 4x CDP slowdown. In the current run,
nexus-dom had the lowest fresh-page first-mount median (`16.9 ms`) and its warm
1,000-row mount (`6.4 ms`) stayed near React (`6.9 ms`) and Solid (`7.3 ms`).
Full reverse was `6.7 ms`, compared with Solid `6.3 ms`, React `11.0 ms` and
Preact Signals `17.6 ms`. This isolates CPU pressure on the desktop browser; it
does not model a phone's memory, GPU, thermal limits or network.
