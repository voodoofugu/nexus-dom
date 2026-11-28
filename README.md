![nexus-dom banner](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/banner-logo.png)

<h2></h2>

### Table of contents

- [About](#about)
- [Installation](#installation)
- [Quick start](#quick-start)
- [API](#api)
- [Recipes](#recipes)
- [License](#license)

<h2></h2>

### About

`nexus-dom` is a UI library for building browser interfaces with JSX and
TypeScript. Components declare the stores they use, so a toolbar, a list
and a details panel can share data and actions. Each application owns its
store instances and cleans up their resources when it is disposed.

Choose how each part of the interface updates. Read `state` when the component
needs to recompute its JSX, or use a `$` binding when only a DOM property or a
piece of text needs to change. You can mix both in the same component. For
example, a task list can keep each row in place when the order changes and
update a title directly while the user edits it.

The same components can render to HTML on the server. In the browser,
hydration attaches events and bindings to the existing DOM and restores
store state from the server.

<h2></h2>

### Installation

```bash
npm install nexus-dom
```

<h2></h2>

### Quick start

Configure your build tool to use the automatic JSX runtime from `nexus-dom`.

<details><summary><b>Vite 8 and TypeScript setup</b></summary>

Set the runtime in `vite.config.ts`.

```ts
import { defineConfig } from "vite";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "nexus-dom",
    },
  },
});
```

Set the JSX types in `tsconfig.json` and let Vite handle the transform.

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "nexus-dom"
  }
}
```

</details>

Add `<div id="app"></div>` to your page and mount the counter in your TSX entry.

```tsx
import { component, createApp, store } from "nexus-dom";

const counter = store({ state: { count: 0 } });

const Counter = component(
  ({ $ }) => (
    <button onClick={() => $.count.set((count) => count + 1)}>
      Clicks: {$.count}
    </button>
  ),
  [counter],
);

const app = createApp(<Counter />, "#app");
```

Call `app.dispose()` when removing the application.

<h2></h2>

### API

<details><summary><b><code>nexus-dom</code></b></summary>
<br>
<ul><div>

###### **— APPLICATION —**

<details><summary><b><code>createApp</code></b></summary>
<br>
<ul><div>

**Description:**

Creates an app with its own stores and rendering roots. Pass a view and a
target to mount immediately. Use `createApp()` to mount later or to hydrate.
`app.dispose()` releases all the app's roots and store resources.

**Parameters:**

- `view` and `target` mount the first root into an element or a selector.

<br>

**Example:**

```tsx
const app = createApp(<App />, "#app");
```

<details><summary><b>Mount in two steps</b></summary>
<br>
<ul><div>

`app.render(view, target, options?)` accepts renderer options and returns a
root handle with its own `dispose()` and `flush()`.

Use `app.onCleanup(cleanup)` to release an app-wide resource on disposal.

```tsx
const app = createApp();
const root = app.render(<App />, "#app");
root.dispose();
app.dispose();
```

</div></ul>
</details>

</div></ul>
</details>

<details><summary><b><code>onCleanup</code></b></summary>
<br>
<ul><div>

**Description:**

Registers cleanup while a plain function component renders. The renderer
calls it when that component's render scope is disposed.

**Parameters:**

- `cleanup` runs when the owner is disposed.

<br>

**Example:**

```tsx
import { onCleanup } from "nexus-dom";

function SearchInput({ onResize }: { onResize: ResizeObserverCallback }) {
  let observer: ResizeObserver | undefined;
  onCleanup(() => observer?.disconnect());

  return (
    <input
      type="search"
      ref={(node) => {
        if (!node) return;
        observer = new ResizeObserver(onResize);
        observer.observe(node);
      }}
    />
  );
}
```

> **✦ Note:** For app-scoped store resources, return a cleanup from
> `store().setup` or `store().mount`, or use their `onCleanup` callback.

</div></ul>
</details>

###### **— STORES AND COMPONENTS —**

<details><summary><b><code>store</code></b></summary>
<br>
<ul><div>

**Description:**

Declares a lazy store. Components that use the same descriptor in one app
share its instance. Its resources live until `app.dispose()`, including
when an individual root is removed.

**Parameters:**

- `options` defines initial `state`, optional `acts`, `refs`, `setup` and `mount`.
- `dependencies` (optional) lists other stores available to actions and callbacks.

<br>

**Example:**

```ts
import { persist, store } from "nexus-dom";

const preferences = store({
  state: { compact: false },
  acts: ({ reset }) => ({
    resetPreferences: () => reset("compact"),
  }),
  mount({ nexus }) {
    return persist(nexus, { key: "preferences", include: ["compact"] });
  },
});
```

> **✦ Note:** Both hooks run on the client. `setup` prepares the first render.
> `mount` runs after DOM insertion or hydration and can restore persisted
> preferences. Both can return a cleanup.

</div></ul>
</details>

<details><summary><b><code>component</code></b></summary>
<br>
<ul><div>

**Description:**

Defines a JSX component with optional store dependencies. The callback receives
its store scope and JSX props.

**Parameters:**

- `render` receives `{ state, $, acts, refs, id }` and the JSX props.
- `stores` (optional) accepts an array for flat access or a named object for
  namespaced access.

<br>

**Example:**

```tsx
const title = store({ state: { text: "Issues" } });

const Title = component(({ state }) => <h1>{state.title.text}</h1>, { title });
```

<details><summary><b>TypeScript Snippet:</b></summary>
<br>
<ul><div>

Store types are inferred. Add a type to the second parameter to declare props.

```tsx
const Title = component(
  ({ state }, { subtitle }: { subtitle: string }) => (
    <h1>
      {state.title.text} · {subtitle}
    </h1>
  ),
  { title },
);

// <Title subtitle="Open" />
```

</div></ul>
</details>

</div></ul>
</details>

<details><summary><b><code>componentScope</code></b></summary>
<br>
<ul><div>

**Description:**

Creates components with a shared map of stores. Each component resolves only
the stores it accesses. The component factory can add local entries.

**Parameters:**

- `stores` names the shared descriptors. Names become keys under
  `state`, `$`, `acts` and `refs`.

<br>

**Example:**

```tsx
const workspaceComponent = componentScope({ title, preferences });

const Heading = workspaceComponent(
  ({ state }) => (
    <h1>
      {state.title.text}: {state.subtitle.text}
    </h1>
  ),
  { subtitle: store({ state: { text: "Open" } }) },
);
```

> **✦ Note:** Reading `state.title.text` tracks the whole `title` store.
> `$.title.text` binds one field. Use `$.title.$select` to derive a value within
> that store, or `$.$select` to track fields across several stores. JSX
> parent-child nesting leaves the child's declared scope unchanged.

</div></ul>
</details>

<details><summary><b><code>id</code></b></summary>
<br>
<ul><div>

**Description:**

A stable DOM ID string for the component instance. Add a suffix for
another element in the same component.

<br>

**Example:**

```tsx
const Field = component(({ id }) => {
  const hintId = `${id}-hint`;
  return (
    <>
      <label for={id}>Email</label>
      <input id={id} type="email" aria-describedby={hintId} />
      <p id={hintId}>Use your work address.</p>
    </>
  );
});
```

> **✦ Note:** Each component instance has its own ID, generated on first read.
> Use the same `idPrefix` and initial tree on the server and client.

</div></ul>
</details>

###### **— LIVE BINDINGS —**

<details><summary><b><code>$.field.set</code></b></summary>
<br>
<ul><div>

**Description:**

Writes a field declared in `store()`. The change reaches both plain-state
readers and live bindings.

**Parameters:**

- `value` is the next value or a function that receives the current value.

<br>

**Example:**

```tsx
<button onClick={() => $.count.set((count) => count + 1)}>{$.count}</button>
```

</div></ul>
</details>

<details><summary><b><code>LiveValue.if</code></b></summary>
<br>
<ul><div>

**Description:**

Mounts a local branch and keeps it while the binding's truthiness stays the same.

**Parameters:**

- `truthy` is the JSX to mount for a truthy value.
- `fallback` is optional JSX for a falsy value.

<br>

**Example:**

```tsx
<main>{$.authorized.if(<Profile />, <Login />)}</main>
```

> **✦ Note:** JSX expressions used as arguments evaluate normally. Component
> bodies run when their branch mounts. Use `.render()` when the branch needs
> the current value.

</div></ul>
</details>

<details><summary><b><code>LiveValue.render</code></b></summary>
<br>
<ul><div>

**Description:**

Updates a local JSX branch when a live value changes.

**Parameters:**

- `project` receives the current value and returns JSX.
- `options.key` (optional) keeps the branch mounted while the key stays equal.

<br>

**Example:**

```tsx
<main>
  {$.selectedIssueId.render((issueId) =>
    issueId === null ? <p>Select an issue</p> : <IssueDetails issueId={issueId} />
  )}
</main>
```

> **✦ Note:** For ordinary JSX conditions, use a ternary with `state` inside
> a tracked component.

</div></ul>
</details>

<details><summary><b><code>LiveValue.each</code></b></summary>
<br>
<ul><div>

**Description:**

Renders a keyed array. Reordering keeps the DOM nodes, changes to a row
update its live fields, and removing a key disposes the row.

**Parameters:**

- `key` returns a unique, stable key for an item.
- `project` receives the row's live item and returns JSX.

<br>

**Example:**

```tsx
<ol>
  {$.tasks.each(
    (task) => task.id,
    ($task) => (
      <li>{$task.title}</li>
    ),
  )}
</ol>
```

> **✦ Note:** Read `$task.id.get()` when an event needs a plain value.
> Use `$task.$field("get")` for fields that overlap a live-value method.

</div></ul>
</details>

<details><summary><b><code>list</code></b></summary>
<br>
<ul><div>

**Description:**

Updates an array with typed operations. A direct keyed binding can use the
recorded operation to apply changes such as insert, remove, move and replace.
Use `list` inside a store's action factory.

**Parameters:**

- `key` selects an array field in the store.

<br>

**Example:**

```ts
const taskStore = store({
  state: { tasks: ["Review", "Publish", "Draft"] },
  acts: ({ list }) => ({
    moveToFront(index: number) {
      list("tasks").move(index, 0);
    },
  }),
});
```

</div></ul>
</details>

###### **— ERROR RECOVERY —**

<details><summary><b><code>ErrorBoundary</code></b></summary>
<br>
<ul><div>

**Description:**

Replaces a failed branch with fallback UI. `reset()` renders the children
again with current state.

**Parameters:**

- `children` is the protected subtree.
- `fallback` accepts JSX or a callback that receives the error and reset function.

<br>

**Example:**

```tsx
<ErrorBoundary
  fallback={(error, reset) => (
    <button onClick={reset}>{String(error)}. Try again</button>
  )}
>
  <Editor />
</ErrorBoundary>
```

> **✦ Note:** The boundary handles initial render and scheduled rendering
> updates. Handle event-handler and asynchronous errors at the call site.

</div></ul>
</details>

</div></ul>
</details>

<details><summary><b><code>nexus-dom/server</code></b></summary>
<br>
<ul><div>

<details><summary><b><code>renderToString</code></b></summary>
<br>
<ul><div>

**Description:**

Renders JSX to HTML synchronously. The browser can adopt that HTML with
`app.hydrate()` and attach subscriptions, events and refs.

**Parameters:**

- `view` is the JSX tree.
- `options.hydration` adds the markers and store snapshots used by hydration.
- `options.idPrefix` sets the prefix input for stable component IDs.

<br>

**Example:**

```tsx
// Server
import { renderToString } from "nexus-dom/server";

const html = renderToString(<App />, {
  hydration: true,
  idPrefix: "account",
});
```

```tsx
// Client, with the server HTML already in #app
import { createApp } from "nexus-dom";

const app = createApp();
app.hydrate(<App />, "#app", { idPrefix: "account" });
```

> **✦ Note:** Render the same initial tree with the same `idPrefix`. Lazy-store
> snapshots must be JSON-safe. The browser receives them in the HTML, so keep
> credentials and server-only data outside those stores.

For independently rendered roots that carry lazy-store snapshots, use a
fresh client app and a distinct `idPrefix` for each root. A DOM mismatch
reports `HYDRATION_MISMATCH` through `onError` if provided, then mounts the
root again.

</div></ul>
</details>

</div></ul>
</details>

<h2></h2>

### Recipes

<details><summary><b>Choose between <code>state</code> and <code>$</code></b></summary>
<br>
<ul><div>

| Read                      | What updates                                                |
| ------------------------- | ----------------------------------------------------------- |
| `state.count`             | The component reruns when this key changes in a flat scope. |
| `state.preferences.theme` | The component reruns when the observed store changes.       |
| `$.count`                 | The attached text or property updates directly.             |

<br>

**Example:**

```tsx
const Panel = component(
  ({ state, $ }) => (
    <section>
      <h2>{state.expanded ? "Details" : "Summary"}</h2>
      <p>Updates: {$.count}</p>
    </section>
  ),
  [panelStore],
);
```

> **✦ Note:** A rerun patches compatible local DOM in place. A structural
> change can replace the owned branch.

</div></ul>
</details>

<h2></h2>

### License

[MIT](./LICENSE)
