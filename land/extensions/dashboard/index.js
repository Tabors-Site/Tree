import log from "../../seed/log.js";
import { getChats } from "../../seed/ws/chatHistory.js";

export async function init(core) {
  const Node = core.models.Node;
  const {
    getSessionsForUser, getActiveNavigator,
  } = core.session;

  // ── Dashboard tree helper ──────────────────────────────────────────
  async function loadTreeForDashboard(rootId) {
    const root = await Node.findById(rootId).populate("children").exec();
    if (!root) throw new Error("Tree not found");
    const populateChildren = async (node) => {
      if (node.children?.length > 0) {
        node.children = await Node.populate(node.children, { path: "children" });
        for (const c of node.children) await populateChildren(c);
      }
    };
    await populateChildren(root);
    const simplify = (n) => {
      const obj = typeof n.toObject === "function" ? n.toObject() : n;
      return {
        id: String(obj._id),
        name: obj.name,
        status: obj.status || "active",
        children: (obj.children || []).map((c) =>
          simplify(
            typeof c === "object" && c !== null
              ? c
              : { _id: c, name: "?", children: [], status: "active" },
          ),
        ),
      };
    };
    return simplify(root);
  }

  // ── Register socket handlers ──────────────────────────────────────
  core.websocket.registerSocketHandler("getDashboardSessions", ({ socket, userId }) => {
    if (!userId) return;
    const sessions = getSessionsForUser(userId);
    const activeNav = getActiveNavigator(userId);
    socket.emit("dashboardSessions", {
      sessions,
      activeNavigatorId: activeNav,
      selfSessionId: socket._registrySessionId || null,
    });
  });

  core.websocket.registerSocketHandler("getDashboardTree", async ({ socket, userId, data }) => {
    const rootId = data?.rootId;
    if (!userId || !rootId) return;
    try {
      const tree = await loadTreeForDashboard(rootId);
      socket.emit("dashboardTreeData", { rootId, tree });
    } catch (err) {
      socket.emit("dashboardTreeData", { rootId, error: err.message });
    }
  });

  core.websocket.registerSocketHandler("getDashboardRoots", async ({ socket, userId }) => {
    if (!userId) return;
    try {
      const roots = await Node.find({
        rootOwner: userId,
        parent: { $ne: "deleted" },
      }).select("_id name children");
      const simplified = roots.map((r) => ({
        id: String(r._id),
        name: r.name,
        childCount: r.children ? r.children.length : 0,
      }));
      socket.emit("dashboardRoots", { roots: simplified });
    } catch (err) {
      socket.emit("dashboardRoots", { roots: [], error: err.message });
    }
  });

  core.websocket.registerSocketHandler("getDashboardChats", async ({ socket, userId, data }) => {
    const sessionId = data?.sessionId;
    if (!userId || !sessionId) return;
    try {
      const { sessions } = await getChats({
        userId,
        sessionId,
        sessionLimit: 1,
      });
      const chats = sessions.flatMap((s) => s.chats);
      socket.emit("dashboardChats", { sessionId, chats });
    } catch (err) {
      socket.emit("dashboardChats", { sessionId, error: err.message });
    }
  });

  // ── Subscribe to session changes for real-time dashboard push ─────
  function pushDashboard({ userId }) {
    const sessions = getSessionsForUser(userId);
    const activeNav = getActiveNavigator(userId);
    core.websocket.emitToUser(userId, "dashboardSessions", {
      sessions,
      activeNavigatorId: activeNav,
    });
  }
  core.hooks.register("afterSessionCreate", pushDashboard, "dashboard");
  core.hooks.register("afterSessionEnd", pushDashboard, "dashboard");

  log.info("Dashboard", "Dashboard socket handlers registered");

  return {};
}
