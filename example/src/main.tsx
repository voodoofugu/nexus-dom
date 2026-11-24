/** @jsxImportSource nexus-dom */
import { createApp } from "nexus-dom";
import { createWorkspace } from "./workspace.js";
import "./style.css";

const { App, onCommit } = createWorkspace();
const app = createApp();
const host = document.querySelector("#app")!;
const options = { idPrefix: "issue-triage", onCommit };

if (host.hasAttribute("data-ssr")) app.hydrate(<App />, host, options);
else app.render(<App />, host, options);
