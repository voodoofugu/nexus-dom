/** @jsxImportSource nexus-dom */
import { createApp } from "nexus-dom";
import { createWorkspace } from "./workspace.js";
import "./style.css";

const { App, onCommit } = createWorkspace();
const host = document.querySelector("#app")!;
const options = { idPrefix: "issue-triage", onCommit };

if (host.hasAttribute("data-ssr")) createApp().hydrate(<App />, host, options);
else createApp(<App />, host, options);
