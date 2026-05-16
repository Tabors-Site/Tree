import React, { useState } from "react";

/**
 * Sign-in screen.
 *
 * Pass 1 flow:
 *   1. User enters land URL + username + password.
 *   2. POST {landUrl}/api/v1/login → returns { token, userId, username }.
 *   3. Caller (App) stores the token + opens a Portal socket.
 *
 * Dev mode (Vite): if the land URL points at localhost (default), we issue
 * the login as a relative URL ("/api/v1/login") so Vite's proxy handles it.
 * That avoids CORS preflight issues during dev. In a built bundle, the
 * URL stays absolute.
 *
 * Pass 5 (federation) will add: pick from roster, federated sign-in,
 * cross-land bridge.
 */
export default function SignIn({ onSignedIn }) {
  const [landUrl, setLandUrl] = useState("http://localhost:3000");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const cleaned = landUrl.replace(/\/+$/, "");

      // The Land server's CORS now allows any localhost origin in dev mode,
      // so we hit the typed URL directly. The Vite proxy stays available
      // as an opt-in (set VITE_PORTAL_USE_PROXY=true in .env to force
      // routing through Vite, useful for testing against a non-CORS-
      // configured land like production treeos.ai).
      const useProxy = import.meta.env?.VITE_PORTAL_USE_PROXY === "true";
      const loginUrl = useProxy ? "/api/v1/login" : `${cleaned}/api/v1/login`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      let res;
      try {
        res = await fetch(loginUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== "ok") {
        throw new Error(body?.error?.message || `Sign-in failed (HTTP ${res.status})`);
      }
      onSignedIn({
        landUrl: cleaned,
        landIsProxied: useProxy,
        token: body.data.token,
        userId: body.data.userId,
        username: body.data.username,
      });
    } catch (err) {
      const msg =
        err.name === "AbortError"
          ? "Request timed out after 10s. Is the Land server reachable?"
          : err.message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="signin">
      <form className="signin-card" onSubmit={handleSubmit}>
        <h1>TreeOS Portal</h1>
        <div className="subtitle">Sign in to a land to begin.</div>

        <div className="field">
          <label>Land</label>
          <input
            type="text"
            value={landUrl}
            onChange={(e) => setLandUrl(e.target.value)}
            placeholder="http://localhost:3000"
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label>Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="tabor"
            autoComplete="username"
          />
        </div>

        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <button className="btn" type="submit" disabled={loading || !username || !password}>
          {loading ? "Signing in…" : "Sign in"}
        </button>

        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
