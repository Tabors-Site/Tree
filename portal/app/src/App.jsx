import React, { useState, useEffect, useRef } from "react";
import { PortalClient } from "./portal-client.js";
import SignIn from "./components/SignIn.jsx";
import AddressBar from "./components/AddressBar.jsx";
import LandZone from "./components/zones/LandZone.jsx";
import HomeZone from "./components/zones/HomeZone.jsx";
import TreeZone from "./components/zones/TreeZone.jsx";

const SESSION_KEY = "treeos-portal-session";

export default function App() {
  // Persisted session: { landUrl, token, userId, username }
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [descriptor, setDescriptor] = useState(null);
  const [currentAddress, setCurrentAddress] = useState("/");
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [fetchError, setFetchError] = useState(null);
  const [discovery, setDiscovery] = useState(null);

  const clientRef = useRef(null);

  // ── Sign-in / sign-out ────────────────────────────────────────
  function handleSignedIn(s) {
    setSession(s);
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  }

  function signOut() {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setSession(null);
    setDescriptor(null);
    setConnectionStatus("disconnected");
    localStorage.removeItem(SESSION_KEY);
  }

  // ── On sign-in: bootstrap, connect, fetch initial descriptor ──
  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    (async () => {
      try {
        setConnectionStatus("loading");
        const disc = await PortalClient.bootstrap(session.landUrl, {
          useProxy: session.landIsProxied,
        });
        if (cancelled) return;
        setDiscovery(disc);

        const client = new PortalClient({
          landUrl: session.landUrl,
          token: session.token,
          useProxy: session.landIsProxied,
          onConnectionChange: (status, detail) => {
            setConnectionStatus(status);
            if (status === "error") setFetchError(`Connection: ${detail || "unknown"}`);
          },
        });
        clientRef.current = client;
        client.connect();

        // Wait for the socket to actually connect before issuing the first fetch.
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("Connect timeout")), 10000);
          const onConnect = () => {
            clearTimeout(t);
            resolve();
          };
          if (client.connected) onConnect();
          else client.socket.once("connect", onConnect);
        });

        if (cancelled) return;
        await navigate("/"); // start at the land root
      } catch (err) {
        if (cancelled) return;
        setFetchError(err.message);
        setConnectionStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // ── Navigation ────────────────────────────────────────────────
  async function navigate(rawAddress) {
    if (!clientRef.current) return;
    setFetchError(null);
    try {
      // The address may include the land or not. We pass it as typed; the
      // server parser fills in current-land context.
      const desc = await clientRef.current.see(rawAddress);
      setDescriptor(desc);
      setCurrentAddress(desc.address.pathByNames || rawAddress);
    } catch (err) {
      setFetchError(`${err.code || "ERROR"}: ${err.message}`);
    }
  }

  // ── Render ────────────────────────────────────────────────────
  if (!session) {
    return <SignIn onSignedIn={handleSignedIn} />;
  }

  return (
    <div className="shell">
      <div className="shell-header">
        <AddressBar
          username={session.username}
          currentAddress={currentAddress}
          onNavigate={navigate}
          invalid={!!fetchError}
        />
        <button className="btn" style={{ width: "auto", padding: "6px 12px" }} onClick={signOut}>
          sign out
        </button>
      </div>

      <div className="main">
        {fetchError && (
          <div className="empty" style={{ color: "var(--error)" }}>
            {fetchError}
          </div>
        )}
        {!descriptor && !fetchError && (
          <div className="empty">Loading…</div>
        )}
        {descriptor && descriptor.zone === "land" && (
          <LandZone descriptor={descriptor} onNavigate={navigate} />
        )}
        {descriptor && descriptor.zone === "home" && (
          <HomeZone descriptor={descriptor} onNavigate={navigate} />
        )}
        {descriptor && descriptor.zone === "tree" && (
          <TreeZone descriptor={descriptor} onNavigate={navigate} />
        )}
      </div>

      <div className="status-bar">
        <span className={`status-dot ${connectionStatus === "connected" ? "connected" : connectionStatus === "error" ? "error" : "loading"}`} />
        <span>{session.username} @ {session.landUrl}</span>
        <span style={{ color: "var(--fg-faint)" }}>·</span>
        <span>{connectionStatus}</span>
        {discovery && (
          <>
            <span style={{ color: "var(--fg-faint)" }}>·</span>
            <span>portal v{discovery.protocolVersion}</span>
          </>
        )}
      </div>
    </div>
  );
}
