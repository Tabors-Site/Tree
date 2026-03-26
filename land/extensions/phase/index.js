import log from "../../seed/log.js";
import { setModels, setLandConfig, recordSignal, buildPhaseContext } from "./core.js";
import { getUserMeta } from "../../seed/tree/userMetadata.js";

export async function init(core) {
  setModels(core.models);

  try {
    const { getLandConfigValue } = await import("../../seed/landConfig.js");
    setLandConfig(getLandConfigValue);
  } catch {}

  const { default: router } = await import("./routes.js");

  // ── Hook: afterNote (write signal) ─────────────────────────────────
  core.hooks.register("afterNote", async (data) => {
    if (data.userId) {
      await recordSignal(data.userId, "write", data.nodeId);
    }
  }, "phase");

  // ── Hook: afterNodeCreate (create signal) ──────────────────────────
  core.hooks.register("afterNodeCreate", async (data) => {
    if (data.userId) {
      await recordSignal(data.userId, "create", data.node?._id?.toString());
    }
  }, "phase");

  // ── Hook: afterNavigate (navigate signal) ──────────────────────────
  core.hooks.register("afterNavigate", async (data) => {
    if (data.userId) {
      await recordSignal(data.userId, "navigate", data.nodeId || data.rootId);
    }
  }, "phase");

  // ── Hook: afterToolCall (tool signal) ──────────────────────────────
  core.hooks.register("afterToolCall", async (data) => {
    if (data.userId) {
      await recordSignal(data.userId, "tool", data.rootId);
    }
  }, "phase");

  // ── Hook: enrichContext (inject phase into AI prompt) ──────────────
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    // meta doesn't have user phase (it's node metadata). We need to read
    // from user metadata via the userId in context.
    const userId = context._userId;
    if (!userId) return;

    try {
      const User = core.models.User;
      const user = await User.findById(userId).select("metadata").lean();
      if (!user) return;

      const phaseMeta = getUserMeta(user, "phase");
      const phaseContext = buildPhaseContext(phaseMeta);
      if (phaseContext) {
        context.userPhase = phaseContext;
      }
    } catch {}
  }, "phase");

  log.verbose("Phase", "Phase detection loaded (awareness / attention / scattered)");

  return { router };
}
