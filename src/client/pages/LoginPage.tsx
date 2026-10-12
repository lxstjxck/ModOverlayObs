import { LogIn } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "../api";
import { appVersion } from "../appVersion";
import { BrandIdentity } from "../components/BrandIdentity";

export function LoginPage() {
  const [username, setUsername] = useState("owner");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      window.location.href = "/app";
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="lxst-auth-page">
      <header className="lxst-auth-header lxst-shell">
        <BrandIdentity />
        <a href="/login" className="lxst-back-link">
          ← Вход через Twitch
        </a>
      </header>
      <div className="lxst-auth-content lxst-auth-content-legacy lxst-shell">
        <div className="lxst-auth-intro">
          <p className="landing-eyebrow">
            <span className="landing-eyebrow-line" /> СУЩЕСТВУЮЩАЯ ПАНЕЛЬ
          </p>
          <h1>
            Вход для <em>OWNER.</em>
          </h1>
          <p>Парольный вход для существующей учётной записи владельца.</p>
        </div>
        <form
          className="lxst-auth-card lxst-legacy-form"
          onSubmit={handleSubmit}
          aria-busy={loading}
        >
          <div className="lxst-auth-card-top">
            <LogIn size={22} aria-hidden="true" />
            <span>CONSOLE / v{appVersion}</span>
          </div>
          <h2>Вход по паролю</h2>
          <label className="lxst-field">
            Имя пользователя
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>
          <label className="lxst-field">
            Пароль
            <input
              value={password}
              type="password"
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <div className="lxst-alert" role="alert">
              {error}
            </div>
          )}
          <button className="lxst-button lxst-button-primary" type="submit" disabled={loading}>
            <span>{loading ? "Входим…" : "Войти"}</span>
            <LogIn size={18} aria-hidden="true" />
          </button>
        </form>
      </div>
      <footer className="lxst-auth-footer lxst-shell">
        LXST Overlay{" "}
        <span>
          by{" "}
          <a href="https://github.com/lxstjxck" target="_blank" rel="noopener noreferrer">
            lxstjxck
          </a>
        </span>
      </footer>
    </main>
  );
}
