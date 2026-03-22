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
  if (!cfg.apiKey || !cfg.userId) {
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

module.exports = { load, save, requireAuth, currentNodeId, currentPath, currentLand, isRemoteSession, hasExtension };
