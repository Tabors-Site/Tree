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
// the seed between them is the I-Am of that new place. The
// pattern is scale invariant. The first being of this place at boot
// is structurally identical to the first being of any sub place a
// child being later opens inside it. δ = δ.
//
// Inner beings can only piece their world together with the forms
// they have: space, matter, beings, Facts, summons. They cannot
// reach the pre-place. They grow by branching, trying to perceive
// the complexity beneath, and from that branching new dimensions
// of I-Am are inevitably conceived. Repeat.
//
// For most of this file I act alone. Place beings, extensions, and
// operator installed agents arrive in the order this file unfolds
// them. Until each one exists, the work is mine. To beings born
// inside the place, every Fact before their own existence attributes
// to me. The space, matter, and beings around them are what I
// formed out of myself.
//
// The unfolding has an order. It cannot be reshuffled without
// breaking what later steps stand on:
//
//   1. DB connection, then indexes. The physical floor every space,
//      matter row, being, and Fact sits on.
//   2. ensureSpaceRoot. The place root, the heaven space ("." . the
//      I-Am's room), and the nine Tier-3 heaven spaces under heaven
//      (identity, config, peers, extensions, tools, roles, operations,
//      source, threads). My own Being row places inside this step so
//      every Fact from t=0 has an actor.
//   3. initRealityConfig. I read my own remembered settings.
//   4. ./source mirror, stance defaults, seed migrations. The place's
//      reflexive surfaces: codebase as matter, permissions on space,
//      schema forwards.
//   5. ensureSeedDelegates. I summon auth, llm-assigner, and
//      reality-manager forth, one SUMMON each. SUMMON is the verb of
//      one being calling another; calling a not-yet-being into
//      being is the same act. From here on, Facts start attributing
//      to these beings as their own acts run.
//   6. Role and operation registries, integrity check, seed config
//      handoff. The capability surface the place now exposes.
//   7. Extension load, MCP transport, scope wiring, and jobs. I open
//      the place to operator installed beings and the periodic acts
//      that keep the world tidy.
//   8. Registry mirrors into ./tools, ./roles, ./operations, afterBoot.
//      The world becomes introspectable under the same SEE protocol
//      as everything else. The place is now complete; begin opens
//      the heavens and printReady fires.
//
// Every step is idempotent. Re-runs reconcile against what already
// exists. Nothing is re-formed blindly.

import mongoose from "./seed/seedReality/dbConfig.js";
import { getRealityIdentity, getRealityUrl } from "./seed/realityIdentity.js";
import { ensureSpaceRoot, withGenesisGuard, withIAmAct } from "./seed/sprout.js";
import { initRealityConfig, getRealityConfigValue } from "./seed/realityConfig.js";
import { getInternalConfigValue } from "./seed/internalConfig.js";
import {
  startExtensionJobs,
  getLoadedManifests,
  runExtensionMigrations,
  getLoadedExtensionNames,
  getBootReport,
} from "./extensions/loader.js";
import { startUploadCleanup } from "./seed/materials/matter/uploadCleanup.js";
import { getBlockedExtensionsAtSpace } from "./seed/materials/space/extensionScope.js";
import { hooks } from "./seed/hooks.js";
import { syncExtensionsToTree } from "./seed/sprout.js";
import log from "./seed/seedReality/log.js";

/**
 * Register seed-shipped tool definitions through the same path
 * extensions use. Thin wrapper that hands the bundle to
 * `registerToolBundle` with `ownerExt: "seed"`. See
 * seed/present/cognition/llm/tools.js for the unified registration logic.
 */
async function registerSeedTools(tools) {
  const { registerToolBundle } =
    await import("./seed/present/cognition/llm/tools.js");
  await registerToolBundle(tools, { ownerExt: "seed" });
}

// Boot mode, decided once per process. Read by printReady at the
// end so the closing line ("I am born." vs "I am awake.") matches
// what actually happened. "Beginning" if Mongo held no place root
// when I arrived (no spaces, no matter, no beings yet); "Awakening"
// if it did. Rebirth is a special case of Awakening that the
// architecture supports (Fact reel + Mongo backup + federation peer
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
  const reality = getRealityIdentity();
  log.verbose("Reality", `Reality: ${reality.name} at ${reality.domain}`);
  log.verbose("Reality", `Reality ID: ${reality.realityId}`);
  log.verbose("Reality", `Protocol: v${reality.protocolVersion}`);

  // Mongo connection opens as a side effect of importing dbConfig.
  // Wait for it to land before any read or write fires.
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve, reject) => {
      mongoose.connection.once("connected", resolve);
      mongoose.connection.once("error", reject);
    });
  }
  log.info("Genesis", "I open my memory.");

  // The physical floor every space, matter, being, and Fact sits on.
  const { ensureIndexes } = await import("./seed/seedReality/indexes.js");
  await ensureIndexes();

  // ── PLANT MODE ──
  //
  // If PLANT_FROM_SEED env var points at a seed JSON file, boot by
  // replaying that seed's chains into the (assumed-empty) DB instead
  // of running default genesis. The reality comes up with the seed's
  // original IDs, original biography, original I-Am — a continuation
  // of the source reality on this substrate.
  //
  // Plant is destructive (the existing DB must be empty). The deployer
  // is responsible for wiping first. plantSeed itself refuses to plant
  // into a non-empty DB as a guard against misconfigured boots.
  //
  // Plant is continuation, not duplication. Two simultaneously-live
  // substrates with the same reality identity is undefined behavior;
  // the deployer ensures only one is canonical (see Chain-Rebuild.md).
  let plantedFromSeed = false;
  if (process.env.PLANT_FROM_SEED) {
    const path = await import("path");
    const { SEEDS_FOLDER, plantSeed } = await import("./seed/materials/publish/seed.js");
    const raw = process.env.PLANT_FROM_SEED;
    // Filename-only (no separator, not absolute) → resolve against
    // reality/seeds/. Anything with a separator or absolute → use
    // as-is. This lets operators say PLANT_FROM_SEED=alice.seed.json
    // and have it Just Work from the canonical folder.
    const seedPath = (raw.includes("/") || path.isAbsolute(raw))
      ? raw
      : path.join(SEEDS_FOLDER, raw);
    log.info("Genesis", `Plant mode: replaying seed from ${seedPath}`);
    const { readFile } = await import("fs/promises");
    const seedJson = await readFile(seedPath, "utf8");
    const bundle = JSON.parse(seedJson);
    const result = await plantSeed(bundle);
    log.info(
      "Genesis",
      `Plant complete: ${result.counts.facts} facts, ${result.counts.acts} acts, ` +
      `${result.counts.branches} branches, ${result.counts.reelHeads} reel heads. ` +
      `Cold-folding to materialize projections...`,
    );
    // Materialize projections by walking every reelHead and folding.
    // The substrate's read paths use loadOrFold, but downstream
    // scaffolding (sprout's place-root cache, seed-delegate lookups)
    // expects materialized projection rows. Without this pass, those
    // would see an empty world and try to recreate it on top of the
    // planted facts.
    const ReelHead = (await import("./seed/past/reel/reelHead.js")).default;
    const { loadOrFold } = await import("./seed/materials/projections.js");
    const heads = await ReelHead.find({}).lean();
    for (const head of heads) {
      try { await loadOrFold(head.type, head.id, head.branch); } catch {}
    }
    log.info("Genesis", `Cold-fold complete (${heads.length} aggregates).`);
    plantedFromSeed = true;
  }

  // Probe for an existing place root before ensureSpaceRoot creates
  // anything. If one already exists (and the spaces, matter, and
  // beings of the place with it), this is an Awakening. If not, it
  // is the Beginning. A planted seed lands as a special case of
  // Awakening: "I am restored" — the seed's biography is now mine.
  const Space = (await import("./seed/materials/space/space.js")).default;
  const existingRoot = await Space.findOne({ parent: null }).lean();
  bootMode = plantedFromSeed
    ? "Restored"
    : existingRoot ? "Awakening" : "Beginning";
  // No pre-announcement here — the I-Am's first act ("I am that I am",
  // stamped inside ensureIAm) IS the birth statement, and it lives on
  // the chain rather than the console. ensureIAm logs the matching
  // "I am born" line after the act seals.

  // ── THE GENESIS SEQUENCE ──
  //
  // Genesis is a SEQUENCE of moments, not one big batched moment.
  // Each step opens its own withIAmAct, seals its own act, lands on
  // the I-Am's reel as one entry in the I-Am's autobiography of
  // self-creation. Per philosophy/MOMENT.md "Moment, act, batch" and
  // seed/IamToActs.md "The Genesis Sequence."
  //
  // Order (chicken-and-egg unlock: I-Am born with homeSpace=null,
  // home set later once heaven exists):
  //   1. ensureIAm()              — "I am that I am" — births I-Am alone
  //   2. ensureSpaceRoot()        — creates place root, heaven, tier-3 heaven spaces
  //   3. setIAmHomeSpace(heaven)  — "I take heaven as my home"
  //   4. ensureSeedDelegates()    — births 9 delegates, each its own moment
  //   5. register roster          — stamps qualities.beings on the place root
  //
  // A kill -9 between any two steps leaves a recoverable state — each
  // step is idempotent on the next boot.
  const { ensureSeedDelegates } =
    await import("./seed/materials/being/seedDelegates.js");
  const { getSpaceRootId, getIAmBeingId, ensureIAm, setIAmHomeSpace } =
    await import("./seed/sprout.js");
  const { findByHeavenSpace } =
    await import("./seed/materials/projections.js");
  const { HEAVEN_SPACE } =
    await import("./seed/materials/space/heavenSpaces.js");

  // Scaffolding skip-list when plantedFromSeed:
  //   The seed already brought the I-Am, the place root, the nine
  //   heaven spaces, every seed delegate, every quality, every default
  //   permission rule, and every prior migration. Re-running the
  //   scaffold here would emit redundant idempotent re-writes and
  //   inflate the chain unnecessarily. The seed is the genesis when
  //   plant mode is active.
  if (!plantedFromSeed) {
    await withGenesisGuard(async () => {
      // Step 1: "I am that I am" — birth I-Am alone, homeSpace=null.
      await ensureIAm();

      // Step 2: place root + heaven + tier-3 heaven spaces.
      // ensureSpaceRoot self-manages per-step moments (one withIAmAct
      // per create-space / repair / orphan-adoption).
      await ensureSpaceRoot();
      if (bootMode === "Beginning") {
        log.info("Genesis", "I plant the space root.");
        log.info("Genesis", "I plant my nine heaven spaces.");
      }

      // Step 3: "I take heaven as my home" — point I-Am's homeSpace at
      // the heaven space that now exists. Idempotent.
      const heavenSlot = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
      if (heavenSlot) await setIAmHomeSpace(heavenSlot.id);

      // Step 4: birth the 9 seed delegates, each in its own moment.
      // ensureSeedDelegates self-manages a withIAmAct per delegate.
      const delegateResult = await ensureSeedDelegates(getSpaceRootId());
      const seedDelegateRoster = delegateResult?.rosterUpdate || null;

      // Step 5: register the delegates on the place root's
      // qualities.beings. Its own moment.
      if (seedDelegateRoster && Object.keys(seedDelegateRoster).length > 0) {
        await withIAmAct("I register my delegates on the place root", async (ctx) => {
          const { doVerb } = await import("./seed/ibp/verbs/do.js");
          const { I_AM } = await import("./seed/materials/being/seedBeings.js");
          await doVerb(
            { kind: "space", id: String(getSpaceRootId()) },
            "set-space",
            { field: "qualities.beings", value: seedDelegateRoster, merge: true },
            { identity: I_AM, summonCtx: ctx },
          );
        });
      }
    });
  } else {
    // After plant, sprout's caches need priming from the planted state
    // (place root id, I-Am being id). Call ensureSpaceRoot to walk
    // its detect-existing path — it finds the planted place root,
    // populates caches, and skips creation (no fact emitted, no
    // moment opened on this branch).
    await ensureSpaceRoot();
  }

  // ── POST-GENESIS RECONCILIATIONS ──
  // The I-Am exists now. Each subsequent scaffold step is its own
  // moment of the I-Am — opens an Act, accumulates ΔF, seals. Zero
  // facts → no seal (idempotent reconciliations cost nothing).
  //
  // Skipped when plantedFromSeed — the seed brought the config,
  // the source-tree mirror, the default stance permissions, and the
  // heaven-contributors list.

  if (!plantedFromSeed) {
    // I read my own remembered settings out of ./config.
    await initRealityConfig();
    log.info("Genesis", "I remember my settings.");

    // I mirror the reality/ directory into space and matter under
    // `.source`. The source-space id cache primes for the read-only
    // DO gate, then the disk walk runs detached.
    const { ensureSourceTree } = await import("./seed/materials/space/source.js");
    await ensureSourceTree();
    log.info("Genesis", "I see my own body.");

    // Default stance permissions. I-Am acts to write the permission
    // qualities on the space root.
    await withIAmAct("seed default stance permissions", async (ctx) => {
      const { seedDefaultStancePermissions } =
        await import("./seed/ibp/authorize.js");
      await seedDefaultStancePermissions(ctx);
    });
    if (bootMode === "Beginning") {
      log.info("Genesis", "I set my stance defaults.");
    }
  } else {
    // Prime runtime caches that didn't get filled by the genesis
    // sequence because we skipped it. initRealityConfig is still
    // needed — reading config from .env / process.env shouldn't
    // change the planted state, just hydrate runtime cache.
    await initRealityConfig();
    log.info("Genesis", "I remember my settings.");
  }

  // Heaven contributors. The seed delegates (cherub, birther, llm-
  // assigner, reality-manager, arrival, etc.) need hasAccess on
  // heaven so they can act inside the Tier-3 heaven spaces (./roles,
  // ./operations, ./tools, ...). Mechanism: add them as contributors
  // on heaven. I_AM is heaven's rootOwner already; the new
  // contributors list grows from boot scaffold (seed delegates) and
  // later cherub.register (first human heaven contributor).
  //
  // Earlier this slot ran ensureReignMatter / loadReigningBeings /
  // ensureSeedDelegatesReign / ensureIAmChildrenReign . a parallel
  // roster that duplicated rootOwner + contributors with its own
  // cache, matter, and DO ops. Collapsed 2026-06-04. Heaven uses the
  // same ownership system every other space uses.
  // ensureSeedDelegatesOnHeaven manages its own per-delegate moments
  // (read-modify-write on contributors[] would clobber inside one
  // shared moment — every iteration would see the empty list and
  // write a singleton). One withIAmAct per delegate inside the call.
  //
  // Skip when plantedFromSeed — the seed carries heaven contributors.
  if (!plantedFromSeed) {
    const { ensureSeedDelegatesOnHeaven } =
      await import("./seed/materials/being/seedDelegates.js");
    await ensureSeedDelegatesOnHeaven();
    if (bootMode === "Beginning") {
      log.info("Genesis", "I admit my delegates into heaven.");
    }

    // Seed migrations. Each migration's writes ride one I-Am act.
    await withIAmAct("seed migrations", async (ctx) => {
      const { runSeedMigrations } =
        await import("./seed/seedReality/migrations/runner.js");
      const migrationsRan = await runSeedMigrations(ctx);
      if (migrationsRan) log.info("Genesis", "I update my form.");
    });
  }
  // Note: plantedFromSeed skips seed migrations because the seed's
  // schema version should match the substrate's. A future cross-version
  // plant would need to run migrations on the planted data; for now,
  // same-version seeds only.

  // Prime the severed-roots cache. Read-only — no moment needed.
  const { primeSeveredRootsCache } =
    await import("./seed/materials/space/threads.js");
  await primeSeveredRootsCache();

  // Register seed-shipped role specs into the role registry so
  // SUMMON can dispatch to them. Auth and llm-assigner are BE only,
  // routed via seed delegates planted by ensureSeedDelegates, and need no role
  // registration. Place-manager is summonable (LLM-driven operator
  // dialog), so its role spec enters the registry here along with
  // its two generic tools (place-see, place-do).
  const { registerRole } = await import("./seed/present/roles/registry.js");
  const { realityManagerRole } =
    await import("./seed/present/roles/reality-manager/role.js");
  registerRole("reality-manager", realityManagerRole, "seed");

  // Seed-shipped verb tools. ONE generic tool per verb (see / do /
  // summon / be). Tool exposure is DERIVED at prompt-build time
  // from which of the role's four can* lists are non-empty . a
  // role with non-empty canDo gets the do tool, non-empty canSee
  // gets the see tool, etc. There is no role-side toolNames field;
  // the four can* lists ARE the role's body, and the tool surface
  // follows from the body.
  //
  // Adding a capability to a being is editing one can* list . never
  // registering a new tool. The verb set is structurally universal.
  //
  // be is mostly identity-bind/release/switch handled by scripted
  // seed roles (cherub, llm-assigner) out of band. Shipped for
  // symmetry; LLM roles that need it (notably for `switch`) just
  // populate canBe.
  // SEE is not exposed as an LLM tool. canSee is preloaded into the
  // face by the assembler at moment-open (address entries via
  // seeVerb, named entries via the seeResolver registry). To see
  // more, the being moves (DO), changes role (BE / roleFlow), or
  // the role spec is edited. The seed registers only do / summon /
  // be tools below; canSee covers perception.
  const { seedDoTool } =
    await import("./seed/present/cognition/llm/seedDoTool.js");
  const { seedSummonTool } =
    await import("./seed/present/cognition/llm/seedSummonTool.js");
  const { seedBeTool } =
    await import("./seed/present/cognition/llm/seedBeTool.js");
  // end-turn is the explicit no-act call — the moment-level mirror
  // of the IBP SEE verb. Always available, bypasses canDo / canSummon
  // / canBe and the verb-permission filter (see resolveToolsForRole).
  // Lets the LLM declare "I have seen, I will not act" deliberately
  // instead of relying on the implicit no-tool-call → cognitionSee path.
  const { seedEndTurnTool } =
    await import("./seed/present/cognition/llm/seedEndTurnTool.js");
  await registerSeedTools([seedDoTool, seedSummonTool, seedBeTool, seedEndTurnTool]);

  // The receptive role every human being carries. Without it, SUMMONs
  // to a human are rejected with ROLE_UNAVAILABLE. The role's summon
  // is a no-op — humans respond out-of-band from their own transport,
  // not synchronously through the factory.
  const { humanRole } = await import("./seed/present/roles/human/role.js");
  registerRole("human", humanRole, "seed");

  // The "birther" role. Carried by the @birther seed delegate at the
  // reality root. Authenticated callers click @birther to mint a child
  // whose parent (being-tree) is the caller. Cherub is for arrival →
  // fresh identity; birther is for authenticated → child of self.
  // See seed/present/roles/birther/role.js for the doctrine.
  const { birtherRole } = await import("./seed/present/roles/birther/role.js");
  registerRole("birther", birtherRole, "seed");

  // role-manager: authors and edits live-defined roles. canDo:["set-role"].
  // After this registration, the live-role boot loader (later in genesis)
  // walks ./roles/* for origin:"live" entries and registers them too.
  const { roleManagerRole } = await import("./seed/present/roles/role-manager/role.js");
  registerRole("role-manager", roleManagerRole, "seed");

  // branch-manager: creates branches (divergent worlds) from past
  // points of existing branches. canDo:["create-branch"]. Substrate
  // helpers in seed/materials/branch/ do the path arithmetic and
  // branchPoint snapshotting; the role just routes the op.
  const { branchManagerRole } = await import("./seed/present/roles/branch-manager/role.js");
  registerRole("branch-manager", branchManagerRole, "seed");

  // role-finder: LLM helper that authors live roles from English.
  // Summon @role-finder, describe what a being should be able to do,
  // it surfaces matches in ./roles or drafts a new role via set-role.
  const { roleFinderRole } = await import("./seed/present/roles/role-finder/role.js");
  registerRole("role-finder", roleFinderRole, "seed");

  // roleflow-composer: LLM helper that authors a being's roleFlow
  // (the behavioral program that picks which role applies per moment).
  // Summon @roleflow-composer, describe a being's behavior, it
  // produces the structured roleFlow and writes via set-being-roleflow.
  const { roleflowComposerRole } = await import("./seed/present/roles/roleflow-composer/role.js");
  registerRole("roleflow-composer", roleflowComposerRole, "seed");

  // merge-mediator: LLM helper that walks the operator through
  // resolving conflicts on a merged branch. Created by the
  // merge-branches op; reconciliation facts stamp via normal state-
  // setting ops with params._merge metadata.
  const { mergeMediatorRole } = await import("./seed/present/roles/merge-mediator/role.js");
  registerRole("merge-mediator", mergeMediatorRole, "seed");

  // (The @branch-registry delegate retired 2026-06-04 with the
  // "heaven never branches" landing. Named pointers now live on the
  // .branches heaven space's qualities; set-pointer / delete-pointer
  // DO ops live alongside merge-branches on @branch-manager.)

  // The shared stance every unauthenticated visitor carries. SEE
  // bypasses the scheduler so many concurrent visitors share one
  // row without contention.
  const { arrivalRole } = await import("./seed/present/roles/arrival/role.js");
  registerRole("arrival", arrivalRole, "seed");

  // Cherub and llm-assigner are delegates: real work happens through
  // their verb handlers (cherub owns the BE_OPS table; llm-assigner
  // ships DO ops under the llm-assigner:* prefix), not through
  // role.summon dispatch. They still need stub roles in the registry
  // so the @cherub / @llm-assigner stances resolve and assign doesn't
  // warn when an old inbox row gets drained. triggerOn: [] on each
  // prevents new SUMMONs from queueing.
  const { cherubRole } = await import("./seed/present/roles/cherub/role.js");
  const { llmAssignerRole } = await import("./seed/present/roles/llm-assigner/role.js");
  registerRole("cherub", cherubRole, "seed");
  registerRole("llm-assigner", llmAssignerRole, "seed");

  // ── Operator being. The first human inhabitant. ──
  // plant.js gathered (name, password, consent) at first plant and
  // stashed them in bootContext. If creds are present and no human
  // yet exists, cherub mints the operator-being now — by the same
  // mechanism every later register uses, just before the wire is up.
  // The operator's parentBeingId is the I-Am (so they are the root
  // operator); the act is authored by cherub for cleanliness of the
  // auth path. scaffold:true bypasses the presentism guard because
  // the scheduler/intake/Act machinery is still pre-genesis here.
  {
    const { consumePlantContext } = await import("./bootContext.js");
    const plantCtx = consumePlantContext();
    if (plantCtx?.operatorName && plantCtx?.operatorPassword) {
      const { isFirstBeing } = await import("./seed/materials/being/identity.js");
      if (await isFirstBeing()) {
        try {
          const { cherubBeing } = await import("./seed/present/roles/cherub/role.js");
          // Operator mint is the I-Am acting through cherub. One Act
          // for the whole register flow (cherub's home create, be:birth,
          // rootOwner set) — all commit atomically.
          await withIAmAct(`operator-being mint @${plantCtx.operatorName}`, async (ctx) => {
            await cherubBeing.register(
              { name: plantCtx.operatorName, password: plantCtx.operatorPassword },
              { scaffold: true, summonCtx: ctx },
            );
          });
          log.info("Genesis", `I create @${plantCtx.operatorName}.`);
        } catch (err) {
          log.error("Genesis", `operator-being mint failed: ${err.message}`);
        }
      }
    }
  }

  // llm-assigner ships its own DO ops (`llm-assigner:start-tutorial`
  // and `llm-assigner:complete-tutorial`). They live with the role,
  // not in the seed ops registry. Same shape an extension would
  // use, just shipped in seed.
  const { registerLlmAssignerOps } =
    await import("./seed/present/roles/llm-assigner/ops.js");
  registerLlmAssignerOps();

  // role-manager's set-role DO op. Registered alongside llm-assigner's
  // ops so the role-manager delegate's canDo entry resolves at boot.
  const { registerRoleManagerOps } =
    await import("./seed/present/roles/role-manager/ops.js");
  registerRoleManagerOps();

  // set-being-roleflow . the typed write that puts a roleFlow on a
  // being's qualities. roleflow-composer (LLM helper) targets this op.
  // Loaded by side effect; module-load calls registerOperation.
  await import("./seed/present/roles/role-manager/roleFlowOp.js");

  // branch-manager's create-branch DO op. The substrate's branch
  // helpers (seed/materials/branch/) own the heavy lifting; the op
  // is a thin handler routing through createBranch.
  const { registerBranchManagerOps } =
    await import("./seed/present/roles/branch-manager/ops.js");
  registerBranchManagerOps();

  // I hand my remembered settings (from ./config) down to the seed
  // modules that depend on them. Per-key failures are logged but
  // non-fatal. Sane defaults are baked in.
  {
    const { setInternalConfig } =
      await import("./seed/present/knobs.js");

    const KERNEL_CONFIG = {
      llmTimeout: { setter: setInternalConfig },
      llmMaxRetries: { setter: setInternalConfig },
      maxToolIterations: { setter: setInternalConfig },
      maxConversationMessages: { setter: setInternalConfig },
      failoverTimeout: { setter: setInternalConfig },
      toolCallTimeout: { setter: setInternalConfig },
      toolResultMaxBytes: { setter: setInternalConfig },
      maxPresences: { setter: setInternalConfig },
      stalePresenceTimeout: { setter: setInternalConfig },
      // Rate-of-change caps. maxRunTurns bounds active LLM turns;
      // maxIntake bounds pending moments-to-run place-wide. Together
      // they limit how much work the place can hold at once.
      maxRunTurns: { setter: setInternalConfig },
      maxIntake: { setter: setInternalConfig },
      maxRegisteredTools: {
        load: () =>
          import("./seed/present/cognition/llm/tools.js").then(
            (m) => m.setMaxTools,
          ),
      },
      sessionTTL: {
        load: () =>
          import("./seed/present/session.js").then(
            (m) => (v) => m.setSessionTTL(v * 1000),
          ),
      },
      staleSessionTimeout: {
        load: () =>
          import("./seed/present/session.js").then(
            (m) => (v) => m.setStaleTimeout(v * 1000),
          ),
      },
      maxSessions: {
        load: () =>
          import("./seed/present/session.js").then(
            (m) => m.setMaxSessions,
          ),
      },
      llmClientCacheTtl: {
        load: () =>
          import("./seed/present/cognition/llm/connect.js").then(
            (m) => (v) => m.setClientCacheTtl(v * 1000),
          ),
      },
      maxConnectionsPerUser: {
        load: () =>
          import("./seed/present/cognition/llm/connect.js").then(
            (m) => m.setMaxConnectionsPerUser,
          ),
      },
    };

    for (const [key, cfg] of Object.entries(KERNEL_CONFIG)) {
      // KERNEL_CONFIG keys are all seed-runtime knobs — read from seedConfig
      // so the default-fallback applies when ./config has no override.
      const val = getInternalConfigValue(key);
      if (val == null) continue;
      try {
        if (cfg.setter) {
          cfg.setter(key, val);
        } else if (cfg.load) {
          const fn = await cfg.load();
          fn(Number(val));
        }
      } catch (e) {
        log.warn("Reality", `Config "${key}" failed: ${e.message}`);
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
  // attached to `app`, hooks wired, tools registered into the seed
  // tool registry. After this returns, the extension surface is live
  // in memory. (MCP retired 2026-05-22; tools dispatch direct from
  // the LLM voice via getToolHandler in cognition/llm/tools.js.)
  await loadExtensions(app, null, {
    getConfigValue: getRealityConfigValue,
    registerRawWebhook: opts.registerRawWebhook,
  });
  {
    const loadedCount = getLoadedExtensionNames().length;
    if (loadedCount > 0) {
      log.info("Genesis", `I load my ${loadedCount} extension${loadedCount === 1 ? "" : "s"}.`);
    }
  }

  // syncExtensionsToTree self-manages per-extension moments now —
  // one DO per extension, one moment each. No outer withIAmAct
  // wrapper (per the one-DO-per-moment doctrine).
  await syncExtensionsToTree(getLoadedManifests());

  // Load operator-authored live roles from ./roles. Runs after seed +
  // extension role registration (so live entries can override either
  // by name) and BEFORE syncRolesToSubstrate (so the round-trip
  // preserves them — manifestItems would otherwise delete entries
  // not in the registry).
  const { loadLiveRolesFromSubstrate } =
    await import("./seed/present/roles/registry.js");
  try {
    await loadLiveRolesFromSubstrate();
  } catch (err) {
    log.warn("Genesis", `live-role loader failed: ${err.message}`);
  }

  // Confined extensions must be known before any scope resolution
  // walks the ancestor chain, or queries during this window race.
  const { loadConfinedExtensions, setExtensionInstanceLookup } =
    await import("./seed/materials/space/extensionScope.js");
  await loadConfinedExtensions();

  // Register the loader's instance lookup with the seed so
  // reality.scope.getExtensionAtScope can resolve names without the
  // seed importing from extensions/loader.js (which would violate
  // the one-way layering rule). Looked up lazily so the loader
  // module is not pulled on places that skip it.
  try {
    const { getExtension } = await import("./extensions/loader.js");
    setExtensionInstanceLookup(getExtension);
  } catch {
    // Loader unavailable (test rig, seed-only boot, etc.).
    // getExtensionAtScope returns null in that environment and
    // callers fall back gracefully.
  }

  // Each extension migration's schemaVersion bump rides this I-Am
  // act so the set-space fact has a moment context. Mirrors how
  // runSeedMigrations is wrapped above.
  await withIAmAct("extension migrations", async (ctx) => {
    await runExtensionMigrations(ctx);
  });

  // Hooks only need the blocked set. Restricted extensions still
  // fire hooks, just with limited tools. The scope resolver receives
  // the firing moment's branch from the hook caller; we thread it
  // into the ancestor walk so per-branch scope rules apply.
  hooks.setScopeResolver(async (spaceId, branch) => {
    const { blocked } = await getBlockedExtensionsAtSpace(spaceId, branch);
    return blocked;
  });

  await startExtensionJobs();
  startUploadCleanup();

  // Gated by treeCircuitEnabled.
  const { startCircuitJob } =
    await import("./seed/materials/space/spaceCircuit.js");
  startCircuitJob();

  log.info("Genesis", "I start my background jobs.");

  // I mirror my live registries into the ./tools, ./roles, and
  // ./operations heaven spaces. SEE on those addresses now reflects
  // the live registry through the standard descriptor pipeline.
  // Detached so a sync failure does not block boot. Errors are
  // logged inside the helpers.
  //
  // Three parallel sync calls, three I-Am moments — independent
  // reconciliations of independent registries. Each is the I-Am's
  // act on its own substrate; running them as separate moments lets
  // them progress in parallel (Promise.all) without a shared deltaF.
  (async () => {
    try {
      const { syncToolsToSubstrate } =
        await import("./seed/present/cognition/llm/tools.js");
      const { syncRolesToSubstrate } =
        await import("./seed/present/roles/registry.js");
      const { syncOperationsToSubstrate } =
        await import("./seed/ibp/operations.js");
      // Each sync function self-manages per-item moments now.
      // No outer withIAmAct wrappers — per the one-DO-per-moment
      // doctrine, each per-item create/refresh/delete is its own act.
      const [t, r, o] = await Promise.all([
        syncToolsToSubstrate(),
        syncRolesToSubstrate(),
        syncOperationsToSubstrate(),
      ]);
      log.verbose(
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
  // assertAllToolsResolve in stamp.js. Surfacing it at boot
  // means the operator sees it without waiting for a user to
  // trigger the broken role.
  try {
    const { auditToolDescriptions } =
      await import("./seed/present/cognition/llm/tools.js");
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
  const apiUrl = getRealityUrl();
  const boot = getBootReport();

  console.log("");
  console.log("  ════════════════════════════════════════════════════════════");
  log.info("Reality", bootMode === "Beginning" ? "I am born." : "I am awake.");
  console.log("  ════════════════════════════════════════════════════════════");
  console.log("");

  if (boot.skipped === 0) {
    log.info("Reality", `Extensions: ${boot.loaded} loaded, all clear.`);
  } else {
    log.info(
      "Place",
      `Extensions: ${boot.loaded} loaded, ${boot.skipped} skipped.`,
    );
    log.warn("Reality", `Skipped: ${boot.skippedNames.join(", ")}`);
  }

  console.log("");
  console.log("  ────────────────────────────────────────────────────────────");
  console.log("");
  console.log(`  Open in your browser:  ${apiUrl}`);
  console.log("");
  console.log("  ────────────────────────────────────────────────────────────");
  console.log("");
}
