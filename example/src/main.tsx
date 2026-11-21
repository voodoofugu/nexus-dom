/** @jsxImportSource nexus-dom */
import { createApp } from "nexus-dom";
import { createPlaygroundDiagnostics } from "./diagnostics.js";
import "./style.css";

interface Task {
  id: number;
  title: string;
  done: boolean;
}

const app = createApp({
  state: {
    count: 0,
    step: 1,
    enabled: true,
    tasks: [
      { id: 1, title: "Inspect DOM identity", done: false },
      { id: 2, title: "Test keyed cleanup", done: false },
    ] as Task[],
    nextTaskId: 3,
  },
  refs: {
    lastChangedTask: null as number | null,
  },
  acts: (get, set, refs, { list }) => ({
    increment() {
      set({ count: get("count") + get("step") });
    },
    decrement() {
      set({ count: get("count") - get("step") });
    },
    reset() {
      set({ count: 0 });
    },
    toggle() {
      set({ enabled: !get("enabled") });
    },
    addTask() {
      const id = get("nextTaskId");
      list("tasks").append({
        id,
        title: `Experiment ${id}`,
        done: false,
      });
      set({ nextTaskId: id + 1 });
    },
    reverseTasks() {
      list("tasks").reverse();
    },
    toggleTask(id: number) {
      refs.lastChangedTask.current = id;
      const index = get("tasks").findIndex((task) => task.id === id);
      if (index < 0) return;
      const task = get("tasks")[index]!;
      list("tasks").replace(index, { ...task, done: !task.done });
    },
    removeTask(id: number) {
      refs.lastChangedTask.current = id;
      const index = get("tasks").findIndex((task) => task.id === id);
      if (index >= 0) list("tasks").remove(index);
    },
    changeStep(step: number) {
      set({ step }, "changeStep");
    },
  }),
});

const { $, acts } = app;
const doubled = $.count.map((count) => count * 2);
const parity = $.count.map((count) => (count % 2 === 0 ? "even" : "odd"));

let appExecutions = 0;
const diagnostics = createPlaygroundDiagnostics();

function App() {
  appExecutions++;

  return (
    <main class="surface" ref={diagnostics.surfaceRef}>
      <header>
        <p class="eyebrow">Rendering experiment</p>
        <h1>nexus-dom playground</h1>
        <p class="lede">
          The component mounts once. Live values update individual DOM bindings.
        </p>
      </header>

      <section class="counter-card" aria-label="Counter example">
        <div class="counter-readout">
          <span>Count</span>
          <output class={parity.map((value) => `count count--${value}`)}>
            {$.count}
          </output>
        </div>

        <div class="controls">
          <button
            disabled={$.enabled.map((enabled) => !enabled)}
            onClick={acts.decrement}
          >
            Decrease
          </button>
          <button
            class="primary"
            disabled={$.enabled.map((enabled) => !enabled)}
            onClick={acts.increment}
          >
            Increase
          </button>
          <button onClick={acts.reset}>Reset</button>
        </div>

        <label class="step-control">
          <span>Step</span>
          <input
            type="range"
            min="1"
            max="10"
            value={$.step}
            onInput={(event) => {
              const input = event.currentTarget as HTMLInputElement;
              acts.changeStep(Number(input.value));
            }}
          />
          <output>{$.step}</output>
        </label>

        <dl class="derived-grid">
          <div>
            <dt>Doubled</dt>
            <dd>{doubled}</dd>
          </div>
          <div>
            <dt>Parity</dt>
            <dd>{parity}</dd>
          </div>
        </dl>

        {$.count.render(
          (count) =>
            count >= 0 ? (
              <p class="branch branch--positive">Positive branch is mounted</p>
            ) : (
              <p class="branch branch--negative">Negative branch is mounted</p>
            ),
          { key: (count) => count >= 0 }
        )}

        <button class="toggle" onClick={acts.toggle}>
          Toggle counter controls
        </button>
      </section>

      <section class="task-card" aria-label="Keyed list example">
        <div class="task-heading">
          <div>
            <p class="eyebrow">Keyed region</p>
            <h2>Reactive task list</h2>
          </div>
          <div class="controls">
            <button onClick={acts.addTask}>Add task</button>
            <button onClick={acts.reverseTasks}>Reverse</button>
          </div>
        </div>

        <ul class="task-list">
          {$.tasks.each(
            (task) => task.id,
            ($task) => (
              <li
                data-task={$task.id}
                class={$task.done.map((done) => (done ? "is-done" : ""))}
              >
                <button
                  class="task-toggle"
                  onClick={() => acts.toggleTask($task.id.get())}
                >
                  {$task.done.map((done) => (done ? "Restore" : "Complete"))}
                </button>
                <span>{$task.title}</span>
                <button onClick={() => acts.removeTask($task.id.get())}>
                  Remove
                </button>
              </li>
            )
          )}
        </ul>

        <pre class="inline-syntax">
          <code>{`{$.tasks.each(
  (task) => task.id,
  ($task) => <Task task={$task} />
)}`}</code>
        </pre>
      </section>

      <diagnostics.Panel appExecutions={appExecutions} />
    </main>
  );
}

app.render(<App />, "#app", { onCommit: diagnostics.onCommit });
