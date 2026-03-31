import router from "./routes.js";
import User from "../../seed/models/user.js";
import Node from "../../seed/models/node.js";

export async function init(core) {
  core.llm.registerFailoverResolver(async (userId, rootId) => {
    // Tree-level stack first (tree owner's backups apply to everyone)
    let treeStack = [];
    if (rootId) {
      const root = await Node.findById(rootId).select("metadata").lean();
      const rootMeta = root?.metadata instanceof Map ? Object.fromEntries(root.metadata) : (root?.metadata || {});
      treeStack = rootMeta.llm?.failoverStack || [];
    }

    // User-level stack (personal fallbacks)
    const user = await User.findById(userId).select("metadata").lean();
    const userMeta = user?.metadata instanceof Map ? Object.fromEntries(user.metadata) : (user?.metadata || {});
    const userStack = userMeta.llm?.failoverStack || [];

    // Deduplicate: tree stack wins position
    const seen = new Set();
    const combined = [];
    for (const id of [...treeStack, ...userStack]) {
      if (!seen.has(id)) { seen.add(id); combined.push(id); }
    }
    return combined;
  });

  return { router };
}
