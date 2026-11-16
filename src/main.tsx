import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { flag } from "./app/flags";
import { installTestHooks } from "./app/testHooks";
import "./styles.css";

// Links from before the app had routes look like `#rewrite-the-stars`. Send them to the song.
const { hash } = window.location;
if (hash.length > 1 && !hash.startsWith("#/")) {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/play/${hash.slice(1)}`);
}

installTestHooks();
// Offline use arrives with the Studio, and stays behind its flag until the Studio is out from it.
if (flag("studio")) void import("./app/serviceWorker").then((m) => m.registerServiceWorker());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
