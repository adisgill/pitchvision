import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./theme.css";

// After a new deploy, an open tab still points at the old content-hashed chunks, which are gone:
// reload once to pick up the new build instead of rendering a blank page.
window.addEventListener("vite:preloadError", (e) => {
  const key = "pv-reloaded-at";
  try {
    if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 10_000) return; // already tried; let it surface
    sessionStorage.setItem(key, String(Date.now()));
  } catch { return; /* storage blocked: no loop guard, so do not risk a reload loop */ }
  e.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
