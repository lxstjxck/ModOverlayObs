import { Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ObsSetupView, TtsSetupView } from "../../shared/types";
import { api } from "../api";
import { BrandMark } from "../components/BrandMark";

export function ObsSetupPage() {
  const [setup, setSetup] = useState<ObsSetupView | null>(null);
  const [error, setError] = useState("");
  const [tts, setTts] = useState<TtsSetupView | null>(null);
  const [rewardCost, setRewardCost] = useState(1000);
  const [ttsBusy, setTtsBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      await api("/api/auth/me");
      setSetup(await api<ObsSetupView>("/api/obs"));
      try {
        const view = await api<TtsSetupView>("/api/tts");
        setTts(view);
        setRewardCost(view.rewardCost);
      } catch {
        setTts(null);
      }
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

  async function saveReward() {
    if (!tts || !Number.isInteger(rewardCost) || rewardCost < 1 || rewardCost > 1_000_000) {
      setError("Стоимость награды должна быть от 1 до 1 000 000 баллов.");
      return;
    }
    setTtsBusy(true);
    setError("");
    try {
      await api("/api/tts/reward", {
        method: tts.rewardId ? "PATCH" : "POST",
        body: JSON.stringify({ cost: rewardCost })
      });
      const view = await api<TtsSetupView>("/api/tts");
      setTts(view);
      setRewardCost(view.rewardCost);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Не удалось изменить награду Twitch"
      );
    } finally {
      setTtsBusy(false);
    }
  }

  return (
    <main className="setup-page">
      <section className="setup-panel">
        <div className="brand-mark">
          <BrandMark />
        </div>
        <p className="setup-eyebrow">BROADCAST CONSOLE / OUTPUT CONFIGURATION</p>
        <h1>OBS Setup</h1>
        {error && <div className="error-box">{error}</div>}
        {setup && (
          <>
            <label className="field">
              Overlay URL
              <div className="copy-row">
                <input value={setup.overlayUrl} readOnly />
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(setup.overlayUrl)}
                >
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
              <li>
                Right-click the Browser Source again, open Transform, then choose Fit to Screen.
              </li>
              <li>Place the Browser Source above the game or capture source.</li>
            </ol>
            {tts && (
              <section className="tts-setup">
                <h2>Twitch TTS</h2>
                <p>
                  Модераторы: <strong>!tts текст</strong> в чате. Зрители и VIP: награда за баллы
                  канала.
                </p>
                <p>
                  Озвучка: Silero v3_1_ru, голос baya. Максимум 200 символов, пауза 30 секунд на
                  пользователя.
                </p>
                {!tts.configured && (
                  <p>Укажите TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET и TTS_PYTHON на сервере.</p>
                )}
                <p>
                  Подключение:{" "}
                  {tts.connected
                    ? `${tts.broadcasterLogin} (${tts.ready ? "онлайн" : "подключается"})`
                    : "не подключено"}
                </p>
                {tts.configured && (
                  <a href="/api/tts/connect">
                    {tts.connected ? "Переподключить Twitch" : "Подключить Twitch"}
                  </a>
                )}
                <label className="field">
                  Стоимость награды, баллы канала
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    step={1}
                    value={rewardCost}
                    onChange={(event) => setRewardCost(Number(event.target.value))}
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    !tts.configured || !tts.connected || (!tts.rewardId && !tts.ready) || ttsBusy
                  }
                  onClick={() => void saveReward()}
                >
                  {tts.rewardId ? "Сохранить стоимость" : "Создать награду TTS"}
                </button>
                <p>
                  Для звука в эфире включите у Browser Source «Control Audio via OBS», затем
                  выберите «Monitor and Output».
                </p>
              </section>
            )}
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
        <p className="page-credit">
          Made by <strong>lxstjxck</strong>
        </p>
      </section>
    </main>
  );
}
