import { LoginPage } from "./pages/LoginPage";
import { ModeratorApp } from "./pages/ModeratorApp";
import { ObsSetupPage } from "./pages/ObsSetupPage";
import { OverlayPage } from "./pages/OverlayPage";
import { TwitchLandingPage, TwitchPlaceholderPage } from "./pages/TwitchPages";

export function App() {
  const path = window.location.pathname;
  if (path.startsWith("/overlay/")) {
    return <OverlayPage token={decodeURIComponent(path.replace("/overlay/", ""))} />;
  }
  if (path === "/" || path === "/login") {
    return <TwitchLandingPage />;
  }
  if (path === "/legacy-login") {
    return <LoginPage />;
  }
  if (path === "/streamer" || path === "/channels") {
    return <TwitchPlaceholderPage mode={path === "/streamer" ? "streamer" : "moderator"} />;
  }
  if (path === "/obs-setup") {
    return <ObsSetupPage />;
  }
  return <ModeratorApp />;
}
