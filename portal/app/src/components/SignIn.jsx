import React, { useState } from "react";
import { PortalClient } from "../portal-client.js";

/**
 * Sign-in screen.
 *
 * Phase 5 flow (BE):
 *   1. User enters land URL + username + password (and chooses register or claim).
 *   2. PortalClient.bootstrap(landUrl) → { ws, protocolVersion, land }.
 *   3. Open a temporary, unauthenticated PortalClient socket.
 *   4. portal:be { operation: "claim" | "register", land: "<land>", payload }
 *      → { identityToken, beingAddress }.
 *   5. Disconnect the temporary socket; hand the token up to App, which
 *      opens a real authenticated PortalClient.
 */
export default function SignIn({ onSignedIn }) {
  const [landUrl, setLandUrl] = useState("http://localhost:3000");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("claim"); // "claim" or "register"
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    let bootstrapClient = null;
    try {
      const cleaned = landUrl.replace(/\/+$/, "");
      const useProxy = import.meta.env?.VITE_PORTAL_USE_PROXY === "true";

      // Step 1: bootstrap to learn the WS URL + land identity.
      const disc = await PortalClient.bootstrap(cleaned, { useProxy });
      const landDomain = disc.land;

      // Step 2: open an unauthenticated socket for the BE call.
      bootstrapClient = new PortalClient({
        landUrl: cleaned,
        token: null,
        useProxy,
      });
      bootstrapClient.connect();
      await waitForConnect(bootstrapClient);

      // Step 3: BE claim or register against the auth-being.
      const result = await bootstrapClient.be(mode, landDomain, {
        payload: { username, password },
      });

      if (!result?.identityToken) {
        throw new Error("Auth-being did not return an identity token");
      }

      // Extract userId from the beingAddress (the JWT has it but the
      // client-side stash uses what the auth-being returned).
      onSignedIn({
        landUrl: cleaned,
        landIsProxied: useProxy,
        token: result.identityToken,
        username,
        beingAddress: result.beingAddress,
        userId: null, // App will fetch from a SEE on the home position
      });
    } catch (err) {
      const msg = err?.message || "Sign-in failed";
      const code = err?.code ? `${err.code}: ` : "";
      setError(`${code}${msg}`);
    } finally {
      if (bootstrapClient) {
        try { bootstrapClient.disconnect(); } catch {}
      }
      setLoading(false);
    }
  }

  return (
    <div className="signin">
      <form className="signin-card" onSubmit={handleSubmit}>
        <h1>TreeOS Portal</h1>
        <div className="subtitle">{mode === "claim" ? "Claim a being at a land." : "Register a new being at a land."}</div>

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
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />
        </div>

        <button className="btn" type="submit" disabled={loading || !username || !password}>
          {loading
            ? (mode === "register" ? "Registering…" : "Claiming…")
            : (mode === "register" ? "Register" : "Claim")}
        </button>

        <button
          type="button"
          className="btn-link"
          onClick={() => setMode(mode === "claim" ? "register" : "claim")}
        >
          {mode === "claim" ? "or register a new being" : "or claim an existing being"}
        </button>

        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}

function waitForConnect(client, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (client.connected) return resolve();
    const t = setTimeout(() => reject(new Error("Connect timed out")), timeoutMs);
    client.socket.once("connect", () => {
      clearTimeout(t);
      resolve();
    });
    client.socket.once("connect_error", (err) => {
      clearTimeout(t);
      reject(new Error(err?.message || "Connect error"));
    });
  });
}
