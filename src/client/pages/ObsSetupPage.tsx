import { Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ObsSetupView } from "../../shared/types";
import { api } from "../api";

export function ObsSetupPage() {
  const [setup, setSetup] = useState<ObsSetupView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setSetup(await api<ObsSetupView>("/api/obs"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load OBS setup");
    }
  }

  async function regenerate() {
    if (!window.confirm("Regenerate the overlay token? The old OBS URL will stop working.")) {
      return;
    }
    setSetup(await api<ObsSetupView>("/api/obs/regenerate", { method: "POST" }));
  }

  return (
    <main className="setup-page">
      <section className="setup-panel">
        <h1>OBS Setup</h1>
        {error && <div className="error-box">{error}</div>}
        {setup && (
          <>
            <label className="field">
              Overlay URL
              <div className="copy-row">
                <input value={setup.overlayUrl} readOnly />
                <button type="button" onClick={() => void navigator.clipboard.writeText(setup.overlayUrl)}>
                  <Copy size={16} />
                  Copy
                </button>
              </div>
            </label>
            <ol>
              <li>Open OBS Studio.</li>
              <li>Add a Browser Source named Moderator Overlay.</li>
              <li>Paste the Overlay URL.</li>
              <li>
                Set Width = {setup.canvasWidth}, Height = {setup.canvasHeight}.
              </li>
              <li>Leave Custom CSS empty.</li>
              <li>Right-click the Browser Source, open Transform, then choose Reset Transform.</li>
              <li>Right-click the Browser Source again, open Transform, then choose Fit to Screen.</li>
              <li>Place the Browser Source above the game or capture source.</li>
            </ol>
            <div className="action-row">
              <button type="button" onClick={() => (window.location.href = "/app")}>
                Back to Panel
              </button>
              <button className="danger" type="button" onClick={() => void regenerate()}>
                <RefreshCw size={16} />
                Regenerate
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
