import { useEffect } from "react";
import { LoginPage } from "./pages/LoginPage";
import { ModeratorApp } from "./pages/ModeratorApp";
import { ObsSetupPage } from "./pages/ObsSetupPage";
import { OverlayPage } from "./pages/OverlayPage";
import { TwitchLandingPage, TwitchDashboardPage } from "./pages/TwitchPages";
import { EcosystemPage } from "./pages/EcosystemPage";
import { TwitchPopupPage } from "./pages/TwitchPopupPage";

function RedirectOldLogin() {
  useEffect(() => {
    window.location.replace(`/overlay${window.location.search}`);
  }, []);
  return null;
}

export function App() {
  const path = window.location.pathname;
  if (path.startsWith("/overlay/")) {
    return <OverlayPage token={decodeURIComponent(path.replace("/overlay/", ""))} />;
  }
  if (path === "/") {
    return <EcosystemPage />;
  }
  if (path === "/overlay") return <TwitchLandingPage />;
  if (path === "/login") return <RedirectOldLogin />;
  if (path === "/oauth/popup") return <TwitchPopupPage />;
  if (path === "/legacy-login") {
    return <LoginPage />;
  }
  if (path === "/streamer" || path === "/channels") {
    return <TwitchDashboardPage />;
  }
  if (path === "/obs-setup") {
    return <ObsSetupPage />;
  }
  if (path === "/app" || /^\/channel\/[^/]+$/.test(path)) return <ModeratorApp />;
  return <TwitchLandingPage />;
}
