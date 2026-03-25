// ─────────────────────────────────────────────────
// Shared utilities for HTML renderers
// ─────────────────────────────────────────────────

// ─── HTML escaping ───────────────────────────────
// One definitive implementation. Handles null/undefined,
// coerces to string, escapes all 5 dangerous characters.

export function esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Alias for files that use the longer name
export { esc as escapeHtml };

// ─── Token sanitization ─────────────────────────
// Share tokens contain only URL-safe characters.
// Strip anything else to prevent injection into HTML output.
const TOKEN_SAFE = /^[A-Za-z0-9\-_.~]+$/;

/**
 * Sanitize a share token value. Returns the token if safe, empty string otherwise.
 * Use at every entry point where req.query.token enters the rendering pipeline.
 */
export function sanitizeToken(raw) {
  if (!raw || typeof raw !== "string") return "";
  return TOKEN_SAFE.test(raw) ? raw : "";
}

/**
 * Build a token query string from a sanitized token.
 * Always safe for href/action attributes.
 */
export function safeTokenQS(token) {
  const safe = sanitizeToken(token);
  return safe ? `?token=${encodeURIComponent(safe)}&html` : "?html";
}

// ─── Truncation ──────────────────────────────────

export function truncate(str, len = 200) {
  if (!str) return "";
  const clean = esc(str);
  return clean.length > len ? clean.slice(0, len) + "..." : clean;
}

// Raw truncate (no escaping, for pre-escaped or non-HTML contexts)
export function truncateRaw(str, len = 24) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

// ─── Time formatting ─────────────────────────────

export function formatTime(d) {
  return d ? new Date(d).toLocaleString() : "--";
}

export function formatDuration(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end) - new Date(start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function timeAgo(date) {
  if (!date) return "never";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  return Math.floor(seconds / 86400) + "d ago";
}

// ─── Rainbow depth colors ────────────────────────

export const rainbow = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#32ade6",
  "#5856d6",
  "#af52de",
];

// ─── Action color mappings ───────────────────────
// Two variants: CSS class names (for glass cards) and hex (for inline styles).
// Driven from one authoritative map so they never drift.

const ACTION_COLORS = {
  create:          { cls: "glass-green",   hex: "#48bb78" },
  delete:          { cls: "glass-red",     hex: "#c85050" },
  branchLifecycle: { cls: "glass-red",     hex: "#c85050" },
  editStatus:      { cls: "glass-blue",    hex: "#5082dc" },
  editValue:       { cls: "glass-blue",    hex: "#5082dc" },
  editGoal:        { cls: "glass-blue",    hex: "#5082dc" },
  editSchedule:    { cls: "glass-blue",    hex: "#5082dc" },
  editName:    { cls: "glass-blue",    hex: "#5082dc" },
  editScript:      { cls: "glass-blue",    hex: "#5082dc" },
  executeScript:   { cls: "glass-cyan",    hex: "#38bdd2" },
  prestige:        { cls: "glass-gold",    hex: "#c8aa32" },
  note:            { cls: "glass-purple",  hex: "#9b64dc" },
  rawIdea:         { cls: "glass-purple",  hex: "#9b64dc" },
  invite:          { cls: "glass-pink",    hex: "#d264a0" },
  transaction:     { cls: "glass-orange",  hex: "#dc8c3c" },
  trade:           { cls: "glass-orange",  hex: "#dc8c3c" },
  purchase:        { cls: "glass-emerald", hex: "#34be82" },
  updateParent:    { cls: "glass-teal",    hex: "#3caab4" },
  updateChild: { cls: "glass-teal",    hex: "#3caab4" },
  understanding:   { cls: "glass-indigo",  hex: "#6464d2" },
};

const DEFAULT_ACTION = { cls: "glass-default", hex: "#736fe6" };

export function actionColorClass(action) {
  return (ACTION_COLORS[action] || DEFAULT_ACTION).cls;
}

export function actionColorHex(action) {
  return (ACTION_COLORS[action] || DEFAULT_ACTION).hex;
}

// ─── Action labels ───────────────────────────────

const ACTION_LABELS = {
  create: "Created",
  editStatus: "Status",
  editValue: "Values",
  prestige: "Prestige",
  trade: "Trade",
  delete: "Deleted",
  invite: "Invite",
  editSchedule: "Schedule",
  editGoal: "Goal",
  transaction: "Transaction",
  note: "Note",
  updateParent: "Moved",
  editScript: "Script",
  executeScript: "Ran script",
  updateChild: "Child",
  editName: "Renamed",
  rawIdea: "Raw idea",
  branchLifecycle: "Branch",
  purchase: "Purchase",
  understanding: "Understanding",
};

export function actionLabel(action) {
  return ACTION_LABELS[action] || action;
}

// ─── Media rendering ─────────────────────────────
// lazy: uses data-src + lazy-media class (needs client-side IntersectionObserver)
// immediate: uses src directly

export function renderMedia(fileUrl, mimeType, { lazy = true } = {}) {
  const srcAttr = lazy ? "data-src" : "src";
  const cls = lazy ? ' class="lazy-media"' : "";
  const loading = lazy ? ' loading="lazy"' : "";

  if (mimeType.startsWith("image/")) {
    return `<img ${srcAttr}="${fileUrl}"${loading}${cls} style="max-width:100%;" alt="" />`;
  }
  if (mimeType.startsWith("video/")) {
    return `<video ${srcAttr}="${fileUrl}" controls${lazy ? ' preload="none"' : ""}${cls} style="max-width:100%;"></video>`;
  }
  if (mimeType.startsWith("audio/")) {
    return `<audio ${srcAttr}="${fileUrl}" controls${lazy ? ' preload="none"' : ""}${cls}></audio>`;
  }
  if (mimeType === "application/pdf") {
    return `<iframe ${srcAttr}="${fileUrl}"${loading}${cls} style="width:100%; height:90vh; border:none;"></iframe>`;
  }
  return "";
}

// ─── Chat chain grouping ─────────────────────────

export function groupIntoChains(chats) {
  const chainMap = new Map();
  const chainOrder = [];
  for (const chat of chats) {
    const key = chat.rootChatId || chat._id;
    if (!chainMap.has(key)) {
      chainMap.set(key, { root: null, steps: [] });
      chainOrder.push(key);
    }
    const chain = chainMap.get(key);
    if (chat.chainIndex === 0 || chat._id === key) {
      chain.root = chat;
    } else {
      chain.steps.push(chat);
    }
  }
  return chainOrder
    .map((key) => {
      const chain = chainMap.get(key);
      chain.steps.sort((a, b) => a.chainIndex - b.chainIndex);
      return chain;
    })
    .filter((c) => c.root);
}

// ─── Mode labels ─────────────────────────────────

export function modeLabel(path) {
  if (!path) return "unknown";
  if (path === "translator") return "Translator";
  if (path.startsWith("tree:orchestrator:plan:")) {
    return `Plan Step ${path.split(":")[3]}`;
  }
  const parts = path.split(":");
  const labels = { home: "Home", tree: "Tree", rawIdea: "Raw Idea" };
  const subLabels = {
    default: "Default",
    chat: "Chat",
    structure: "Structure",
    edit: "Edit",
    be: "Be",
    reflect: "Reflect",
    navigate: "Navigate",
    understand: "Understand",
    getContext: "Context",
    respond: "Respond",
    notes: "Notes",
    start: "Start",
    chooseRoot: "Choose Root",
    complete: "Placed",
    stuck: "Stuck",
  };
  const big = labels[parts[0]] || parts[0];
  const sub = subLabels[parts[1]] || parts[1] || "";
  return sub ? `${big} ${sub}` : big;
}

// ─── Source labels ───────────────────────────────

export function sourceLabel(src) {
  const map = {
    user: "User",
    api: "API",
    orchestrator: "Chain",
    background: "Background",
    script: "Script",
    system: "System",
  };
  return map[src] || src;
}
