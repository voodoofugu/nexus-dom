/** @jsxImportSource nexus-dom */
import { ErrorBoundary, component, componentScope, createApp, onCleanup, store } from "nexus-dom";

type Screen = "tasks" | "summary";
const readScreen = (): Screen => location.hash === "#summary" ? "summary" : "tasks";

const navigation = store({
  state: { screen: readScreen() },
  acts: ({ set }) => ({
    navigate(screen: Screen) {
      if (screen !== readScreen()) history.pushState(null, "", `#${screen}`);
      set({ screen });
    },
    restore() {
      set({ screen: readScreen() });
    },
  }),
  mount({ acts }) {
    window.addEventListener("popstate", acts.restore);
    return () => window.removeEventListener("popstate", acts.restore);
  },
});

const tasks = store({
  state: {
    items: [{ id: 1, title: "Draft" }, { id: 2, title: "Review" }],
  },
  acts: ({ get, list }) => ({
    moveLastToFront() {
      list("items").move(get("items").length - 1, 0);
    },
  }),
});

const TaskRows = component(({ $, acts }) => (
  <>
    <button type="button" id="move" onClick={acts.moveLastToFront}>
      Move last task to front
    </button>
    <ol>
      {$.items.each((item) => item.id, ($item) => (
        <li data-task={$item.id}>
          <label>{$item.title} <input /></label>
        </li>
      ))}
    </ol>
  </>
), [tasks]);

const Total = component(({ $, state }) => (
  <p data-first={state.items[0]?.id}>Tasks: {$.items.map((items) => items.length)}</p>
), [tasks]);

const failure = store({ state: { active: false } });
function BrokenEditor(): never {
  throw new Error("Editor render failed");
}

const EditorContent = component(({ $ }) => (
  <>
    <button type="button" onClick={() => $.active.set(true)}>Break editor</button>
    {$.active.if(<BrokenEditor />, <TaskRows />)}
  </>
), [failure]);

const Editor = component(({ $ }) => (
  <ErrorBoundary fallback={(error, reset) => (
    <div role="alert">
      <p>{String(error)}</p>
      <button type="button" onClick={() => {
        $.active.set(false);
        reset();
      }}>Reset editor</button>
    </div>
  )}>
    <EditorContent />
  </ErrorBoundary>
), [failure]);

function TaskScreen() {
  const cleanups = document.querySelector<HTMLOutputElement>("#cleanups")!;
  onCleanup(() => { cleanups.value = String(Number(cleanups.value) + 1); });
  return <section><h1>Task editor</h1><Editor /></section>;
}

const scoped = componentScope({ navigation });
const App = scoped(({ $, acts }) => (
  <main>
    <nav>
      <button type="button" onClick={() => acts.navigation.navigate("tasks")}>Tasks</button>
      <button type="button" onClick={() => acts.navigation.navigate("summary")}>Summary</button>
    </nav>
    {$.navigation.screen.render((screen) => screen === "tasks"
      ? <TaskScreen />
      : <section><h1>Task summary</h1><Total /></section>
    )}
  </main>
));

const app = createApp(<App />, "#app");
const dispose = document.querySelector<HTMLButtonElement>("#dispose")!;
dispose.addEventListener("click", app.dispose);
app.onCleanup(() => dispose.removeEventListener("click", app.dispose));
