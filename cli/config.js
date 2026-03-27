const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG_DIR = path.join(os.homedir(), ".treeos");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG = {
  apiKey: null,
  userId: null,
  username: null,
  activeRootId: null,
  activeRootName: null,
  // Stack of { id, name } objects — index 0 is root node
  pathStack: [],
  // true when at /~ (user home), false when at / (land level)
  atHome: false,
  // Named sessions pinned to positions. @fitness stays at /Health/Fitness.
  // { [handle]: { rootId, rootName, pathStack, createdAt } }
  sessions: {},
  // Active session handle (null = default, follows navigation)
  activeSession: null,
};

function load() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function save(config) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function requireAuth() {
  const cfg = load();
  if ((!cfg.apiKey && !cfg.jwtToken) || !cfg.userId) {
    throw new Error("Not logged in. Run: treeos login or treeos register");
  }
  return cfg;
}

function currentNodeId(cfg) {
  if (cfg.pathStack.length === 0) return cfg.activeRootId;
  return cfg.pathStack[cfg.pathStack.length - 1].id;
}

function currentPath(cfg) {
  const remote = cfg.remoteDomain ? `/@${cfg.remoteDomain}` : "";
  if (!cfg.activeRootId) {
    if (remote) return remote + "/";
    return cfg.atHome ? "/~" : "/";
  }
  const parts = [cfg.activeRootName, ...cfg.pathStack.map((n) => n.name)];
  return remote + "/" + parts.join("/");
}

function currentLand(cfg) {
  return cfg.landUrl ? cfg.landUrl.replace(/^https?:\/\//, "").replace(/:\d+$/, "").replace(/\/+$/, "") : "local";
}

function isRemoteSession(cfg) {
  return !!cfg.remoteDomain;
}

function hasExtension(cfg, name) {
  const protocol = cfg.landProtocol;
  if (!protocol) return true; // no protocol info cached, assume available
  const all = [...(protocol.capabilities || []), ...(protocol.extensions || [])];
  return all.includes(name);
}

function getProtocolCli(cfg) {
  return cfg?.landProtocol?.cli || {};
}

// ── Session helpers ──

/**
 * Get or create a named session. Sessions pin to the current position.
 * Returns { rootId, rootName, pathStack, nodeId, handle }.
 */
function getSession(cfg, handle) {
  if (!handle || handle === "default") return null; // default = follow navigation
  if (!cfg.sessions) cfg.sessions = {};
  return cfg.sessions[handle] || null;
}

function createSession(cfg, handle) {
  if (!cfg.sessions) cfg.sessions = {};
  cfg.sessions[handle] = {
    rootId: cfg.activeRootId,
    rootName: cfg.activeRootName,
    pathStack: [...cfg.pathStack],
    createdAt: new Date().toISOString(),
  };
  cfg.activeSession = handle;
  save(cfg);
  return cfg.sessions[handle];
}

function switchSession(cfg, handle) {
  if (!handle || handle === "default") {
    cfg.activeSession = null;
  } else {
    cfg.activeSession = handle;
  }
  save(cfg);
}

function killSession(cfg, handle) {
  if (!cfg.sessions) return;
  delete cfg.sessions[handle];
  if (cfg.activeSession === handle) cfg.activeSession = null;
  save(cfg);
}

function listSessions(cfg) {
  if (!cfg.sessions) return [];
  return Object.entries(cfg.sessions).map(([handle, s]) => ({
    handle,
    rootName: s.rootName,
    position: s.pathStack?.length ? s.pathStack.map(n => n.name).join("/") : "(root)",
    createdAt: s.createdAt,
    active: cfg.activeSession === handle,
  }));
}

/**
 * Resolve the effective rootId and nodeId for a message.
 * If a session is active, use the pinned position. Otherwise, follow navigation.
 */
function resolveSessionTarget(cfg, handle) {
  const sess = handle ? getSession(cfg, handle) : null;
  if (sess) {
    const nodeId = sess.pathStack?.length
      ? sess.pathStack[sess.pathStack.length - 1].id
      : sess.rootId;
    return { rootId: sess.rootId, nodeId, handle };
  }
  // Default: follow current navigation position
  return { rootId: cfg.activeRootId, nodeId: currentNodeId(cfg), handle: null };
}

function currentZone(cfg) {
  if (cfg.activeRootId) return "tree";
  if (cfg.atHome) return "home";
  return "land";
}

module.exports = {
  load, save, requireAuth, currentNodeId, currentPath, currentLand, currentZone,
  isRemoteSession, hasExtension, getProtocolCli,
  getSession, createSession: createSession, switchSession, killSession,
  listSessions, resolveSessionTarget,
};
