import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { setPublicPageMetadata } from "./publicPageMetadata";
import "./styles.css";
import "./broadcastConsole.css";
import "./styles/tokens.css";
import "./styles/landing.css";
import "./styles/ecosystem.css";
import "./styles/workspace.css";
import "./styles/editor.css";

setPublicPageMetadata(window.location.pathname, document);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
