import log from "../../seed/log.js";
import { setServices, getIntervalMs } from "./intentJob.js";
import { intentRole } from "./intentRole.js";
export async function init(core) {
  core.llm.registerRootLlmSlot("intent");

  setServices({
    models: core.models,
    contributions: core.dids,
    energy: core.energy || null,
    metadata: core.metadata,
  });

  const { setMetadata: setCollectorMetadata } = await import("./stateCollector.js");
  setCollectorMetadata(core.metadata);

  // enrichContext: surface intent data so the AI knows what the tree did autonomously
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const intentMeta = meta?.intent;
    if (!intentMeta) return;

    const injected = {};

    // Show recent executions so the AI knows what the tree did autonomously
    if (intentMeta.recentExecutions?.length > 0) {
      injected.recentIntents = intentMeta.recentExecutions.slice(0, 5).map(e => ({
        action: e.action,
        reason: e.reason,
        result: e.result,
        executedAt: e.executedAt,
      }));
    }

    // Show pending queue so the AI knows what's coming
    if (intentMeta.queue?.length > 0) {
      injected.pendingIntents = intentMeta.queue.length;
    }

    // Show rejected intents so the AI doesn't suggest what the user already rejected
    if (intentMeta.rejected?.length > 0) {
      injected.rejectedIntents = intentMeta.rejected.map(r => r.action || r.pattern || r.description).filter(Boolean);
    }

    if (Object.keys(injected).length > 0) {
      context.intent = injected;
    }
  }, "intent");

  const { default: router, setModels, setMetadata: setRouteMetadata } = await import("./routes.js");
  setModels(core.models);
  setRouteMetadata(core.metadata);

  // ─────────────────────────────────────────────────────────────────
  // Slice 6c conversion. The autonomous intent engine becomes a Mode 1
  // being carrying the `intent` role with code cognition (see
  // intentRole.js). The scheduled-wake registry replaces the legacy
  // setInterval — wakes are substrate-visible SUMMONs that the per-
  // being scheduler serializes and the role's summon handler processes.
  //
  // Three pieces:
  //   1. Register the `intent` role template in the role registry.
  //   2. Ensure a being-instance carrying that role exists at land
  //      root. Idempotent.
  //   3. Register the scheduled wake. Deterministic schedule id so it
  //      can be unscheduled at runtime (turn-off-able per the
  //      populated-architecture rule).
  // ─────────────────────────────────────────────────────────────────
  try {
    core.ibp.registerRole("intent", intentRole);

    const intentBeingId = await ensureIntentBeing(core);
    if (intentBeingId) {
      const intervalMs = getIntervalMs();
      core.ibp.schedule(intentBeingId, {
        id:         "intent:cycle",
        intervalMs,
        intent:     "scheduled-wake",
        content:    { kind: "intent-cycle" },
        priority:   4, // BACKGROUND
      });
      log.info("Intent",
        `@intent being installed at land root, scheduled-wake every ${Math.round(intervalMs / 60000)}m ` +
        `(unschedule via core.ibp.unschedule("intent:cycle"))`);
    } else {
      log.warn("Intent", "Could not establish @intent being; cycles will not run");
    }
  } catch (err) {
    log.warn("Intent", `@intent being setup failed: ${err.message}; cycles will not run`);
  }

  log.info("Intent", "Autonomous intent engine loaded");

  // No legacy `jobs` entry — the schedule registry drives the engine
  // now. Extensions still get a clean `router` export.
  return { router };
}

// Ensure the @intent being exists at land root. Reads
// `metadata.beings.intent.beingId` first; if absent, creates the
// being via `createBeingWithHome` (no new node — being lives at the
// existing land root) and stamps the beings map.
async function ensureIntentBeing(core) {
  const Node = core.models.Node;
  const Being = core.models.Being;
  const landRootId = core.tree.getLandRootId();
  if (!landRootId) return null;

  const landRoot = await Node.findById(landRootId).select("metadata").lean();
  const beings = landRoot?.metadata instanceof Map
    ? landRoot.metadata.get("beings")
    : landRoot?.metadata?.beings;
  const existing = beings?.intent?.beingId;
  if (existing) {
    // Idempotent: a previous boot already created it.
    return String(existing);
  }

  const { createBeingWithHome } = await import("../../seed/auth.js");
  const { being } = await createBeingWithHome({
    operatingMode: "ai",
    role:          "intent",
    homeNodeId:    String(landRootId),
  });
  if (!being?._id) return null;

  // Stamp metadata.beings.intent on the land root so future boots see
  // the established identity and don't try to create a duplicate.
  const landRootDoc = await Node.findById(landRootId);
  if (landRootDoc) {
    const { mergeExtMeta } = await import("../../seed/tree/extensionMetadata.js");
    await mergeExtMeta(landRootDoc, "beings", {
      intent: {
        beingId:     String(being._id),
        installedBy: "intent",
        installedAt: new Date().toISOString(),
      },
    });
  }
  return String(being._id);
}
