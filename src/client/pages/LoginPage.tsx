import { LogIn } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "../api";

export function LoginPage() {
  const [username, setUsername] = useState("owner");
  const [password, setPassword] = useState("change-me-now");
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
    <main className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="brand-mark">MO</div>
        <h1>Moderator Overlay</h1>
        <label className="field">
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
        </label>
        <label className="field">
          Password
          <input
            value={password}
            type="password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <div className="error-box">{error}</div>}
        <button className="primary" type="submit" disabled={loading}>
          <LogIn size={16} />
          {loading ? "Signing in" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
