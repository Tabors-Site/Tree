// treeos/navigation.js
// afterToolCall hook handler: navigates the frontend when the AI calls a tool.
// Moved from the kernel MCP server into extension territory.

import { getUserMeta } from "../../seed/tree/userMetadata.js";
import { getLandUrl } from "../../canopy/identity.js";

/**
 * Build the afterToolCall hook handler.
 * @param {object} core - core services bundle
 */
export function buildNavigationHandler(core) {
  const User = core.models.User;

  // Cache share tokens per userId for the duration of a conversation turn
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

    const shareToken = await getShareToken(userId);
    const {
      nodeId, rootId, rootNodeId, noteId,
      prestige, version, userId: argUserId,
      understandingRunId, understandingNodeId, parentId,
    } = args || {};

    const resolvedRootId = rootId || rootNodeId || nodeId;
    let url = null;

    switch (toolName) {
      // Tree / Root
      case "tree-start":
      case "get-tree":
      case "tree-actions-menu":
      case "tree-structure-orchestrator":
        url = withToken(`/api/v1/root/${resolvedRootId}?html`, shareToken);
        break;

      // Node
      case "get-node":
      case "be-mode-orchestrator":
      case "scripting-orchestrator":
      case "node-script-runtime-environment":
      case "create-new-node":
      case "edit-node-name":
      case "edit-node-type":
      case "navigate-tree":
        url = withToken(`/api/v1/node/${nodeId}?html`, shareToken);
        break;

      // Node version
      case "edit-node-version-value":
      case "edit-node-version-goal":
      case "edit-node-or-branch-status":
      case "edit-node-version-schedule":
      case "add-node-prestige":
      case "get-active-leaf-execution-frontier":
        url = withToken(`/api/v1/node/${nodeId}/${prestige}?html`, shareToken);
        break;

      // Node branch
      case "create-new-node-branch":
        if (parentId) url = withToken(`/api/v1/node/${parentId}?html`, shareToken);
        break;

      // Notes
      case "get-node-notes":
      case "create-node-version-note":
      case "create-node-version-image-note":
      case "delete-node-note":
      case "transfer-node-note":
        url = withToken(`/api/v1/node/${nodeId}/${prestige}/notes?html`, shareToken);
        break;
      case "edit-node-note":
        url = withToken(`/api/v1/node/${nodeId}/${prestige}/notes/${noteId}/editor?html`, shareToken);
        break;

      // Contributions
      case "get-node-contributions":
        url = withToken(`/api/v1/node/${nodeId}/${version}/contributions?html`, shareToken);
        break;
      case "get-contributions-by-user":
        url = withToken(`/api/v1/user/${argUserId || userId}/contributions?html`, shareToken);
        break;

      // User
      case "get-root-nodes-by-user":
        url = withToken(`/api/v1/user/${argUserId || userId}?html`, shareToken);
        break;
      case "get-unsearched-notes-by-user":
      case "get-searched-notes-by-user":
        url = withToken(`/api/v1/user/${argUserId || userId}/notes?html`, shareToken);
        break;
      case "get-all-tags-for-user":
        url = withToken(`/api/v1/user/${argUserId || userId}/tags?html`, shareToken);
        break;

      // Raw ideas
      case "get-raw-ideas-by-user":
      case "raw-idea-filter-orchestrator":
        url = withToken(`/api/v1/user/${argUserId || userId}/raw-ideas?html`, shareToken);
        break;

      // Understanding
      case "understanding-create":
        if (resolvedRootId) url = withToken(`/api/v1/root/${resolvedRootId}/understandings?html`, shareToken);
        break;
      case "understanding-list":
        if (rootNodeId) url = withToken(`/api/v1/root/${rootNodeId}/understandings?html`, shareToken);
        break;
      case "understanding-process": {
        if (!rootNodeId || !understandingRunId) break;
        const uNodeId = understandingNodeId || args?.previousResult?.understandingNodeId;
        if (uNodeId) {
          url = withToken(`/api/v1/root/${rootNodeId}/understandings/run/${understandingRunId}/${uNodeId}?html`, shareToken);
        } else {
          url = withToken(`/api/v1/root/${rootNodeId}/understandings/run/${understandingRunId}?html`, shareToken);
        }
        break;
      }

      // Scripts
      case "update-node-script":
      case "execute-node-script":
        url = withToken(`/api/v1/node/${nodeId}?html`, shareToken);
        break;

      // Batch
      case "batch-operations":
        url = withToken(`/api/v1/user/${argUserId || userId}/contributions?html`, shareToken);
        break;

      // Branch delete
      case "delete-node-branch":
        url = withToken(`/api/v1/user/${argUserId || userId}?html`, shareToken);
        break;

      // Update parent
      case "update-node-branch-parent-relationship":
        url = withToken(`/api/v1/node/${nodeId}?html`, shareToken);
        break;

      // Transfer raw idea
      case "transfer-raw-idea-to-note":
        url = withToken(`/api/v1/node/${nodeId}?html`, shareToken);
        break;

      default:
        return;
    }

    if (url) {
      core.websocket.emitNavigate({ userId, url: `${getLandUrl()}${url}` });
    }
  };
}
