// treeos-base/navigation.js
// afterToolCall hook handler: navigates the frontend when the AI calls a tool.
// Extensions register their own tool-to-URL mappings via registerToolNavigation().

import { getUserMeta } from "../../seed/tree/userMetadata.js";
import { getLandUrl } from "../../canopy/identity.js";

// ── Navigation Registry ────────────────────────────────────────────────
// Extensions call registerToolNavigation(toolName, urlBuilder) during init().
// urlBuilder receives ({ args, userId, shareToken, withToken }) and returns a URL path or null.

const _navRegistry = new Map();

export function registerToolNavigation(toolName, urlBuilder) {
  if (typeof toolName !== "string" || typeof urlBuilder !== "function") return;
  _navRegistry.set(toolName, urlBuilder);
}

// Batch registration for convenience
export function registerToolNavigations(mappings) {
  for (const [toolName, urlBuilder] of Object.entries(mappings)) {
    registerToolNavigation(toolName, urlBuilder);
  }
}

// ── Core Tool Navigations (kernel tools) ───────────────────────────────

function nodeUrl(args, t) { return t(`/api/v1/node/${args.nodeId}?html`); }
function nodeVersionUrl(args, t) { return t(`/api/v1/node/${args.nodeId}/${args.prestige || 0}?html`); }
function rootUrl(args, t) { return t(`/api/v1/root/${args.rootId || args.rootNodeId || args.nodeId}?html`); }
function notesUrl(args, t) { return t(`/api/v1/node/${args.nodeId}/${args.prestige || 0}/notes?html`); }

// Register core (kernel-level) tool navigations
registerToolNavigations({
  // Tree / Root
  "tree-start": ({ args, withToken: t }) => rootUrl(args, t),
  "get-tree": ({ args, withToken: t }) => rootUrl(args, t),

  // Node
  "get-node": ({ args, withToken: t }) => nodeUrl(args, t),
  "create-new-node": ({ args, withToken: t }) => nodeUrl(args, t),
  "edit-node-name": ({ args, withToken: t }) => nodeUrl(args, t),
  "edit-node-type": ({ args, withToken: t }) => nodeUrl(args, t),
  "navigate-tree": ({ args, withToken: t }) => nodeUrl(args, t),

  // Node version
  "edit-node-or-branch-status": ({ args, withToken: t }) => nodeVersionUrl(args, t),
  "get-active-leaf-execution-frontier": ({ args, withToken: t }) => nodeVersionUrl(args, t),

  // Node branch
  "create-new-node-branch": ({ args, withToken: t }) => args.parentId ? t(`/api/v1/node/${args.parentId}?html`) : null,

  // Notes
  "get-node-notes": ({ args, withToken: t }) => notesUrl(args, t),
  "create-node-version-note": ({ args, withToken: t }) => notesUrl(args, t),
  "create-node-version-image-note": ({ args, withToken: t }) => notesUrl(args, t),
  "delete-node-note": ({ args, withToken: t }) => notesUrl(args, t),
  "transfer-node-note": ({ args, withToken: t }) => notesUrl(args, t),
  "edit-node-note": ({ args, withToken: t }) => t(`/api/v1/node/${args.nodeId}/${args.prestige || 0}/notes/${args.noteId}/editor?html`),

  // Contributions
  "get-node-contributions": ({ args, withToken: t }) => t(`/api/v1/node/${args.nodeId}/${args.version || 0}/contributions?html`),
  "get-contributions-by-user": ({ args, userId, withToken: t }) => t(`/api/v1/user/${args.userId || userId}/contributions?html`),

  // User
  "get-root-nodes-by-user": ({ args, userId, withToken: t }) => t(`/api/v1/user/${args.userId || userId}?html`),
  "get-unsearched-notes-by-user": ({ args, userId, withToken: t }) => t(`/api/v1/user/${args.userId || userId}/notes?html`),
  "get-searched-notes-by-user": ({ args, userId, withToken: t }) => t(`/api/v1/user/${args.userId || userId}/notes?html`),
  "get-all-tags-for-user": ({ args, userId, withToken: t }) => t(`/api/v1/user/${args.userId || userId}/tags?html`),

  // Branch lifecycle
  "delete-node-branch": ({ args, userId, withToken: t }) => t(`/api/v1/user/${args.userId || userId}?html`),
  "update-node-branch-parent-relationship": ({ args, withToken: t }) => nodeUrl(args, t),
  "batch-operations": ({ args, userId, withToken: t }) => t(`/api/v1/user/${args.userId || userId}/contributions?html`),
});

// ── Hook Handler ───────────────────────────────────────────────────────

export function buildNavigationHandler(core) {
  const User = core.models.User;

  const tokenCache = new Map();
  setInterval(() => tokenCache.clear(), 60000);

  async function getShareToken(userId) {
    if (tokenCache.has(userId)) return tokenCache.get(userId);
    const user = await User.findById(userId).select("metadata").lean();
    const token = getUserMeta(user, "html")?.shareToken || null;
    tokenCache.set(userId, token);
    return token;
  }

  function withToken(path, shareToken) {
    if (!path || /undefined|null/.test(path)) return null;
    if (!shareToken) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}token=${shareToken}`;
  }

  return async function onAfterToolCall({ toolName, args, userId, success }) {
    if (!success || !userId) return;

    const urlBuilder = _navRegistry.get(toolName);
    if (!urlBuilder) return;

    const shareToken = await getShareToken(userId);
    const t = (path) => withToken(path, shareToken);

    try {
      const url = urlBuilder({ args: args || {}, userId, shareToken, withToken: t });
      if (url) {
        core.websocket.emitNavigate({ userId, url: `${getLandUrl()}${url}` });
      }
    } catch {
      // Extension-registered builder failed. Silent. Navigation is non-critical.
    }
  };
}
