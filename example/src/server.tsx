/** @jsxImportSource nexus-dom */
import { renderToString } from "nexus-dom/server";
import { createWorkspace } from "./workspace.js";

export function renderWorkspace() {
  const { App } = createWorkspace();
  return renderToString(<App />, { hydration: true, idPrefix: "issue-triage" });
}
