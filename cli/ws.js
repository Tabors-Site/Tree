// TreeOS CLI . ws.js
//
// WebSocket client for the four conversational verbs: chat, place, query, be.
// Connects to the same land the HTTP API uses, authenticates with the same
// API key or JWT, and surfaces the live reasoning stream (mode picks, tool
// calls, thinking prose, swarm branches) to a callback so the terminal can
// render it as it happens.
//
// Everything outside of chat/place/query/be stays on HTTP. This wrapper is
// only loaded when the CLI enters a conversational command.
//
// Fallback contract: if the socket can't connect within CONNECT_TIMEOUT_MS,
// throw a distinguishable Error (name === "TreeWSUnavailable") so the caller
// can fall back to the existing HTTP path. Any other error surfaces normally.

const { load } = require("./config");

const CONNECT_TIMEOUT_MS = 3000;
const REQUEST_TIMEOUT_MS = 45 * 60 * 1000;

function getSocketBase() {
  const cfg = load();
  let site = cfg.landUrl || "https://treeOS.ai";
  if (!/^https?:\/\//i.test(site)) {
    const isLocal =
      site.startsWith("localhost") ||
      site.startsWith("127.") ||
      site.startsWith("192.168.") ||
      site.startsWith("10.");
    site = (isLocal ? "http://" : "https://") + site;
  }
  return site.replace(/\/+$/, "");
}

function authParams() {
  // The websocket server accepts JWT via `handshake.auth.token` (same
  // secret the HTTP auth middleware uses). API keys are not accepted
  // at the socket layer — `runConversational` raises
  // TreeWSUnavailable when no JWT is cached so the CLI command falls
  // back to HTTP transparently. Password login populates jwtToken;
  // pure API key setups take the HTTP path, which is the correct
  // non-interactive behavior anyway.
  //
  // `client` + `instance` give this connection a unique identity
  // under the user so a CLI chat doesn't kick the website's socket
  // (or another CLI shell's). Server reads these in the auth
  // middleware and uses them to build the visitorId.
  const cfg = load();
  if (!cfg.jwtToken) return null;
  return {
    token: cfg.jwtToken,
    client: "cli",
    instance: `p${process.pid}`,
  };
}

class TreeWSUnavailable extends Error {
  constructor(msg) {
    super(msg);
    this.name = "TreeWSUnavailable";
  }
}

/**
 * Open a websocket, send one conversational message, stream progress
 * events through onProgress, resolve with the final answer. Always
 * disconnects when done.
 *
 * opts:
 *   verb           "chat" | "place" | "query" | "be"
 *   message        the user's text
 *   currentNodeId  optional — node to run at inside the tree
 *   onProgress     (event) => void   — event: { type, ...payload }
 *
 * Event types emitted to onProgress:
 *   "executionStatus"     { phase, text }
 *   "orchestratorStep"    { modeKey, result, timestamp }
 *   "modeSwitched"        { mode, ... }
 *   "toolCalled"          { tool, args }
 *   "toolResult"          { tool, success, error?, args? }
 *   "thinking"            { text, modeKey }
 *   "swarmDispatch"       { count, branches: [{name, ...}] }
 *   "branchStarted"       { name, index, total, ... }
 *   "branchCompleted"     { name, status, error?, ... }
 */
async function runConversational({ verb, message, rootId = null, currentNodeId = null, zone = null, sessionHandle = null, onProgress = () => {} }) {
  let io;
  try {
    ({ io } = require("socket.io-client"));
  } catch (err) {
    throw new TreeWSUnavailable(
      "socket.io-client is not installed. Run: npm install in the CLI directory, or pass --no-live.",
    );
  }

  const base = getSocketBase();
  const auth = authParams();
  if (!auth) {
    throw new TreeWSUnavailable(
      "No JWT cached for websocket auth — the live stream requires a password login. Falling back to HTTP.",
    );
  }

  const socket = io(base, {
    auth,
    transports: ["websocket", "polling"],
    reconnection: false,
    timeout: CONNECT_TIMEOUT_MS,
  });

  // Expose the live socket to the interactive shell so mid-flight
  // messages typed while a chat is in progress can be emitted onto it.
  // The server's stream extension sees a second `chat` event on a
  // socket that already has an in-flight _chatAbort and routes through
  // its _onStreamMessage path — accumulate, drain at next tool-loop
  // checkpoint. Without this, the shell would just queue the line and
  // the AI would never see it until the current turn ends. Matches
  // how the HTML page already works (one persistent socket, multiple
  // emits).
  global._treeosActiveSocket = {
    socket,
    rootId, currentNodeId, zone, sessionHandle,
    username: load().username || "cli",
    verb,
  };

  let finished = false;
  let rejectFn = null;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    try { socket.removeAllListeners(); } catch {}
    try { socket.disconnect(); } catch {}
    if (global._treeosActiveSocket?.socket === socket) {
      global._treeosActiveSocket = null;
    }
    if (global._treeosInFlight?._socket === socket) {
      global._treeosInFlight = null;
    }
  };

  // Expose an abort handle for the shell's SIGINT handler. Ctrl+C
  // checks global._treeosInFlight?.abort() — emit cancelRequest to
  // the server, reject the pending Promise so the shell unblocks,
  // then clean up the local socket. Without the reject the Promise
  // hangs forever and the shell prompt never returns.
  global._treeosInFlight = {
    _socket: socket,
    abort() {
      // Emit first, give socket.io a tick to flush, THEN disconnect.
      // Emitting + disconnecting in the same tick drops the cancel on
      // the floor: disconnect closes the transport before the emit
      // buffer drains and the server never fires the handler. The
      // 50ms grace is enough for websocket.send() to complete in
      // the local case; remote servers tolerate the same delay.
      try { socket.emit("cancelRequest"); } catch {}
      if (rejectFn && !finished) {
        rejectFn(new Error("Chat cancelled by user"));
      }
      setTimeout(cleanup, 50);
    },
  };

  return new Promise((resolve, reject) => {
    rejectFn = reject;
    const connectTimer = setTimeout(() => {
      if (socket.connected) return;
      cleanup();
      reject(new TreeWSUnavailable("WebSocket connect timed out after 3s."));
    }, CONNECT_TIMEOUT_MS + 200);

    const overallTimer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket request timed out."));
    }, REQUEST_TIMEOUT_MS);

    socket.on("connect_error", (err) => {
      clearTimeout(connectTimer);
      clearTimeout(overallTimer);
      cleanup();
      reject(new TreeWSUnavailable(`WebSocket connect failed: ${err.message}`));
    });

    socket.on("disconnect", (reason) => {
      if (finished) return;
      clearTimeout(connectTimer);
      clearTimeout(overallTimer);
      cleanup();
      reject(new TreeWSUnavailable(`WebSocket disconnected: ${reason}`));
    });

    // Two-step handshake that mirrors the browser client:
    //   1. On `connect`, emit `register` to ask the server to attach
    //      the AI session + MCP bridge to this socket.
    //   2. On `registered`, it's safe to send `chat`. Emitting earlier
    //      races the server-side `ensureSession`/`connectToMCP` setup
    //      and the first message gets silently dropped.
    let _chatSent = false;
    socket.on("connect", () => {
      socket.emit("register");
    });

    socket.on("registered", () => {
      // Guard against a second `registered` firing on the same socket
      // (reconnect, auth race, etc.). One chat per runConversational call.
      if (_chatSent) return;
      _chatSent = true;
      clearTimeout(connectTimer);
      // Pin this socket's session to the tree the CLI is inside.
      // The server accepts rootId + currentNodeId directly on the
      // chat payload — it validates and calls setRootId/setCurrentNodeId
      // on the visitorId session before dispatching to the orchestrator.
      // This makes the CLI authoritative about position, which matters
      // after a server restart when the server-side session state is
      // gone and otherwise defaults to "home" zone.
      const payload = {
        message,
        username: load().username || "cli",
        generation: Date.now(),
        mode: verb,
      };
      if (rootId) payload.rootId = rootId;
      if (currentNodeId) payload.currentNodeId = currentNodeId;
      if (zone) payload.zone = zone;
      if (sessionHandle) payload.sessionHandle = sessionHandle;
      socket.emit("chat", payload);
    });

    // Progress events — forwarded verbatim. The renderer interprets.
    const forward = (type) => (payload) => {
      try { onProgress({ type, ...(payload || {}) }); } catch {}
    };
    socket.on("executionStatus", forward("executionStatus"));
    socket.on("orchestratorStep", forward("orchestratorStep"));
    socket.on("modeSwitched", forward("modeSwitched"));
    socket.on("toolCalled", forward("toolCalled"));
    socket.on("toolResult", forward("toolResult"));
    socket.on("thinking", forward("thinking"));
    // Stream extension ACK: a mid-flight chat emit was absorbed into the
    // running turn. The CLI renderer turns this into a subtle "merged"
    // line so the user can confirm their second message reached the server.
    socket.on("messageQueued", forward("messageQueued"));
    socket.on("swarmDispatch", forward("swarmDispatch"));
    socket.on("branchStarted", forward("branchStarted"));
    socket.on("branchCompleted", forward("branchCompleted"));
    // Plan-first swarm events.
    socket.on("swarmPlanProposed", forward("swarmPlanProposed"));
    socket.on("swarmPlanUpdated", forward("swarmPlanUpdated"));
    socket.on("swarmPlanArchived", forward("swarmPlanArchived"));
    // Scout-phase events (semantic seam verification after builders finish).
    socket.on("swarmScoutsDispatched", forward("swarmScoutsDispatched"));
    socket.on("swarmScoutReport", forward("swarmScoutReport"));
    socket.on("swarmIssuesRouted", forward("swarmIssuesRouted"));
    socket.on("swarmRedeploying", forward("swarmRedeploying"));
    socket.on("swarmReconciled", forward("swarmReconciled"));

    // Terminal events
    socket.on("chatResponse", (resp) => {
      clearTimeout(overallTimer);
      cleanup();
      resolve({
        kind: "chat",
        answer: resp?.answer || "",
        targetNodeId: resp?.targetNodeId || null,
        success: resp?.success !== false,
      });
    });
    socket.on("placeResult", (resp) => {
      clearTimeout(overallTimer);
      cleanup();
      resolve({
        kind: "place",
        stepSummaries: resp?.stepSummaries || [],
        targetPath: resp?.targetPath || null,
        success: resp?.success !== false,
      });
    });
    socket.on("chatError", (err) => {
      clearTimeout(overallTimer);
      cleanup();
      reject(new Error(err?.error || "Chat error"));
    });
    socket.on("chatCancelled", () => {
      clearTimeout(overallTimer);
      cleanup();
      reject(new Error("Chat cancelled"));
    });
  });
}

/**
 * Send a mid-flight message to a currently-running conversational
 * chat. Returns true if the message was emitted on the active socket,
 * false when there is no active chat (caller should fall back to
 * queueing or starting a fresh runConversational).
 *
 * The payload mirrors the shape runConversational uses on the initial
 * `chat` emit so the server's stream extension (which reads from the
 * same chat handler) sees consistent context. The server detects
 * in-flight state via socket._chatAbort and routes this second emit
 * through socket._onStreamMessage → accumulator → next tool-loop
 * checkpoint.
 */
function sendMidflight(message) {
  const active = global._treeosActiveSocket;
  if (!active?.socket || !active.socket.connected) return false;
  if (!message || typeof message !== "string") return false;
  const payload = {
    message,
    username: active.username,
    generation: Date.now(),
    mode: active.verb || "chat",
  };
  if (active.rootId) payload.rootId = active.rootId;
  if (active.currentNodeId) payload.currentNodeId = active.currentNodeId;
  if (active.zone) payload.zone = active.zone;
  if (active.sessionHandle) payload.sessionHandle = active.sessionHandle;
  try {
    active.socket.emit("chat", payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if there's an active conversational socket right now.
 * Used by the shell to decide whether to queue or route a line
 * mid-flight.
 */
function hasActiveSocket() {
  return !!(global._treeosActiveSocket?.socket?.connected);
}

module.exports = { runConversational, TreeWSUnavailable, sendMidflight, hasActiveSocket };
