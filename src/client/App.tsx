import { LoginPage } from "./pages/LoginPage";
import { ModeratorApp } from "./pages/ModeratorApp";
import { ObsSetupPage } from "./pages/ObsSetupPage";
import { OverlayPage } from "./pages/OverlayPage";
import { TwitchLoginPage } from "./pages/TwitchLoginPage";
import { TwitchLandingPage, TwitchDashboardPage } from "./pages/TwitchPages";
import { EcosystemPage } from "./pages/EcosystemPage";

export function App() {
  const path = window.location.pathname;
  if (path.startsWith("/overlay/")) {
    return <OverlayPage token={decodeURIComponent(path.replace("/overlay/", ""))} />;
  }
  if (path === "/") {
    return <EcosystemPage />;
  }
  if (path === "/overlay") return <TwitchLandingPage />;
  if (path === "/login") return <TwitchLoginPage />;
  if (path === "/legacy-login") {
    return <LoginPage />;
  }
  if (path === "/streamer" || path === "/channels") {
    return <TwitchDashboardPage mode={path === "/streamer" ? "streamer" : "moderator"} />;
  }
  if (path === "/obs-setup") {
    return <ObsSetupPage />;
  }
  if (path === "/app" || /^\/channel\/[^/]+$/.test(path)) return <ModeratorApp />;
  return <TwitchLandingPage />;
}
