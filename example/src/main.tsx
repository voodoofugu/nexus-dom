/** @jsxImportSource nexus-dom */
import { bind, createNexus, render } from "nexus-dom";
import { createPlaygroundDiagnostics } from "./diagnostics.js";
import "./style.css";

interface Task {
  id: number;
  title: string;
  done: boolean;
}

const counter = createNexus({
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
  acts: (get, set) => ({
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
      set({
        tasks: [
          ...get("tasks"),
          { id, title: `Experiment ${id}`, done: false },
        ],
        nextTaskId: id + 1,
      });
    },
    reverseTasks() {
      set({ tasks: [...get("tasks")].reverse() });
    },
    toggleTask(id: number) {
      set({
        tasks: get("tasks").map((task) =>
          task.id === id ? { ...task, done: !task.done } : task
        ),
      });
    },
    removeTask(id: number) {
      set({ tasks: get("tasks").filter((task) => task.id !== id) });
    },
  }),
});

const $ = bind(counter);
const doubled = $.count.map((count) => count * 2);
const parity = $.count.map((count) => (count % 2 === 0 ? "even" : "odd"));
const positive = $.count.map((count) => count >= 0);

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
            onClick={counter.acts.decrement}
          >
            Decrease
          </button>
          <button
            class="primary"
            disabled={$.enabled.map((enabled) => !enabled)}
            onClick={counter.acts.increment}
          >
            Increase
          </button>
          <button onClick={counter.acts.reset}>Reset</button>
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
              counter.set({ step: Number(input.value) }, "changeStep");
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

        {positive.render((isPositive) =>
          isPositive ? (
            <p class="branch branch--positive">Positive branch is mounted</p>
          ) : (
            <p class="branch branch--negative">Negative branch is mounted</p>
          ),
        )}

        <button class="toggle" onClick={counter.acts.toggle}>
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
            <button onClick={counter.acts.addTask}>Add task</button>
            <button onClick={counter.acts.reverseTasks}>Reverse</button>
          </div>
        </div>

        <ul class="task-list">
          {$.tasks.each(
            (task) => task.id,
            (task) => (
              <li data-task={task.id} class={task.done ? "is-done" : ""}>
                <button
                  class="task-toggle"
                  onClick={() => counter.acts.toggleTask(task.id)}
                >
                  {task.done ? "Restore" : "Complete"}
                </button>
                <span>{task.title}</span>
                <button onClick={() => counter.acts.removeTask(task.id)}>
                  Remove
                </button>
              </li>
            )
          )}
        </ul>

        <pre class="inline-syntax">
          <code>{`{$.tasks.each(
  (task) => task.id,
  (task) => <Task task={task} />
)}`}</code>
        </pre>
      </section>

      <diagnostics.Panel appExecutions={appExecutions} />
    </main>
  );
}

render(<App />, "#app", { onCommit: diagnostics.onCommit });
