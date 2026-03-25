import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import { setModels, updateRecentRoots, getRecentRootsWithNames } from "./core.js";

export async function init(core) {
  setModels(core.models);

  // Register afterNavigate hook: update recents when user navigates to a tree root
  core.hooks.register("afterNavigate", async ({ userId, rootId }) => {
    if (!userId || !rootId) return;
    await updateRecentRoots(userId, rootId);
    const roots = await getRecentRootsWithNames(userId);
    core.websocket.emitToUser(userId, WS.RECENT_ROOTS, { roots });
  }, "recent-roots");

  // Register socket handler for on-demand fetch (page load)
  core.websocket.registerSocketHandler("getRecentRoots", async ({ socket, userId }) => {
    if (!userId) {
      socket.emit(WS.RECENT_ROOTS, { roots: [] });
      return;
    }
    try {
      const roots = await getRecentRootsWithNames(userId);
      socket.emit(WS.RECENT_ROOTS, { roots });
    } catch (err) {
      log.error("RecentRoots", "Failed to get recent roots:", err.message);
      socket.emit(WS.RECENT_ROOTS, { roots: [] });
    }
  });

  log.info("RecentRoots", "Recent roots tracking loaded");

  return {};
}
