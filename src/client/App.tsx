import { LoginPage } from "./pages/LoginPage";
import { ModeratorApp } from "./pages/ModeratorApp";
import { ObsSetupPage } from "./pages/ObsSetupPage";
import { OverlayPage } from "./pages/OverlayPage";

export function App() {
  const path = window.location.pathname;
  if (path.startsWith("/overlay/")) {
    return <OverlayPage token={decodeURIComponent(path.replace("/overlay/", ""))} />;
  }
  if (path === "/login") {
    return <LoginPage />;
  }
  if (path === "/obs-setup") {
    return <ObsSetupPage />;
  }
  return <ModeratorApp />;
}
