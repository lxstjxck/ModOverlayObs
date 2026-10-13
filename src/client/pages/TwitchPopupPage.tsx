import { useEffect } from "react";
import { oauthErrors, popupChannelName } from "../publicTwitchAuth";

export function TwitchPopupPage() {
  const params = new URLSearchParams(window.location.search);
  const success = params.get("success") === "1";
  const error = params.get("error") ?? "";
  useEffect(() => {
    const message = { type: "lxst:twitch-oauth", success, error };
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(popupChannelName);
      channel.postMessage(message);
      channel.close();
    }
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(message, window.location.origin);
    }
    window.close();
  }, [success, error]);
  return <main className="lxst-auth-page lxst-popup-result">
    <h1>{success ? "Вход завершён" : "Вход не завершён"}</h1>
    <p>{success ? "Вернитесь в исходную вкладку." : oauthErrors[error] ?? "Попробуйте войти снова."}</p>
    <button type="button" onClick={() => window.close()}>Закрыть окно</button>
  </main>;
}
