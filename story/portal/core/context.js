// TreeOS Portal . core/context.js
//
// PortalContext — the per-tab bundle of everything one being's portal
// session needs: the state model, the IBP client, the navigation
// flow, session persistence, and the connect/sign-in/sign-out
// machinery. No module-level singletons: the shell can hold several
// contexts at once (one per being tab) without them leaking into
// each other. The user space is tabbed per being; a context IS a tab.
//
// Lifecycle:
//   const ctx = createPortalContext({ id, persist })
//   await ctx.start()          bootstrap discovery + connect + land
//   ctx.navigation.navigate()  move around
//   await ctx.signIn(...)      swap the connection to an identity
//   ctx.destroy()              disconnect, stop timers
//
// Events (ctx.events.on(type, fn) → unsubscribe):
//   "client"                a new PortalClient is live (reconnects too)
//   "connected"             socket open and landed
//   "status"                human-readable status line for the HUD
//   "summon"                unsolicited SUMMON push (inbox entry)
//   "live-position"         skinny per-being movement delta
//   "live-fact"             fact-arrival push (animations / sounds)
//   "live-while-historical" live event arrived while rewound
//   "navigated"             a navigate() landed

import { PortalClient } from "./client.js";
import { resolvePlaceConfig } from "./config.js";
import { createPortalState } from "./state.js";
import { createNavigation } from "./navigation.js";

// ── Session store ──────────────────────────────────────────────────
//
// The primary tab persists its session in localStorage; an inheriter
// browser tab (opened via "Inhabit") keeps it in sessionStorage so it
// never clobbers the parent's. Extra being tabs inside one shell hold
// their sessions in memory only — they are minted live and die with
// the tab strip.

const SESSION_KEY = "treeos-portal-session";
const LEGACY_SESSION_KEY = "treeos-portal-3d-session";
const INHABIT_HASH = "inhabit=";
const INHERITER_FLAG = "treeos-portal-inheriter";
const LEGACY_INHERITER_FLAG = "treeos-portal-3d-inheriter";

let _isInheriterTab =
  typeof sessionStorage !== "undefined" &&
  (sessionStorage.getItem(INHERITER_FLAG) === "1" ||
    sessionStorage.getItem(LEGACY_INHERITER_FLAG) === "1");

export function isInheriterTab() { return _isInheriterTab; }

// One-shot inhabit handoff. A parent tab stashes the child's session
// blob in the URL hash as `#inhabit=<json>`; the new tab consumes it
// on boot, copies into sessionStorage (per-tab), clears the hash, and
// runs as the inheriter without touching the parent's localStorage.
export function consumeInhabitHash() {
  if (typeof location === "undefined") return null;
  const hash = location.hash.replace(/^#/, "");
  if (!hash.startsWith(INHABIT_HASH)) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(decodeURIComponent(hash.slice(INHABIT_HASH.length)));
  } catch { parsed = null; }
  try { history.replaceState(null, "", location.pathname); } catch {}
  if (!parsed?.token) return null;
  sessionStorage.setItem(INHERITER_FLAG, "1");
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
  _isInheriterTab = true;
  return parsed;
}

function loadStoredSession() {
  try {
    const store = _isInheriterTab ? sessionStorage : localStorage;
    const raw = store.getItem(SESSION_KEY) || store.getItem(LEGACY_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveStoredSession(s) {
  try {
    const store = _isInheriterTab ? sessionStorage : localStorage;
    store.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {}
}

function clearStoredSession() {
  // Nuke BOTH keys in BOTH stores. A stale session (e.g. after a dev DB wipe)
  // could linger under the legacy key or in the other storage; clearing only
  // the active store leaves a phantom identity that re-seats on the next boot.
  for (const store of [
    typeof localStorage !== "undefined" ? localStorage : null,
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
  ]) {
    if (!store) continue;
    try { store.removeItem(SESSION_KEY); store.removeItem(LEGACY_SESSION_KEY); } catch {}
  }
}

// ── Events ─────────────────────────────────────────────────────────

function createEmitter() {
  const map = new Map(); // type -> Set<fn>
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => map.get(type)?.delete(fn);
    },
    emit(type, payload) {
      for (const fn of map.get(type) || []) {
        try { fn(payload); }
        catch (err) { console.warn(`[portal:events] "${type}" handler threw:`, err?.message || err); }
      }
    },
    clear() { map.clear(); },
  };
}

// ── Ghost guard ────────────────────────────────────────────────────
//
// While the user is looking at a past moment (descriptor.isHistorical)
// every DO/SUMMON/BE is blocked at the client boundary — the past is
// observation only. `create-branch` is the one legitimate past-time
// DO: branching is how the past stays causally accessible.

const GHOST_ALLOWED_DO_ACTIONS = new Set(["create-branch"]);

function ghostGuard(client, ctx) {
  // NOTE: `type` is intentionally NOT ghost-guarded. A statement always resolves at the live
  // edge (presentism — typeIntoBook never writes into the past), so typing while viewing the
  // past is allowed: an approved statement lands NOW and the shell snaps the view forward to it.
  for (const verb of ["do", "call", "be"]) {
    const original = client[verb].bind(client);
    client[verb] = async (...args) => {
      if (ctx.state.get("descriptor")?.isHistorical) {
        if (verb === "do" && GHOST_ALLOWED_DO_ACTIONS.has(args[1])) {
          return await original(...args);
        }
        ctx.events.emit("status", `ghost view — ${verb.toUpperCase()} suspended. return to now to act.`);
        const err = new Error(`${verb.toUpperCase()} blocked: viewing the past`);
        err.code = "GHOST_VIEW";
        throw err;
      }
      return await original(...args);
    };
  }
  return client;
}

// ── Context ────────────────────────────────────────────────────────

export function createPortalContext({ id = "main", persist = true, session = null, placeConfig = null } = {}) {
  const config = placeConfig || resolvePlaceConfig();
  const state = createPortalState({
    session: session || (persist ? loadStoredSession() : null),
  });
  const events = createEmitter();

  const ctx = {
    id,
    persist,
    config,
    state,
    events,
    client: null,
    navigation: null,
  };
  ctx.navigation = createNavigation(ctx);

  function saveSession(s) {
    state.set({ session: s });
    if (persist) saveStoredSession(s);
  }

  function clearSession() {
    state.set({ session: null });
    if (persist) clearStoredSession();
  }

  function buildClient({ placeUrl, token, useProxy }) {
    const client = ghostGuard(new PortalClient({
      placeUrl,
      token,
      useProxy,
      onConnectionChange: (status, detail) => {
        state.set({ connection: status });
        events.emit("status", `socket: ${status}${detail ? ` (${detail})` : ""}`);
      },
      onSummon: (entry) => {
        // Async SUMMON reply bookkeeping: clear the pending marker,
        // then hand the entry to whoever renders it.
        const correlation = entry?.inReplyTo;
        if (correlation) state.get("pendingSummons").delete(correlation);
        events.emit("call", entry);
      },
      onDescriptorEvent: (event) => ctx.navigation.handleDescriptorEvent(event),
      onHistoryChange: (history) => {
        state.set({ actorHistory: history || "0" });
        events.emit("history", history);
      },
    }), ctx);
    ctx.client = client;
    events.emit("client", client);
    return client;
  }

  function waitForConnect(client, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (client.connected) return resolve();
      const t = setTimeout(() => reject(new Error("connect timeout")), timeoutMs);
      client.socket.once("connect", () => { clearTimeout(t); resolve(); });
      client.socket.once("connect_error", (err) => {
        clearTimeout(t);
        reject(new Error(err?.message || "connect error"));
      });
    });
  }

  async function connectAnonymous(placeUrl = config.placeUrl, useProxy = config.useProxy) {
    const client = buildClient({ placeUrl, token: null, useProxy });
    client.connect();
    await waitForConnect(client);
    await ctx.navigation.landAnonymous();
    events.emit("connected", { anonymous: true });
  }

  async function connectAndPlace(sess, { freshSignIn = false } = {}) {
    const client = buildClient({
      placeUrl: sess.placeUrl || config.placeUrl,
      token: sess.token,
      useProxy: typeof sess.placeIsProxied === "boolean" ? sess.placeIsProxied : config.useProxy,
    });
    client.connect();
    await waitForConnect(client);
    // Fresh sign-ins ignore the pre-auth hash: land where the being
    // is (position → home), not where arrival happened to be browsing.
    const landed = await ctx.navigation.landAuthenticated(sess, { ignoreHash: freshSignIn });
    if (landed) events.emit("connected", { anonymous: false });
  }

  // Connect with a NAME-only session token (a name:connect persisted across a
  // refresh). The socket re-seats socket.nameId from the token but has no
  // being, so we land anonymous — at the (now name-aware) arrival floor, where
  // the name's beings are listed. No be-session land; the picker/world gate in
  // the shell takes it from there.
  async function connectNameOnly(sess) {
    const client = buildClient({
      placeUrl: sess.placeUrl || config.placeUrl,
      token: sess.token,
      useProxy: typeof sess.placeIsProxied === "boolean" ? sess.placeIsProxied : config.useProxy,
    });
    client.connect();
    await waitForConnect(client);
    // VALIDATE the name-token against the server before trusting the stored
    // session. After a dev DB wipe the name is gone and verifyTokenStrict
    // rejects the token, so the socket binds NO name. If we don't check, the
    // portal lingers on a phantom identity (the "still old being / glitching"
    // bug). Confirm the server seated THIS name; if not, the session is stale —
    // drop it and start fresh at the Name Form.
    let who = null;
    try { who = await client.nameWhoami(); } catch { /* treat as unbound */ }
    if (!who?.nameId || (sess.nameId && who.nameId !== sess.nameId)) {
      console.warn("[portal] stored name session is no longer valid; dropping it.");
      clearSession();
      ctx.navigation.clearLocationHash();
      await ctx.navigation.landAnonymous();
      events.emit("connected", { anonymous: true, staleCleared: true });
      return;
    }
    await ctx.navigation.landAnonymous();
    events.emit("connected", { anonymous: false, nameOnly: true });
  }

  // Persist a name-only session (the name:connect token) WITHOUT reconnecting —
  // the live socket is already name-bound; this just stores the token so the
  // NEXT boot re-seats the name (and a refresh lands at the name's beings, not
  // back at the Name Form). beingId null marks it as a name-only session.
  function adoptNameSession(token, nameId) {
    if (!token) return;
    const placeUrl = state.get("session")?.placeUrl || config.placeUrl;
    saveSession({
      placeUrl,
      placeIsProxied: resolvePlaceConfig({ placeUrl }).useProxy,
      token,
      nameId: nameId || null,
      beingId: null,
      username: null,
      beingAddress: null,
    });
    // Push the name-token onto the LIVE socket so its reconnects stay
    // name-bound (socket.nameId persists). The connect set socket.nameId on
    // the current socket; this keeps it across blips so name:release / signing
    // never silently break on a dropped-and-reconnected socket.
    try { ctx.client?.setToken?.(token); } catch { /* best-effort */ }
  }
  ctx.adoptNameSession = adoptNameSession;

  async function dropStaleSessionAndReconnect() {
    console.warn("[portal] stored session is no longer valid; dropping it.");
    const dropped = state.get("session");
    clearSession();
    try { ctx.client?.disconnect(); } catch {}
    // The hash may point at a space that no longer exists on the
    // fresh DB; anonymous landing starts clean at "/".
    ctx.navigation.clearLocationHash();
    const placeUrl = dropped?.placeUrl || config.placeUrl;
    const { useProxy } = resolvePlaceConfig({ placeUrl });
    await connectAnonymous(placeUrl, useProxy);
  }
  ctx.dropStaleSessionAndReconnect = dropStaleSessionAndReconnect;

  // ── Auth flows ──────────────────────────────────────────────────

  // BE birth/connect against the story root, then reconnect the
  // socket under the returned identity token.
  async function signIn(op, name, password, { importKey = null } = {}) {
    if (op !== "birth" && op !== "connect") {
      throw new Error(`signIn: unsupported op "${op}"`);
    }
    if (!ctx.client) throw new Error("signIn: no client");
    const story = state.get("discovery")?.story;
    if (!story) throw new Error("signIn: no story");
    // importKey (birth only): an exported private-key PEM or its
    // 24-word paper form — the being is born WITH that identity.
    // The wire layer holds it out of the chain (secret stash).
    const payload = { name, password };
    if (op === "birth" && importKey) payload.importKey = importKey;
    const result = await ctx.client.be(op, story, payload);
    await adoptSession(result, name);
    // A birth minted a fresh keypair: show the permanent identity and
    // offer the key backup right away. Body-level overlay (lazy module)
    // so the view remount that followed the reconnect can't wipe it.
    if (op === "birth" && result?.beingId) {
      import("../shared/identity-panel.js")
        .then((m) => m.showBirthIdentityOverlay(ctx, result))
        .catch(() => {});
    }
    return result;
  }

  // Swap the live connection to a session minted elsewhere (cherub
  // action form, inhabit ack). Saves, disconnects, reconnects, lands.
  async function adoptSession(result, fallbackName = null) {
    // The NAME that signs (the being's trueName). Prefer an explicit field;
    // else read it off the token payload (unverified, display-only — the
    // server verifies on use). The being's `name` is its world label; this is
    // the identity behind it.
    let nameId = result.nameId || null;
    if (!nameId && result.identityToken) {
      try { nameId = JSON.parse(atob(result.identityToken.split(".")[1] || ""))?.nameId || null; } catch { /* opaque token */ }
    }
    const sess = {
      placeUrl: state.get("session")?.placeUrl || config.placeUrl,
      placeIsProxied: resolvePlaceConfig({
        placeUrl: state.get("session")?.placeUrl || config.placeUrl,
      }).useProxy,
      token: result.identityToken,
      username: result.name || fallbackName,
      nameId,
      beingAddress: result.beingAddress,
      // The being's permanent identity: its ed25519 public key (the
      // z... did:key value). The name above is the contextual label;
      // this id never changes.
      beingId: result.beingId || null,
      // Home space the new being was placed in — lands the camera at
      // home right after register, before identity.position/homeSpace
      // fold into the descriptor.
      homeSpaceId: result.homeSpaceId || null,
    };
    saveSession(sess);
    try { ctx.client?.disconnect(); } catch {}
    await connectAndPlace(sess, { freshSignIn: true });
    return sess;
  }

  async function signOut() {
    const sess = state.get("session");
    if (!sess?.token) return;
    const stance = sess.beingAddress
      || `${state.get("discovery")?.story}/@${sess.username}`;
    try {
      await ctx.client.be("release", stance, {});
    } catch (err) {
      // Even if the server says no, drop the client-side session.
      console.warn("[portal] release returned", err?.code || err?.message);
    }
    clearSession();
    try { ctx.client?.disconnect(); } catch {}
    await connectAnonymous();
  }

  // ── Boot ────────────────────────────────────────────────────────

  async function start() {
    events.emit("status", "bootstrapping...");
    const sess = state.get("session");
    const placeUrl = sess?.placeUrl || config.placeUrl;
    const { useProxy } = resolvePlaceConfig({ placeUrl });
    const discovery = await PortalClient.bootstrap(placeUrl, { useProxy });
    state.set({ discovery });
    events.emit("status", `connected to ${discovery.story}`);
    // A being-session (token + beingId) lands at the being; a NAME-only session
    // (token, no being) re-seats the name and lands at the arrival/picker; no
    // token at all is a fresh anonymous arrival -> the Name Form.
    if (sess?.token && sess?.beingId) await connectAndPlace(sess);
    else if (sess?.token) await connectNameOnly(sess);
    else await connectAnonymous(placeUrl, useProxy);
  }

  // Pull the full socket-side `.discovery` (clones, timezone, the
  // whole capability surface) and merge over the HTTP bootstrap.
  async function refreshDiscovery() {
    const story = state.get("discovery")?.story;
    if (!ctx.client || !story) return state.get("discovery");
    try {
      const full = await ctx.client.see(`${story}/.discovery`);
      const merged = { ...state.get("discovery"), ...full };
      state.set({ discovery: merged });
      return merged;
    } catch (err) {
      console.warn("[portal] discovery fetch failed:", err?.message || err);
      return state.get("discovery");
    }
  }

  function destroy() {
    try { ctx.client?.disconnect(); } catch {}
    ctx.navigation.destroy();
    events.clear();
  }

  ctx.start = start;
  ctx.connectAnonymous = connectAnonymous;
  ctx.connectAndPlace = connectAndPlace;
  ctx.signIn = signIn;
  ctx.signOut = signOut;
  ctx.adoptSession = adoptSession;
  ctx.saveSession = saveSession;
  ctx.clearSession = clearSession;
  ctx.clearSession = clearSession;
  ctx.refreshDiscovery = refreshDiscovery;
  ctx.destroy = destroy;
  return ctx;
}

// ── Cross-browser-tab presence ─────────────────────────────────────
//
// Inhabit is a borrowed presence: an inheriter browser tab runs on a
// token authorized by the parent tab's session. When the parent
// closes, the borrowed body releases — the lender went home, the
// lease ends. Wired once at boot against the PRIMARY context.

const PRESENCE_CHANNEL = "treeos-portal-presence";
const SPAWNER_KEY = "treeos-portal-spawner";

export function wirePresence(ctx) {
  if (typeof window === "undefined") return;
  let presence = null;
  try { presence = new BroadcastChannel(PRESENCE_CHANNEL); }
  catch { /* old browser; no cross-tab cascade */ }

  if (_isInheriterTab) {
    // Persist the spawner binding across reloads of this tab.
    const stashed = (() => {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw)?.spawnerName || null : null;
      } catch { return null; }
    })();
    if (stashed) sessionStorage.setItem(SPAWNER_KEY, String(stashed));
    if (presence) {
      presence.addEventListener("message", async (ev) => {
        const msg = ev?.data;
        if (!msg || msg.type !== "parent-leaving") return;
        const mySpawner = sessionStorage.getItem(SPAWNER_KEY);
        if (!mySpawner || msg.username !== mySpawner) return;
        try {
          const story = ctx.state.get("discovery")?.story;
          const username = ctx.state.get("session")?.username;
          if (ctx.client && story && username) {
            await ctx.client.be("release", `${story}/@${username}`, {});
          }
        } catch { /* best effort */ }
        ctx.clearSession();
        sessionStorage.removeItem(SPAWNER_KEY);
        window.location.replace(window.location.pathname);
      });
    }
    // Inheriter tabs release their connect when the tab closes.
    window.addEventListener("pagehide", () => {
      try {
        const story = ctx.state.get("discovery")?.story;
        const username = ctx.state.get("session")?.username;
        if (!ctx.client || !story || !username) return;
        ctx.client.be("release", `${story}/@${username}`, {}).catch(() => {});
      } catch { /* defensive */ }
    });
    return;
  }

  // Parent side: broadcast on close so inheriter tabs spawned from
  // this session release themselves.
  window.addEventListener("pagehide", () => {
    if (!presence) return;
    const username = ctx.state.get("session")?.username || null;
    if (!username) return;
    try { presence.postMessage({ type: "parent-leaving", username }); } catch {}
  });
}
