import log from "../../seed/log.js";
import { setModels, setLandConfig, recordSignal, buildPhaseContext } from "./core.js";
import { getBeingMeta } from "../../seed/tree/beingMetadata.js";

export async function init(core) {
  setModels(core.models);

  try {
    const { getLandConfigValue } = await import("../../seed/landConfig.js");
    setLandConfig(getLandConfigValue);
  } catch (err) {
    log.debug("Phase", "landConfig import failed:", err.message);
  }

  const { default: router } = await import("./routes.js");

  // ── Hook: afterNote (write signal) ─────────────────────────────────
  core.hooks.register("afterArtifact", async (data) => {
    if (data.beingId) {
      await recordSignal(data.beingId, "write", data.nodeId);
    }
  }, "phase");

  // ── Hook: afterNodeCreate (create signal) ──────────────────────────
  core.hooks.register("afterNodeCreate", async (data) => {
    if (data.beingId) {
      await recordSignal(data.beingId, "create", data.node?._id?.toString());
    }
  }, "phase");

  // ── Hook: afterNavigate (navigate signal) ──────────────────────────
  core.hooks.register("afterNavigate", async (data) => {
    if (data.beingId) {
      await recordSignal(data.beingId, "navigate", data.nodeId || data.rootId);
    }
  }, "phase");

  // ── Hook: afterToolCall (tool signal) ──────────────────────────────
  core.hooks.register("afterToolCall", async (data) => {
    if (data.beingId) {
      await recordSignal(data.beingId, "tool", data.rootId);
    }
  }, "phase");

  // ── Hook: enrichContext (inject phase into AI prompt) ──────────────
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    // meta doesn't have user phase (it's node metadata). We need to read
    // from user metadata via the beingId in context.
    const beingId = context._userId;
    if (!beingId) return;

    try {
      const Being = core.models.Being;
      const user = await Being.findById(beingId).select("metadata").lean();
      if (!user) return;

      const phaseMeta = getBeingMeta(user, "phase");
      const phaseContext = buildPhaseContext(phaseMeta);
      if (phaseContext) {
        context.userPhase = phaseContext;
      }
    } catch (err) {
      log.debug("Phase", "enrichContext failed:", err.message);
    }
  }, "phase");

  log.verbose("Phase", "Phase detection loaded (awareness / attention / scattered)");

  return { router };
}
