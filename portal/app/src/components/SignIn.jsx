import React, { useState } from "react";

/**
 * Sign-in screen.
 *
 * Pass 1 flow:
 *   1. User enters land URL + username + password.
 *   2. POST {landUrl}/api/v1/login → returns { token, userId, username }.
 *   3. Caller (App) stores the token + opens a Portal socket.
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
      const res = await fetch(`${cleaned}/api/v1/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok || body.status !== "ok") {
        throw new Error(body?.error?.message || `Sign-in failed (HTTP ${res.status})`);
      }
      onSignedIn({
        landUrl: cleaned,
        token: body.data.token,
        userId: body.data.userId,
        username: body.data.username,
      });
    } catch (err) {
      setError(err.message);
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
