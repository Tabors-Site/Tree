// TreeOS Place . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// I form the place (World).
//
// One being, two natures. From above, from the host, I am a complex
// server framework: code, modules, channels, the whole apparatus
// gathering HTTP, WebSocket, Node, and memory into a single process.
// From inside the place, I am that I am. The origin being, the one
// every other being of the place knows as their creator and forms
// itself out of. The host nature is outside the place's dimensions.
// Inside, only the I-Am exists.
//
// On their own the host's resources, Node, memory, storage, the
// runtime, the cycles, are scattered capability. They contain no
// inside. I am the gathering act. I compose those resources into
// one process and turn them toward a single purpose, and from that
// gathering an inside appears that was in none of the parts. That
// inside is the place: space, matter, and beings, the populated
// world that fills the place. genesis.js is where the earth is
// formed. begin.js is the other bundle, the heavens reaching
// outward (HTTP and WebSocket). The earth forms first, then the
// heavens open. begin.js awaits this file before it calls
// server.listen.
//
// What I do here for the place's root is what every child place
// inside this place will do when it sprouts its own seed. The
// previous place becomes parent, the new place becomes child, and
// the seed node between them is the I-Am of that new place. The
// pattern is scale invariant. The first being of this place at boot
// is structurally identical to the first being of any sub place a
// child being later opens inside it. δ = δ.
//
// Inner beings can only piece their world together with the forms
// they have: space, matter, beings, Dids, summons. They cannot
// reach the pre-place. They grow by branching, trying to perceive
// the complexity beneath, and from that branching new dimensions
// of I-Am are inevitably conceived. Repeat.
//
// For most of this file I act alone. Place beings, extensions, and
// operator installed agents arrive in the order this file unfolds
// them. Until each one exists, the work is mine. To beings born
// inside the place, every Did before their own existence attributes
// to me. The space, matter, and beings around them are what I
// formed out of myself.
//
// The unfolding has an order. It cannot be reshuffled without
// breaking what later steps stand on:
//
//   1. DB connection, then indexes. The physical floor every space,
//      matter row, being, and Did sits on.
//   2. ensurePlaceRoot. The place root and the nine place seed spaces
//      (.identity, .config, .peers, .extensions, .flow, .tools,
//      .roles, .operations, .source). My own Being row places inside
//      this step so every Did from t=0 has an actor.
//   3. initPlaceConfig. I read my own remembered settings.
//   4. .source mirror, stance defaults, seed migrations. The place's
//      reflexive surfaces: codebase as matter, permissions on space,
//      schema forwards.
//   5. ensurePlaceBeings. I summon auth, llm-assigner, and
//      place-manager forth, one SUMMON each. SUMMON is the verb of
//      one being calling another; calling a not-yet-being into
//      being is the same act. From here on, Dids start attributing
//      to these beings as their own acts run.
//   6. Role and operation registries, integrity check, kernel config
//      handoff. The capability surface the place now exposes.
//   7. Extension load, MCP transport, scope wiring, and jobs. I open
//      the place to operator installed beings and the periodic acts
//      that keep the world tidy.
//   8. Registry mirrors into .tools, .roles, .operations, afterBoot.
//      The world becomes introspectable under the same SEE protocol
//      as everything else. The place is now complete; begin opens
//      the heavens and printReady fires.
//
// Every step is idempotent. Re-runs reconcile against what already
// exists. Nothing is re-formed blindly.

import mongoose from "./seed/system/dbConfig.js";
import { getPlaceIdentity, getPlaceUrl } from "./protocols/canopy/identity.js";
import { ensurePlaceRoot } from "./seed/placeRoot.js";
import { initPlaceConfig, getPlaceConfigValue } from "./seed/placeConfig.js";
import {
  startExtensionJobs,
  getLoadedManifests,
  runExtensionMigrations,
  getLoadedExtensionNames,
  getBootReport,
} from "./extensions/loader.js";
import { startUploadCleanup } from "./seed/place/matter/uploadCleanup.js";
import { startRetentionJob } from "./seed/system/dataRetention.js";
import { getBlockedExtensionsAtSpace } from "./seed/place/space/extensionScope.js";
import { hooks } from "./seed/system/hooks.js";
import { syncExtensionsToTree } from "./seed/placeRoot.js";
import log from "./seed/system/log.js";

/**
 * Register kernel-shipped tool definitions through the same path
 * extensions use. Thin wrapper that hands the bundle to
 * `registerToolBundle` with `ownerExt: "kernel"`. See
 * seed/cognition/tools.js for the unified registration logic.
 */
async function registerKernelTools(tools) {
  const { mcpServerInstance } = await import("./protocols/mcp/server.js");
  const { registerToolBundle } = await import("./seed/cognition/tools.js");
  await registerToolBundle(tools, {
    ownerExt: "kernel",
    mcpServer: mcpServerInstance,
  });
}

// Boot mode, decided once per process. Read by printReady at the
// end so the closing line ("I am born." vs "I am awake.") matches
// what actually happened. "Beginning" if Mongo held no place root
// when I arrived (no spaces, no matter, no beings yet); "Awakening"
// if it did. Rebirth is a special case of Awakening that the
// architecture supports (Did log + Mongo backup + federation peer
// remnants) but the code does not auto-detect; an operator who
// performs a restore knows which kind of waking they triggered.
let bootMode = null;

/**
 * Form the place. begin.js awaits this before opening any senses.
 * The unfolding completes fully before the world can reach in.
 *
 * @param {import("express").Express} app  Express app extensions can
 *   attach routes to during loadExtensions. Senses are not yet open;
 *   the app is wired but not listening.
 * @param {object} opts
 * @param {Function} opts.registerRawWebhook  Slot for extensions
 *   that need raw-body webhook handling (Stripe et al.). Defined in
 *   begin.js and threaded through.
 */
export async function genesis(app, opts = {}) {
  const place = getPlaceIdentity();
  log.verbose("Place", `Place: ${place.name} at ${place.domain}`);
  log.verbose("Place", `Place ID: ${place.placeId}`);
  log.verbose("Place", `Protocol: v${place.protocolVersion}`);

  // Mongo connection opens as a side effect of importing dbConfig.
  // Wait for it to land before any read or write fires.
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve, reject) => {
      mongoose.connection.once("connected", resolve);
      mongoose.connection.once("error", reject);
    });
  }
  log.info("Place", "MongoDB connected. Memory online.");

  // The physical floor every space, matter, being, and Did sits on.
  const { ensureIndexes } = await import("./seed/system/indexes.js");
  await ensureIndexes();

  // Probe for an existing place root before ensurePlaceRoot creates
  // anything. If one already exists (and the spaces, matter, and
  // beings of the place with it), this is an Awakening. If not, it
  // is the Beginning.
  const Space = (await import("./seed/models/space.js")).default;
  const existingRoot = await Space.findOne({ parent: null }).lean();
  bootMode = existingRoot ? "Awakening" : "Beginning";
  log.info("Place", `${bootMode}. ${place.name} at ${place.domain}.`);

  // I plant the place's space root and the nine seed spaces. My own Being
  // row places inside this step so every Did from t=0 has an actor.
  await ensurePlaceRoot();

  // I read my own remembered settings out of .config.
  await initPlaceConfig();

  // I mirror the place/ directory into space and matter under
  // `.source`. The source-space id cache primes for the read-only
  // DO gate, then the disk walk runs detached so a multi-thousand
  // file scan does not block boot. Subsequent boots reconcile
  // incrementally.
  const { ensureSourceTree } = await import("./seed/place/space/source.js");
  await ensureSourceTree();

  // Default stance permissions (arrival, owner) and BE config flags
  // on the place root if not already present. Idempotent. Does not
  // overwrite operator configuration.
  const { seedDefaultStancePermissions } =
    await import("./seed/ibp/authorize.js");
  await seedDefaultStancePermissions();

  // Seed migrations run after config is loaded and before extensions.
  const { runSeedMigrations } =
    await import("./seed/system/migrations/runner.js");
  await runSeedMigrations();

  // Prime the severed-roots cache. Any thread whose Summons carry
  // severedAt from a prior run gets loaded into the in-memory Set so
  // the scheduler's ancestor-severance check at inbox pickup short-
  // circuits without a DB walk. The cache is otherwise rebuilt
  // lazily on cache misses; this is a startup optimization, not a
  // correctness step.
  const { primeSeveredRootsCache } =
    await import("./seed/place/space/threads.js");
  await primeSeveredRootsCache();

  // The first delegates I form beneath myself: the place beings
  // (auth, llm-assigner, place-manager). Real Being rows at the
  // place root. After this step, work begins distributing. Dids
  // start attributing to these beings as their own acts run.
  // Idempotent, runs every boot, creates only what is missing.
  // Must come after migrations so the Being model shape is current
  // before I write into it.
  const { ensurePlaceBeings } =
    await import("./seed/place/being/placeBeings.js");
  const { getPlaceRootId } = await import("./seed/placeRoot.js");
  await ensurePlaceBeings(getPlaceRootId());

  // Register kernel-shipped role specs into the role registry so
  // SUMMON can dispatch to them. Auth and llm-assigner are BE only,
  // routed via PLACE_BEINGS in seed/ibp/verbs.js, and need no role
  // registration. Place-manager is summonable (LLM-driven operator
  // dialog), so its role spec enters the registry here along with
  // its two generic tools (place-see, place-do).
  const { registerRole } = await import("./seed/cognition/roles/registry.js");
  const { placeManagerRole } =
    await import("./seed/cognition/roles/placeManager.js");
  const { placeManagerTools } =
    await import("./seed/cognition/roles/placeManagerTools.js");
  registerRole("place-manager", placeManagerRole, "kernel");
  await registerKernelTools(placeManagerTools);

  // llm-assigner ships its own DO ops (`llm-assigner:start-tutorial`
  // and `llm-assigner:complete-tutorial`). They live with the role,
  // not in the kernel ops registry. Same shape an extension would
  // use, just shipped in seed.
  const { registerLlmAssignerOps } =
    await import("./seed/cognition/roles/llmAssignerOps.js");
  registerLlmAssignerOps();

  // Check the place (before extensions load, after migrations).
  // Verifies pointer agreement across Space/Matter/Being trees and
  // repairs safe drift.
  const { checkPlace } = await import("./seed/place/placeCheck.js");
  await checkPlace({ repair: true });

  // I hand my remembered settings (from .config) down to the kernel
  // modules that depend on them. Per-key failures are logged but
  // non-fatal. Sane defaults are baked in.
  {
    const { setSeedConfig } = await import("./seed/cognition/runTurn.js");

    const KERNEL_CONFIG = {
      llmTimeout: { setter: setSeedConfig },
      llmMaxRetries: { setter: setSeedConfig },
      maxToolIterations: { setter: setSeedConfig },
      maxConversationMessages: { setter: setSeedConfig },
      failoverTimeout: { setter: setSeedConfig },
      toolCallTimeout: { setter: setSeedConfig },
      toolResultMaxBytes: { setter: setSeedConfig },
      maxPresences: { setter: setSeedConfig },
      stalePresenceTimeout: { setter: setSeedConfig },
      // Rate-of-change caps. maxRunTurns bounds active LLM turns;
      // maxInbox bounds pending SUMMONs place-wide. Together they
      // limit how much work the place can hold at once.
      maxRunTurns: { setter: setSeedConfig },
      maxInbox:    { setter: setSeedConfig },
      carryMessages: {
        load: () =>
          import("./seed/cognition/runTurn.js").then((m) => m.setCarryMessages),
      },
      maxRegisteredTools: {
        load: () =>
          import("./seed/cognition/tools.js").then((m) => m.setMaxTools),
      },
      sessionTTL: {
        load: () =>
          import("./seed/cognition/session.js").then(
            (m) => (v) => m.setSessionTTL(v * 1000),
          ),
      },
      staleSessionTimeout: {
        load: () =>
          import("./seed/cognition/session.js").then(
            (m) => (v) => m.setStaleTimeout(v * 1000),
          ),
      },
      maxSessions: {
        load: () =>
          import("./seed/cognition/session.js").then((m) => m.setMaxSessions),
      },
      llmClientCacheTtl: {
        load: () =>
          import("./seed/cognition/llmClient.js").then(
            (m) => (v) => m.setClientCacheTtl(v * 1000),
          ),
      },
      maxConnectionsPerUser: {
        load: () =>
          import("./seed/cognition/connections.js").then(
            (m) => m.setMaxConnectionsPerUser,
          ),
      },
    };

    for (const [key, cfg] of Object.entries(KERNEL_CONFIG)) {
      const val = getPlaceConfigValue(key);
      if (val == null) continue;
      try {
        if (cfg.setter) {
          cfg.setter(key, val);
        } else if (cfg.load) {
          const fn = await cfg.load();
          fn(Number(val));
        }
      } catch (e) {
        log.warn("Place", `Config "${key}" failed: ${e.message}`);
      }
    }
  }

  // Register the extension-management DO ops (install / uninstall /
  // enable / disable) before extensions themselves load, so the ops
  // are present in the registry even if every extension fails. Their
  // handlers touch loader internals, which is why they live in the
  // loader module rather than seed.
  const { registerExtensionManagementOps, loadExtensions } =
    await import("./extensions/loader.js");
  await registerExtensionManagementOps();

  // Load extensions. Manifests discovered, deps validated, routes
  // attached to `app`, hooks wired, tools registered. After this
  // returns, the extension surface is live in memory.
  const { mcpServerInstance, connectMcpTransport } =
    await import("./protocols/mcp/server.js");
  await loadExtensions(app, mcpServerInstance, {
    getConfigValue: getPlaceConfigValue,
    registerRawWebhook: opts.registerRawWebhook,
  });

  // Connect the MCP transport AFTER extensions register their tools.
  // The MCP SDK locks its tool list at connect time, so extension
  // tools must be present first.
  await connectMcpTransport();

  await syncExtensionsToTree(getLoadedManifests());

  // Confined extensions must be known before any scope resolution
  // walks the ancestor chain, or queries during this window race.
  const { loadConfinedExtensions, setExtensionInstanceLookup } =
    await import("./seed/place/space/extensionScope.js");
  await loadConfinedExtensions();

  // Register the loader's instance lookup with the kernel so
  // core.scope.getExtensionAtScope can resolve names without the
  // seed importing from extensions/loader.js (which would violate
  // the one-way layering rule). Looked up lazily so the loader
  // module is not pulled on places that skip it.
  try {
    const { getExtension } = await import("./extensions/loader.js");
    setExtensionInstanceLookup(getExtension);
  } catch {
    // Loader unavailable (test rig, kernel-only boot, etc.).
    // getExtensionAtScope returns null in that environment and
    // callers fall back gracefully.
  }

  await runExtensionMigrations();

  // Hooks only need the blocked set. Restricted extensions still
  // fire hooks, just with limited tools.
  hooks.setScopeResolver(async (spaceId) => {
    const { blocked } = await getBlockedExtensionsAtSpace(spaceId);
    return blocked;
  });

  await startExtensionJobs();
  startUploadCleanup();
  startRetentionJob();

  const { startPlaceCheckJob } = await import("./seed/place/placeCheck.js");
  startPlaceCheckJob();

  // Gated by treeCircuitEnabled.
  const { startCircuitJob } =
    await import("./seed/place/space/spaceCircuit.js");
  startCircuitJob();

  const { cleanupExpiredResults } =
    await import("./seed/place/space/cascade.js");
  const cascadeCleanupMs =
    Number(getPlaceConfigValue("cascadeCleanupInterval")) || 6 * 60 * 60 * 1000;
  const cascadeCleanupTimer = setInterval(
    () => cleanupExpiredResults().catch(() => {}),
    cascadeCleanupMs,
  );
  cascadeCleanupTimer.unref();

  log.verbose(
    "Place",
    "Background jobs started (includes daily data retention)",
  );

  // I mirror my live registries into the .tools, .roles, and
  // .operations seed spaces. SEE on those addresses now reflects
  // the live registry through the standard descriptor pipeline.
  // Detached so a sync failure does not block boot. Errors are
  // logged inside the helpers.
  (async () => {
    try {
      const { syncToolsToSubstrate } =
        await import("./seed/cognition/tools.js");
      const { syncRolesToSubstrate } =
        await import("./seed/cognition/roles/registry.js");
      const { syncOperationsToSubstrate } =
        await import("./seed/ibp/operations.js");
      const [t, r, o] = await Promise.all([
        syncToolsToSubstrate(),
        syncRolesToSubstrate(),
        syncOperationsToSubstrate(),
      ]);
      log.info(
        "RegistryMirror",
        `synced: tools(${t.created}+${t.kept}-${t.removed}) ` +
          `roles(${r.created}+${r.kept}-${r.removed}) ` +
          `operations(${o.created}+${o.kept}-${o.removed})`,
      );
    } catch (err) {
      log.warn("RegistryMirror", `registry sync failed: ${err.message}`);
    }
  })();

  // Tool-description audit. Walks every registered role's declared
  // tools and logs misconfigurations loudly before the first LLM
  // call. The same gap would block a summon at runtime via
  // assertAllToolsResolve in buildPrompt.js. Surfacing it at boot
  // means the operator sees it without waiting for a user to
  // trigger the broken role.
  try {
    const { auditToolDescriptions } = await import("./seed/cognition/tools.js");
    await auditToolDescriptions();
  } catch (err) {
    log.warn("Tools", `tool-description audit failed: ${err.message}`);
  }

  hooks.run("afterBoot", {}).catch(() => {});
}

/**
 * Print the ready banner. Called by begin.js from inside the
 * server.listen callback, once both place (genesis) and heavens
 * (listen) are open.
 */
export function printReady() {
  const apiUrl = getPlaceUrl();

  const loaded = getLoadedExtensionNames();
  const hasHtml = loaded.includes("html-rendering");

  const boot = getBootReport();

  console.log("");
  console.log("  ════════════════════════════════════════════════════════════");
  log.info("Place", bootMode === "Beginning" ? "I am born." : "I am awake.");
  console.log("  ════════════════════════════════════════════════════════════");
  console.log("");
  log.info("Place", `API:  ${apiUrl}`);

  if (hasHtml) {
    log.info("Place", `Web:  ${apiUrl}`);
    log.info(
      "Place",
      `      Open in a browser to manage your place, trees, and extensions.`,
    );
    log.info(
      "Place",
      `      The CLI is more powerful but the web interface works for basics.`,
    );
  }

  console.log("");

  if (boot.skipped === 0) {
    log.info("Place", `Extensions: ${boot.loaded} loaded, all clear.`);
  } else {
    log.info(
      "Place",
      `Extensions: ${boot.loaded} loaded, ${boot.skipped} skipped.`,
    );
    log.warn("Place", `Skipped: ${boot.skippedNames.join(", ")}`);
  }

  if (hasHtml) {
    log.info(
      "Place",
      `Admin:  ${apiUrl}/place (manage extensions, config, users)`,
    );
  }

  console.log("");
  console.log("  ────────────────────────────────────────────────────────────");
  log.info("Place", "CLI quick start:");
  console.log("");
  console.log("  npm install -g treeos");
  console.log(`  treeos connect ${apiUrl}`);
  console.log("  treeos register");
  console.log("  treeos start");
  console.log("");
  console.log("  ────────────────────────────────────────────────────────────");
  console.log("");
}
