import { getUserMeta, addToUserMetaSet, batchSetUserMeta } from "../../seed/tree/userMetadata.js";
import log from "../../seed/log.js";

let User, Node;

export function setModels(models) {
  User = models.User;
  Node = models.Node;
}

const MAX_RECENT = 5;

// ── Navigation roots (metadata.nav.roots) ──

/**
 * Get all root IDs for a user from metadata.nav.roots.
 * Returns array of root ID strings.
 */
export async function getUserRoots(userId) {
  if (!userId) return [];
  const user = await User.findById(userId).select("metadata").lean();
  if (!user) return [];
  const nav = getUserMeta(user, "nav");
  return Array.isArray(nav.roots) ? nav.roots : [];
}

/**
 * Get roots with resolved names for API/rendering.
 * Returns array of { _id, name, visibility }.
 */
export async function getUserRootsWithNames(userId) {
  const rootIds = await getUserRoots(userId);
  if (rootIds.length === 0) return [];

  const nodes = await Node.find({ _id: { $in: rootIds }, parent: { $ne: "deleted" } })
    .select("_id name visibility")
    .lean();

  const nodeMap = new Map(nodes.map(n => [n._id.toString(), n]));

  // Preserve order, filter out deleted/missing nodes
  return rootIds
    .map(id => nodeMap.get(id))
    .filter(Boolean)
    .map(n => ({ _id: n._id.toString(), name: n.name, visibility: n.visibility }));
}

/**
 * Add a root to a user's navigation list.
 */
export async function addRoot(userId, rootId) {
  if (!userId || !rootId) return;
  try {
    await addToUserMetaSet(userId, "nav", "roots", String(rootId));
    log.info("Navigation", `addRoot: saved root ${rootId} for user ${userId}`);
  } catch (err) {
    log.warn("Navigation", `addRoot failed: ${err.message}`);
  }
}

/**
 * Remove a root from a user's navigation list.
 */
export async function removeRoot(userId, rootId) {
  if (!userId || !rootId) return;
  await User.updateOne(
    { _id: String(userId) },
    { $pull: { "metadata.nav.roots": String(rootId) } },
  );
}

// ── Recent roots (metadata.nav.recentRoots) ──

/**
 * Update recent roots in metadata.nav.recentRoots.
 * Pushes to front, deduplicates, keeps MAX_RECENT entries.
 */
export async function updateRecentRoots(userId, rootId) {
  if (!userId || !rootId) return;

  const node = await Node.findById(rootId).select("name").lean();
  if (!node) return;

  // Read current recents with lean (read-only, no save conflict)
  const user = await User.findById(userId).select("metadata").lean();
  if (!user) return;

  const nav = (user.metadata instanceof Map ? user.metadata.get("nav") : user.metadata?.nav) || {};
  let recents = Array.isArray(nav.recentRoots) ? [...nav.recentRoots] : [];

  recents = recents.filter((r) => r.rootId !== rootId);
  recents.unshift({ rootId, rootName: node.name, lastVisitedAt: new Date() });
  if (recents.length > MAX_RECENT) recents = recents.slice(0, MAX_RECENT);

  // Atomic write to just the recentRoots field
  await batchSetUserMeta(userId, "nav", { recentRoots: recents });
}

/**
 * Get recent roots for a user. Returns array of { rootId, rootName, lastVisitedAt }.
 */
export async function getRecentRootsByUserId(userId) {
  if (!userId) return [];
  const user = await User.findById(userId).select("metadata").lean();
  if (!user) return [];
  const nav = getUserMeta(user, "nav");
  return nav.recentRoots || [];
}

/**
 * Get recent roots with resolved names (names may have changed since stored).
 */
export async function getRecentRootsWithNames(userId) {
  const recents = await getRecentRootsByUserId(userId);
  return Promise.all(
    recents.map(async (r) => {
      let name = r.rootName;
      try {
        const node = await Node.findById(r.rootId).select("name").lean();
        if (node) name = node.name;
      } catch (err) { log.debug("Navigation", "recent root name lookup failed:", err.message); }
      return {
        rootId: r.rootId,
        name: name || r.rootId.slice(0, 8) + "...",
        lastVisitedAt: r.lastVisitedAt,
      };
    }),
  );
}

