import { usePublicAuthContext } from "../publicTwitchAuth";

export function PublicAuthControls({ compact = false }: { compact?: boolean }) {
  const { auth, error, popupBlocked, busy, startPopup, logout, retry } = usePublicAuthContext();
  if (auth.status === "loading") {
    return <div className="public-auth-status" role="status">Проверяем вход…</div>;
  }
  if (auth.status === "unavailable") {
    return <div className="public-auth">
      <span className="public-auth-error" role="alert">{error}</span>
      <button className="public-auth-logout" type="button" onClick={retry}>Повторить проверку</button>
    </div>;
  }
  return <div className={`public-auth ${compact ? "public-auth-compact" : ""}`}>
    {auth.status === "authenticated" && auth.user ? <>
      {compact && <div className="public-auth-profile">
        {auth.user.avatarUrl && <img src={auth.user.avatarUrl} alt="" referrerPolicy="no-referrer" />}
        <span>{auth.user.displayName || auth.user.login}</span>
      </div>}
      <a className="public-auth-channels" href="/channels">Мои каналы</a>
      {compact && <button className="public-auth-logout" type="button" onClick={() => void logout()} disabled={busy}>Выйти</button>}
    </> : <button className="public-auth-login" type="button" onClick={startPopup} disabled={busy}>
      {busy ? "Ожидаем вход…" : "Войти через Twitch"}
    </button>}
    {error && <div className="public-auth-error" role="alert">{error}</div>}
    {popupBlocked && <a className="public-auth-fallback" href="/api/auth/twitch/start/unified">Обычный вход в этой вкладке</a>}
  </div>;
}
