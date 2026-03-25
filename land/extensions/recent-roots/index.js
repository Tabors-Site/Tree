import log from "../../seed/log.js";
import { setModels, updateRecentRoots, getRecentRootsWithNames } from "./core.js";

const RECENT_ROOTS_EVENT = "recentRoots";

export async function init(core) {
  setModels(core.models);

  core.hooks.register("afterNavigate", async ({ userId, rootId }) => {
    if (!userId || !rootId) return;
    await updateRecentRoots(userId, rootId);
    const roots = await getRecentRootsWithNames(userId);
    core.websocket.emitToUser(userId, RECENT_ROOTS_EVENT, { roots });
  }, "recent-roots");

  core.websocket.registerSocketHandler("getRecentRoots", async ({ socket, userId }) => {
    if (!userId) {
      socket.emit(RECENT_ROOTS_EVENT, { roots: [] });
      return;
    }
    try {
      const roots = await getRecentRootsWithNames(userId);
      socket.emit(RECENT_ROOTS_EVENT, { roots });
    } catch (err) {
      log.error("RecentRoots", "Failed to get recent roots:", err.message);
      socket.emit(RECENT_ROOTS_EVENT, { roots: [] });
    }
  });

  log.info("RecentRoots", "Recent roots tracking loaded");

  return {};
}
