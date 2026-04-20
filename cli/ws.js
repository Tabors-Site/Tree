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

  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    try { socket.removeAllListeners(); } catch {}
    try { socket.disconnect(); } catch {}
  };

  return new Promise((resolve, reject) => {
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
    socket.on("swarmDispatch", forward("swarmDispatch"));
    socket.on("branchStarted", forward("branchStarted"));
    socket.on("branchCompleted", forward("branchCompleted"));

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

module.exports = { runConversational, TreeWSUnavailable };
