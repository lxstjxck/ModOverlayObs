import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { TwitchProfileView } from "../shared/types";
import { ApiError, api, setCsrfToken } from "./api";

export type PublicAuthStatus = "loading" | "guest" | "authenticated" | "unavailable";
type AuthState = { status: PublicAuthStatus; user: TwitchProfileView | null };
type PopupMessage = { type: "lxst:twitch-oauth"; success: boolean; error?: string };
export const popupChannelName = "lxst:twitch-oauth";

export const oauthErrors: Record<string, string> = {
  invalid_state: "Сессия входа истекла. Попробуйте снова.",
  denied: "Вход через Twitch отменён. Разрешите доступ и попробуйте снова.",
  insufficient_scope: "Twitch не выдал все необходимые разрешения. Разрешите оба доступа и попробуйте снова.",
  legacy_session: "Выйдите из старой учётной записи перед входом через Twitch.",
  legacy_owner_required: "Для привязки канала войдите в существующую учётную запись владельца.",
  invalid_response: "Twitch вернул некорректный ответ. Попробуйте снова.",
  twitch_unavailable: "Не удалось завершить вход через Twitch. Попробуйте позже."
};

export function isTrustedPopupMessage(event: MessageEvent, popup: Window | null): event is MessageEvent<PopupMessage> {
  const data: unknown = event.data;
  return popup !== null && event.origin === window.location.origin && event.source === popup &&
    Boolean(data && typeof data === "object" && "type" in data && data.type === "lxst:twitch-oauth" &&
      "success" in data && typeof data.success === "boolean");
}

export function usePublicTwitchAuth() {
  const initialOAuthError = new URLSearchParams(window.location.search).get("oauth_error");
  const [auth, setAuth] = useState<AuthState>({ status: "loading", user: null });
  const [error, setError] = useState(() => initialOAuthError
    ? oauthErrors[initialOAuthError] ?? "Ошибка авторизации. Попробуйте снова."
    : "");
  const oauthErrorPending = useRef(Boolean(initialOAuthError));
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const refreshVersion = useRef(0);

  async function refresh(): Promise<boolean> {
    const version = ++refreshVersion.current;
    try {
      const result = await api<{ user: TwitchProfileView }>("/api/auth/twitch/me");
      if (version !== refreshVersion.current) return false;
      setAuth({ status: "authenticated", user: result.user });
      setError("");
      return true;
    } catch (cause) {
      if (version !== refreshVersion.current) return false;
      setCsrfToken(null);
      if (cause instanceof ApiError && cause.status === 401) {
        setAuth({ status: "guest", user: null });
        if (!oauthErrorPending.current) setError("");
      } else {
        setAuth({ status: "unavailable", user: null });
        setError("Не удалось проверить сессию. Проверьте соединение и обновите страницу.");
      }
      return false;
    }
  }

  useEffect(() => {
    if (initialOAuthError) {
      const url = new URL(window.location.href);
      url.searchParams.delete("oauth_error");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    void refresh();
    const onFocus = () => { if (!popupRef.current) void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      refreshVersion.current++;
      window.removeEventListener("focus", onFocus);
      cleanupRef.current?.();
    };
  }, []);

  function startPopup() {
    if (busy) return;
    oauthErrorPending.current = false;
    setError("");
    setPopupBlocked(false);
    const popup = window.open("/api/auth/twitch/start/unified?popup=1", "lxst-twitch-oauth", "popup,width=520,height=720");
    if (!popup) {
      setPopupBlocked(true);
      setError("Браузер заблокировал всплывающее окно. Используйте обычный вход.");
      return;
    }
    popupRef.current = popup;
    setBusy(true);
    let finished = false;
    let checking = false;
    let callbackSucceeded = false;
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(popupChannelName);
    const cleanup = () => {
      finished = true;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      channel?.close();
      popupRef.current = null;
      cleanupRef.current = null;
      setBusy(false);
    };
    const check = async (closed = false) => {
      if (checking || finished) return;
      checking = true;
      let valid = false;
      for (let attempt = 0; attempt < (callbackSucceeded ? 3 : 1); attempt++) {
        valid = await refresh();
        if (valid || finished) break;
        if (callbackSucceeded) await new Promise((resolve) => window.setTimeout(resolve, 400));
      }
      checking = false;
      if (finished) return;
      if (valid) {
        cleanup();
        popup.close();
        window.location.assign("/channels");
      } else if (closed || callbackSucceeded) {
        cleanup();
        if (callbackSucceeded) popup.close();
        setError(callbackSucceeded
          ? "Вход завершён, но серверная сессия не появилась. Попробуйте снова."
          : "Окно входа закрыто до завершения авторизации.");
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedPopupMessage(event, popup)) return;
      handleResult(event.data);
    };
    const handleResult = (result: PopupMessage) => {
      if (finished || result.type !== "lxst:twitch-oauth" || typeof result.success !== "boolean") return;
      if (!result.success) {
        cleanup();
        setError(oauthErrors[result.error ?? ""] ?? "Не удалось завершить вход через Twitch.");
        popup.close();
        return;
      }
      callbackSucceeded = true;
      void check();
    };
    if (channel) channel.onmessage = (event: MessageEvent<PopupMessage>) => handleResult(event.data);
    const onFocus = () => { void check(popup.closed); };
    const timer = window.setInterval(() => { if (popup.closed) void check(); }, 2000);
    const timeout = window.setTimeout(() => {
      if (!finished) {
        cleanup();
        setError("Время входа истекло. Попробуйте снова.");
        popup.close();
      }
    }, 10 * 60_000);
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", onFocus);
    cleanupRef.current = cleanup;
  }

  async function logout() {
    refreshVersion.current++;
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/logout", { method: "POST" });
      setCsrfToken(null);
      setAuth({ status: "guest", user: null });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setCsrfToken(null);
        setAuth({ status: "guest", user: null });
      } else {
        setError("Не удалось выйти. Попробуйте снова.");
      }
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    oauthErrorPending.current = false;
    setError("");
    setAuth({ status: "loading", user: null });
    void refresh();
  }

  return { auth, error, popupBlocked, busy, startPopup, logout, retry };
}

const PublicAuthContext = createContext<ReturnType<typeof usePublicTwitchAuth> | null>(null);

export function PublicAuthProvider({ children }: { children: ReactNode }) {
  const value = usePublicTwitchAuth();
  return <PublicAuthContext.Provider value={value}>{children}</PublicAuthContext.Provider>;
}

export function usePublicAuthContext() {
  const value = useContext(PublicAuthContext);
  if (!value) throw new Error("PublicAuthProvider is required");
  return value;
}
