import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";

let User, Node;

export function setModels(models) {
  User = models.User;
  Node = models.Node;
}

const MAX_RECENT = 5;

/**
 * Update recent roots in metadata.nav.recentRoots.
 * Pushes to front, deduplicates, keeps MAX_RECENT entries.
 */
export async function updateRecentRoots(userId, rootId) {
  if (!userId || !rootId) return;

  const node = await Node.findById(rootId).select("name").lean();
  if (!node) return;

  const user = await User.findById(userId);
  if (!user) return;

  const nav = getUserMeta(user, "nav");
  let recents = Array.isArray(nav.recentRoots) ? nav.recentRoots : [];

  // Remove existing entry for this root
  recents = recents.filter((r) => r.rootId !== rootId);

  // Add to front
  recents.unshift({
    rootId,
    rootName: node.name,
    lastVisitedAt: new Date(),
  });

  // Trim
  if (recents.length > MAX_RECENT) {
    recents = recents.slice(0, MAX_RECENT);
  }

  nav.recentRoots = recents;
  setUserMeta(user, "nav", nav);
  await user.save();
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
      } catch {}
      return {
        rootId: r.rootId,
        name: name || r.rootId.slice(0, 8) + "...",
        lastVisitedAt: r.lastVisitedAt,
      };
    }),
  );
}
