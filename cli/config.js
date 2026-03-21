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
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function requireAuth() {
  const cfg = load();
  if (!cfg.apiKey || !cfg.userId) {
    throw new Error("Not logged in. Run: treeos login --key YOUR_API_KEY");
  }
  return cfg;
}

function currentNodeId(cfg) {
  if (cfg.pathStack.length === 0) return cfg.activeRootId;
  return cfg.pathStack[cfg.pathStack.length - 1].id;
}

function currentPath(cfg) {
  if (!cfg.activeRootName) return "~";
  const parts = [cfg.activeRootName, ...cfg.pathStack.map((n) => n.name)];
  return "/" + parts.join("/");
}

module.exports = { load, save, requireAuth, currentNodeId, currentPath };
