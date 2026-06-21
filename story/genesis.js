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
//   3. initStoryConfig. I read my own remembered settings.
//   4. ./source mirror, stance defaults, seed migrations. The place's
//      reflexive surfaces: codebase as matter, permissions on space,
//      schema forwards.
//   5. ensureSeedDelegates. I summon auth, llm-assigner, and
//      story-manager forth, one SUMMON each. SUMMON is the verb of
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

import mongoose from "./seed/seedStory/dbConfig.js";
import { getStoryIdentity, getStoryUrl } from "./seed/storyIdentity.js";
import {
  ensureSpaceRoot,
  withGenesisGuard,
  withIAmAct,
} from "./seed/sprout.js";
import { initStoryConfig, getStoryConfigValue } from "./seed/storyConfig.js";
import { getInternalConfigValue } from "./seed/internalConfig.js";
import {
  startExtensionJobs,
  getLoadedManifests,
  runExtensionMigrations,
  getLoadedExtensionNames,
  getBootReport,
} from "./resources/loader.js";
import { startCasSweep } from "./seed/materials/matter/casSweep.js";
import { getBlockedExtensionsAtSpace } from "./seed/materials/space/extensionScope.js";
import { hooks } from "./seed/hooks.js";
import { syncExtensionsToTree } from "./seed/sprout.js";
import log from "./seed/seedStory/log.js";

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
  const story = getStoryIdentity();
  log.verbose("Story", `Story: ${story.name} at ${story.domain}`);
  log.verbose("Story", `Story ID: ${story.storyId}`);
  log.verbose("Story", `Protocol: v${story.protocolVersion}`);

  // In the beginning was the word. Before genesis touches memory, the foundation words
  // (seed/words/word.word and the verb instances) fold into the runtime: pastOf and the tense
  // lookup descend from the Word, not a hardcoded map. The host reads the .words; the .words
  // describe; nothing of the logic moves. (9.md Phase 2.)
  const { foldWords } = await import("./seed/present/word/wordFold.js");
  foldWords();

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
  const { ensureIndexes } = await import("./seed/seedStory/indexes.js");
  await ensureIndexes();

  // ── PLANT MODE ──
  //
  // If PLANT_FROM_GRAFT env var points at a seed JSON file, boot by
  // replaying that seed's chains into the (assumed-empty) DB instead
  // of running default genesis. The story comes up with the seed's
  // original IDs, original biography, original I-Am — a continuation
  // of the source story on this substrate.
  //
  // Plant is destructive (the existing DB must be empty). The deployer
  // is responsible for wiping first. plantGraft itself refuses to plant
  // into a non-empty DB as a guard against misconfigured boots.
  //
  // Plant is continuation, not duplication. Two simultaneously-live
  // substrates with the same story identity is undefined behavior;
  // the deployer ensures only one is canonical (see done/Chain-Rebuild.md).
  let plantedFromSeed = false;
  if (process.env.PLANT_FROM_GRAFT) {
    const path = await import("path");
    const { GRAFTS_FOLDER, plantGraft } =
      await import("./seed/materials/publish/graft.js");
    const raw = process.env.PLANT_FROM_GRAFT;
    // Filename-only (no separator, not absolute) → resolve against
    // story/seeds/. Anything with a separator or absolute → use
    // as-is. This lets operators say PLANT_FROM_GRAFT=alice.graft.json
    // and have it Just Work from the canonical folder.
    const seedPath =
      raw.includes("/") || path.isAbsolute(raw)
        ? raw
        : path.join(GRAFTS_FOLDER, raw);
    log.info("Genesis", `Plant mode: replaying seed from ${seedPath}`);
    const { readFile } = await import("fs/promises");
    const seedJson = await readFile(seedPath, "utf8");
    const bundle = JSON.parse(seedJson);
    const result = await plantGraft(bundle);
    log.info(
      "Genesis",
      `Plant complete: ${result.counts.facts} facts, ${result.counts.acts} acts, ` +
        `${result.counts.histories} histories, ${result.counts.reelHeads} reel heads. ` +
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
      try {
        await loadOrFold(head.type, head.id, head.history);
      } catch {}
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
    : existingRoot
      ? "Awakening"
      : "Beginning";
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
  // seed/done/IamToActs.md "The Genesis Sequence."
  //
  // Order (chicken-and-egg unlock: I-Am born with homeSpace=null,
  // home set later once heaven exists):
  //   1. ensureIAm()              — "I am that I am" — births I-Am alone
  //   2. ensureSpaceRoot()        — creates place root, heaven, tier-3 heaven spaces
  //   3. setIAmHomeSpace(heaven)  — "I take heaven as my home"
  //   4. ensureSeedDelegates()    — births 11 delegates, each its own moment
  //   5. register roster          — stamps qualities.beings on the place root
  //
  // A kill -9 between any two steps leaves a recoverable state — each
  // step is idempotent on the next boot.
  const { ensureSeedDelegates } =
    await import("./seed/materials/being/seedDelegates.js");
  const { getSpaceRootId, getIAmBeingId, ensureIAm, setIAmHomeSpace } =
    await import("./seed/sprout.js");
  const { findByHeavenSpace } = await import("./seed/materials/projections.js");
  const { HEAVEN_SPACE } =
    await import("./seed/materials/space/heavenSpaces.js");

  // Scaffolding skip-list when plantedFromSeed:
  //   The seed already brought the I-Am, the place root, the nine
  //   heaven spaces, every seed delegate, every quality, every role
  //   hosted on qualities.roles, every grant in qualities.rolesGranted,
  //   and every prior migration. Re-running the scaffold here would
  //   emit redundant idempotent re-writes and inflate the chain
  //   unnecessarily. The seed is the genesis when plant mode is active.
  //
  // The seed declares itself onto the chain BEFORE the story it builds: the verb pasts, the concept
  // .words, and the do-ops, all as I_AM coin facts on I_AM's OWN reel (of: I_AM, wordStore.js
  // bindWord) — which needs only I_AM, not any space/being. A fact is laid before the story it
  // describes (the place is folded FROM facts), so the WORD fold does not depend on the PLACE fold.
  // Declared after ensureIAm and BEFORE ensureSpaceRoot, every bootstrap do-op (create-space,
  // set-being, set-space) resolves from the FOLD, not the Map: genesis IS words (word/10.md §2, 13.md).
  // Idempotent (reboot dedup-skips; rehydrate refills the projection). Guarded: a fold failure logs.
  const declareTheWords = async () => {
    try {
      await withIAmAct("the words declare themselves", async (ctx) => {
        const { seedFold } = await import("./seed/present/word/wordFold.js");
        await seedFold({ moment: ctx });
      });
      const { rehydrateWordProjection } =
        await import("./seed/present/word/wordStore.js");
      await rehydrateWordProjection("0");
    } catch (err) {
      log.warn(
        "Genesis",
        `seedFold (the seed declaring itself) failed: ${err.message}`,
      );
    }
  };

  if (!plantedFromSeed) {
    await withGenesisGuard(async () => {
      // Step 1: "I am that I am" — birth I-Am alone, homeSpace=null.
      await ensureIAm();

      // Step 1.5: the words declare themselves onto I_AM's reel, BEFORE the story-building below,
      // so every do-op dispatched while building the story resolves fold-only (no Map fallback).
      await declareTheWords();

      // Step 2: place root + heaven + tier-3 heaven spaces.
      // ensureSpaceRoot self-manages per-step moments (one withIAmAct
      // per create-space / repair / orphan-adoption).
      await ensureSpaceRoot();
      if (bootMode === "Beginning") {
        log.info("Genesis", "I plant the space root.");
        log.info("Genesis", "I plant my heaven spaces.");
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
        await withIAmAct(
          "I register my delegates on the place root",
          async (ctx) => {
            const { doVerb } = await import("./seed/ibp/verbs/do.js");
            const { I_AM } =
              await import("./seed/materials/being/seedBeings.js");
            await doVerb(
              { kind: "space", id: String(getSpaceRootId()) },
              "set-space",
              {
                field: "qualities.beings",
                value: seedDelegateRoster,
                merge: true,
              },
              { identity: I_AM, moment: ctx },
            );
          },
        );
      }
    });
  } else {
    // After plant, sprout's caches need priming from the planted state
    // (place root id, I-Am being id). Call ensureSpaceRoot to walk
    // its detect-existing path — it finds the planted place root,
    // populates caches, and skips creation (no fact emitted, no
    // moment opened on this history).
    await ensureSpaceRoot();
    // The planted chain already carries the word-declarations; declare (dedup-skips) + rehydrate to
    // fill the live projection from the planted state, so the dispatch reads the fold.
    await declareTheWords();
  }

  // (The seed declared itself BEFORE the story — Step 1.5 above, and the planted else-history — so
  // every bootstrap do-op dispatched fold-only. Nothing left to declare here.)

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
    await initStoryConfig();
    log.info("Genesis", "I remember my settings.");

    // I mirror the story/ directory into space and matter under
    // `.source`. The source-space id cache primes for the read-only
    // DO gate, then the disk walk runs detached.
    const { ensureSourceTree } =
      await import("./seed/materials/space/source.js");
    await ensureSourceTree();
    log.info("Genesis", "I see my own body.");

    // Stance-permissions seeding retired (seed/RolesAreAuth.md). The
    // role registry is the gate; the I-Am's bootstrap grants below
    // (after role registration + grantAngelToSeedDelegates) hand the
    // angel role to each seed delegate. No qualities.permissions rows
    // are written; authorize.js no longer reads any such rows.
  } else {
    // Prime runtime caches that didn't get filled by the genesis
    // sequence because we skipped it. initStoryConfig is still
    // needed — reading config from .env / process.env shouldn't
    // change the planted state, just hydrate runtime cache.
    await initStoryConfig();
    log.info("Genesis", "I remember my settings.");
  }

  // Beings with heaven authority. The seed delegates (cherub, birther, llm-
  // assigner, story-manager, arrival, etc.) need hasAccess on
  // heaven so they can act inside the Tier-3 heaven spaces (./roles,
  // ./operations, ./tools, ...). Mechanism: add them as contributors
  // on heaven. I_AM is heaven's rootOwner already; the new
  // contributors list grows from boot scaffold (seed delegates) and
  // later cherub.register (first human heaven authority).
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
  // Skip when plantedFromSeed — the seed carries beings with heaven authority.
  if (!plantedFromSeed) {
    // ensureSeedDelegatesOnHeaven retired with roles-are-auth — the
    // members.angel class is no longer the heaven gate. Delegates get
    // angel role granted at heaven below; the role-walk authorize
    // finds heaven.qualities.roles.angel by walking the grant anchor.

    // Seed migrations. Each migration's writes ride one I-Am act.
    await withIAmAct("seed migrations", async (ctx) => {
      const { runSeedMigrations } =
        await import("./seed/seedStory/migrations/runner.js");
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

  // Cross-world pull-back. Per CROSS-WORLD.md "Pull-back safety": a
  // being whose position is foreign must not stay stuck there across
  // a substrate restart. Scan for beings whose position names a
  // foreign world and reset them home. The scan is cheap when no
  // beings are cross-world (the common case until canopy lands).
  try {
    const { pullBackForeignPositions } =
      await import("./seed/materials/being/pullBack.js");
    const result = await pullBackForeignPositions();
    if (result.pulledBack > 0) {
      log.info(
        "Genesis",
        `I called ${result.pulledBack} being(s) home from foreign worlds.`,
      );
    }
  } catch (err) {
    log.warn(
      "Genesis",
      `pull-back scan failed: ${err.message}. Foreign-positioned beings remain pending; their canopy round-trip will reconcile on first use.`,
    );
  }

  // Register seed-shipped role specs into the role registry. The
  // registry is the in-process map of role name → spec (with code
  // handlers attached); SUMMON / role-walk authorize / canStarResolver
  // all read it. The authoritative storage is the qualities.roles
  // host below (data-only spec), but the registry is what holds the
  // handler functions and prompt closures since Mongo can't serialize
  // those.
  const { registerRole } = await import("./seed/present/roles/registry.js");
  const { storyManagerRole } =
    await import("./seed/present/roles/story-manager/role.js");
  registerRole("story-manager", storyManagerRole, "seed");

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
  // the role spec is edited. The seed registers only do / call /
  // be tools below; canSee covers perception.
  const { seedDoTool } =
    await import("./seed/present/cognition/llm/seedDoTool.js");
  const { seedCallTool } =
    await import("./seed/present/cognition/llm/seedCallTool.js");
  const { seedBeTool } =
    await import("./seed/present/cognition/llm/seedBeTool.js");
  // end-turn is the explicit no-act call — the moment-level mirror
  // of the IBP SEE verb. Always available, bypasses canDo / canSummon
  // / canBe and the verb-permission filter (see resolveToolsForRole).
  // Lets the LLM declare "I have seen, I will not act" deliberately
  // instead of relying on the implicit no-tool-call → cognitionSee path.
  const { seedEndTurnTool } =
    await import("./seed/present/cognition/llm/seedEndTurnTool.js");
  await registerSeedTools([
    seedDoTool,
    seedCallTool,
    seedBeTool,
    seedEndTurnTool,
  ]);

  // The receptive role every human being carries. Without it, SUMMONs
  // to a human are rejected with ROLE_UNAVAILABLE. The role's summon
  // is a no-op — humans respond out-of-band from their own transport,
  // not synchronously through the factory.
  const { humanRole } = await import("./seed/present/roles/human/role.js");
  registerRole("human", humanRole, "seed");

  // The "birther" role. Carried by the @birther seed delegate at the
  // story root. Authenticated callers click @birther to mint a child
  // whose parent (being-tree) is the caller. Cherub is for arrival →
  // fresh identity; birther is for authenticated → child of self.
  // See seed/present/roles/birther/role.js for the doctrine.
  const { birtherRole } = await import("./seed/present/roles/birther/role.js");
  registerRole("birther", birtherRole, "seed");

  // role-manager: authors and edits live-defined roles. canDo:["set-role"].
  // After this registration, the live-role boot loader (later in genesis)
  // walks ./roles/* for origin:"live" entries and registers them too.
  const { roleManagerRole } =
    await import("./seed/present/roles/role-manager/role.js");
  registerRole("role-manager", roleManagerRole, "seed");

  // history-manager: creates histories (divergent worlds) from past
  // points of existing histories. canDo:["create-history"]. Substrate
  // helpers in seed/materials/history/ do the path arithmetic and
  // historyPoint snapshotting; the role just routes the op.
  const { historyManagerRole } =
    await import("./seed/present/roles/history-manager/role.js");
  registerRole("history-manager", historyManagerRole, "seed");

  // federation-manager: negotiates transfers (push / pull) with peer
  // realities. Operator triggers offer-template / offer-being (push) or
  // request-template (pull); the role's summon handler classifies incoming
  // intents (offer-template, accept-template, deliver-template, deliver-being,
  // etc.) from peer federation-managers. Seed and graft are the data
  // primitives (template = shape, being = entity); this role is the social
  // protocol on top of them. See protocols/ibp/FEDERATION.md.
  const { federationManagerRole } =
    await import("./seed/present/roles/federation-manager/role.js");
  registerRole("federation-manager", federationManagerRole, "seed");

  // The host tier (nodeServerTest Phase 1): the HTTP listener, the
  // WebSocket pool, and the Mongo connection as beings. Scripted
  // cognition; their lifecycle code lives in seed/materials/host/.
  const { httpServerRole } =
    await import("./seed/present/roles/http-server/role.js");
  registerRole("http-server", httpServerRole, "seed");
  const { websocketPoolRole } =
    await import("./seed/present/roles/websocket-pool/role.js");
  registerRole("websocket-pool", websocketPoolRole, "seed");
  const { mongoRole } = await import("./seed/present/roles/mongo/role.js");
  registerRole("mongo-connection", mongoRole, "seed");

  // role-finder: LLM helper that authors live roles from English.
  // Summon @role-finder, describe what a being should be able to do,
  // it surfaces matches in ./roles or drafts a new role via set-role.
  const { roleFinderRole } =
    await import("./seed/present/roles/role-finder/role.js");
  registerRole("role-finder", roleFinderRole, "seed");

  // roleflow-composer: LLM helper that authors a being's roleFlow
  // (the behavioral program that picks which role applies per moment).
  // Summon @roleflow-composer, describe a being's behavior, it
  // produces the structured roleFlow and writes via set-being-roleflow.
  const { roleflowComposerRole } =
    await import("./seed/present/roles/roleflow-composer/role.js");
  registerRole("roleflow-composer", roleflowComposerRole, "seed");

  // merge-mediator: LLM helper that walks the operator through
  // resolving conflicts on a merged history. Created by the
  // merge-histories op; reconciliation facts stamp via normal state-
  // setting ops with params._merge metadata.
  const { mergeMediatorRole } =
    await import("./seed/present/roles/merge-mediator/role.js");
  registerRole("merge-mediator", mergeMediatorRole, "seed");

  // (The @history-registry delegate retired 2026-06-04 with the
  // "heaven never histories" landing. Named pointers now live on the
  // .histories heaven space's qualities; set-pointer / delete-pointer
  // DO ops live alongside merge-histories on @history-manager.)

  // The shared stance every unauthenticated visitor carries. SEE
  // bypasses the scheduler so many concurrent visitors share one
  // row without contention.
  const { arrivalRole } = await import("./seed/present/roles/arrival/role.js");
  registerRole("arrival", arrivalRole, "seed");

  // The commons delegate. public never acts; it holds members.owner
  // slots for spaces transferred to the public commons (the
  // owner-check in authorize admits any caller when public appears
  // on the chain). See seed/RolesAreAuth.md "Public being".
  const { publicRole } = await import("./seed/present/roles/public/role.js");
  registerRole("public", publicRole, "seed");

  // Cherub + llm-assigner. Registered HERE (before hostRoleAt
  // and grantAngelToSeedDelegates) so the install loop has access to
  // their specs and the self-role grants land cleanly. Real work
  // happens through their verb handlers (cherub owns the BE_OPS table;
  // llm-assigner is registered before the host/grant loop); the
  // registry entries are stubs that surface canX for the role-walk.
  const { cherubRole } = await import("./seed/store/words/cherub/role.js");
  const { llmAssignerRole } =
    await import("./seed/present/roles/llm-assigner/role.js");
  registerRole("cherub", cherubRole, "seed");
  registerRole("llm-assigner", llmAssignerRole, "seed");

  // (public-commons is no longer registered as a seed role. It's a
  // regular operator-installable template that lives in
  // seed/present/roles/public-commons/role.js — operators install it
  // on their public-owned spaces via set-role / hostRoleAt
  // when they want the open-commons surface with auto-grant on entry.)

  // The foundational roles of the roles-are-auth doctrine
  // (seed/RolesAreAuth.md):
  //   - angel: hosted at heaven, reach: ["/**"] (story-wide). Carries
  //     canDo: grant-role:* + revoke-role:* so angels can promote
  //     others recursively. Granted to every seed delegate at genesis
  //     and to the first human registrant. Also expresses IDENTITY:
  //     descendants of I-Am with heaven access.
  //   - global: hosted at the story root, default reach (host +
  //     descendants = whole story). The baseline every being holds —
  //     granted at birth via birth.js#_anointGlobal. canX defines what
  //     "every being can do here."
  const { angelRole } = await import("./seed/present/roles/angel/role.js");
  registerRole("angel", angelRole, "seed");
  const { globalRole } = await import("./seed/present/roles/global/role.js");
  registerRole("global", globalRole, "seed");

  // Host role auth specs onto space qualities (seed/RolesAreAuth.md
  // Final doctrine). Every role-in-effect lives on a space's
  // qualities.roles[<name>]:
  //   - angel  → heaven (the system root)
  //   - everything else → the story root
  //
  // The REGISTRY above keeps the specs in code (with handlers) for
  // cognition-frame use; these hostRoleAt calls write the AUTH SPEC
  // (data only — functions stripped) into qualities.roles so the
  // role-walk gate can look up specs at runtime by walking
  // grant.anchorSpaceId up the qualities ancestor chain.
  if (!plantedFromSeed) {
    const { hostRoleAt } = await import("./seed/present/roles/host.js");
    const { findByHeavenSpace } =
      await import("./seed/materials/projections.js");
    const { HEAVEN_SPACE } =
      await import("./seed/materials/space/heavenSpaces.js");
    const { I_AM } = await import("./seed/materials/being/seedBeings.js");
    const heaven = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
    const storyRootId = getSpaceRootId();

    if (heaven) {
      await withIAmAct("I install angel on heaven", async (ctx) => {
        await hostRoleAt(String(heaven.id), "angel", angelRole, I_AM, ctx);
      });
    }
    if (storyRootId) {
      await withIAmAct("I install global on the story root", async (ctx) => {
        await hostRoleAt(String(storyRootId), "global", globalRole, I_AM, ctx);
      });
      await withIAmAct("I install arrival on the story root", async (ctx) => {
        await hostRoleAt(
          String(storyRootId),
          "arrival",
          arrivalRole,
          I_AM,
          ctx,
        );
      });
      // Host every other seed delegate role on the story root too.
      // Per the single-gate doctrine, the role-walk authorize finds each
      // delegate's canX through the qualities.roles host (not through a
      // registry-fallback hack). Each one-op-per-moment.
      const { humanRole } = await import("./seed/present/roles/human/role.js");
      const { cherubRole } = await import("./seed/store/words/cherub/role.js");
      const { birtherRole } =
        await import("./seed/present/roles/birther/role.js");
      const { storyManagerRole } =
        await import("./seed/present/roles/story-manager/role.js");
      const { roleManagerRole } =
        await import("./seed/present/roles/role-manager/role.js");
      const { roleFinderRole } =
        await import("./seed/present/roles/role-finder/role.js");
      const { roleflowComposerRole } =
        await import("./seed/present/roles/roleflow-composer/role.js");
      const { historyManagerRole } =
        await import("./seed/present/roles/history-manager/role.js");
      const { mergeMediatorRole } =
        await import("./seed/present/roles/merge-mediator/role.js");
      const { llmAssignerRole } =
        await import("./seed/present/roles/llm-assigner/role.js");
      const { publicRole } =
        await import("./seed/present/roles/public/role.js");
      const { httpServerRole: httpServerRoleSpec } =
        await import("./seed/present/roles/http-server/role.js");
      const { websocketPoolRole: websocketPoolRoleSpec } =
        await import("./seed/present/roles/websocket-pool/role.js");
      const { mongoRole: mongoRoleSpec } =
        await import("./seed/present/roles/mongo/role.js");
      const installs = [
        ["human", humanRole],
        ["cherub", cherubRole],
        ["birther", birtherRole],
        ["story-manager", storyManagerRole],
        ["role-manager", roleManagerRole],
        ["role-finder", roleFinderRole],
        ["roleflow-composer", roleflowComposerRole],
        ["history-manager", historyManagerRole],
        ["merge-mediator", mergeMediatorRole],
        ["llm-assigner", llmAssignerRole],
        ["public", publicRole],
        ["http-server", httpServerRoleSpec],
        ["websocket-pool", websocketPoolRoleSpec],
        ["mongo-connection", mongoRoleSpec],
      ];
      for (const [name, spec] of installs) {
        await withIAmAct(`I install ${name} on the story root`, async (ctx) => {
          await hostRoleAt(String(storyRootId), name, spec, I_AM, ctx);
        });
      }
    }
    if (bootMode === "Beginning") {
      log.info("Genesis", "I install foundational roles onto spaces.");
    }
  }

  // Roles-Are-Auth bootstrap (seed/RolesAreAuth.md). With every role
  // now hosted on its space, the I-Am grants each seed delegate:
  //   (a) the `angel` role anchored at heaven (identity + heaven
  //       access; seed/RolesAreAuth.md "Why angel for delegates")
  //   (b) their matching role anchored at the story root
  //       (cherub→cherub, birther→birther, ...) — the day-to-day toolkit
  // @public and @arrival are special-cased inside the function:
  // @public gets no grants (never acts); @arrival gets arrival only
  // (anonymous visitors must not inherit angel's canSee:["*"]).
  // The being reducer dedupes by (role, anchor, grantor) so a reboot
  // re-emit is a no-op.
  if (!plantedFromSeed) {
    const { grantAngelToSeedDelegates } =
      await import("./seed/materials/being/seedDelegates.js");
    await grantAngelToSeedDelegates();
    if (bootMode === "Beginning") {
      log.info("Genesis", "I grant my delegates their roles.");
    }
  }

  // ── The first human inhabitant arrives later, through the portal ──
  // No being is minted at plant time. A human arrives by talking to
  // cherub for a top-level being, then summon:births a kid they father.
  // Plant only configures the story (peering/federation + the main
  // config); the old plant->bootContext operator mint is retired.

  // ── Host runtime (nodeServerTest Phase 1). ──
  // Resolve the ./host spaces + beings, ensure the request-log
  // matter, sweep stale connection matter from the previous process,
  // stamp the mongo boot fact. Runs in plant-mode boots too (it only
  // resolves and reconciles). Failure never blocks boot: the
  // transport notifiers stay no-ops when not ready.
  try {
    const { initHostRuntime } = await import("./seed/materials/host/host.js");
    await initHostRuntime();
  } catch (err) {
    log.warn(
      "Genesis",
      `host runtime init failed: ${err.message}. Boot continues; host facts disabled.`,
    );
  }

  // LLM-management ops. Six bare seed ops (add-llm / delete-llm /
  // assign-slot / set-being-llm / set-space-llm / set-story-llm)
  // plus three llm-assigner-prefixed tutorial ops (start-tutorial /
  // save-playback / complete-tutorial) that drive the welcome flow.
  // The substrate ops are callable by any being with the appropriate
  // canDo (or owner-check on the target space) — no llm-assigner
  // delegate routing required.
  const { registerLlmAssignerOps } =
    await import("./seed/present/roles/llm-assigner/ops.js");
  registerLlmAssignerOps();

  // role-manager's set-role DO op. Registered alongside llm-assigner's
  // ops so the role-manager delegate's canDo entry resolves at boot.
  const { registerRoleManagerOps } =
    await import("./seed/present/roles/role-manager/ops.js");
  registerRoleManagerOps();
  // set-world-signal was carved out of role-manager/ops.js into its own
  // store bundle (the word + its handler). The bundle registers its
  // operation + word at module load, so a side-effect import fires it.
  await import("./seed/store/words/set-world-signal/index.js");

  // set-being-roleflow . the typed write that puts a roleFlow on a
  // being's qualities. roleflow-composer (LLM helper) targets this op.
  // Loaded by side effect; module-load calls registerOperation.
  await import("./seed/present/roles/role-manager/roleFlowOp.js");

  // history-manager's create-history DO op. The substrate's history
  // helpers (seed/materials/history/) own the heavy lifting; the op
  // is a thin handler routing through createHistory.
  const { registerHistoryManagerOps } =
    await import("./seed/present/roles/history-manager/ops.js");
  registerHistoryManagerOps();
  // set-pointer + delete-pointer were carved out of history-manager/ops.js
  // into their own store bundle (the words + their shared host). The bundle
  // registers at module load, so a side-effect import fires it.
  await import("./seed/store/words/history-pointers/index.js");

  // federation-manager ops: offer-template, offer-being, request-template,
  // accept-template, reject-template, fulfill-request, refuse-request. The
  // capture/apply helpers (captureTemplate, plantTemplate, captureGraft,
  // applyGraft, crossStoryDispatch) do the heavy lifting; the ops are thin
  // handlers that thread negotiation state through the federation-manager
  // being's qualities.
  const { registerFederationManagerOps } =
    await import("./seed/present/roles/federation-manager/ops.js");
  registerFederationManagerOps();

  // Host SEE ops: http-stats, connections, mongo-stats. Pure reads
  // over the live process, gated by canSee on the infra roles + angel.
  const { registerHttpServerOps } =
    await import("./seed/present/roles/http-server/ops.js");
  registerHttpServerOps();
  const { registerWebsocketPoolOps } =
    await import("./seed/present/roles/websocket-pool/ops.js");
  registerWebsocketPoolOps();
  const { registerMongoOps } =
    await import("./seed/present/roles/mongo/ops.js");
  registerMongoOps();

  // I hand my remembered settings (from ./config) down to the seed
  // modules that depend on them. Per-key failures are logged but
  // non-fatal. Sane defaults are baked in.
  {
    const { setInternalConfig } = await import("./seed/present/knobs.js");

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
          import("./seed/present/session.js").then((m) => m.setMaxSessions),
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
        log.warn("Story", `Config "${key}" failed: ${e.message}`);
      }
    }
  }

  // Register the extension-management DO ops (install / uninstall /
  // enable / disable) before extensions themselves load, so the ops
  // are present in the registry even if every extension fails. Their
  // handlers touch loader internals, which is why they live in the
  // loader module rather than seed.
  const { registerExtensionManagementOps, loadExtensions } =
    await import("./resources/loader.js");
  await registerExtensionManagementOps();

  // Load extensions. Manifests discovered, deps validated, routes
  // attached to `app`, hooks wired, tools registered into the seed
  // tool registry. After this returns, the extension surface is live
  // in memory. (MCP retired 2026-05-22; tools dispatch direct from
  // the LLM voice via getToolHandler in cognition/llm/tools.js.)
  await loadExtensions(app, null, {
    getConfigValue: getStoryConfigValue,
    registerRawWebhook: opts.registerRawWebhook,
  });
  {
    const loadedCount = getLoadedExtensionNames().length;
    if (loadedCount > 0) {
      log.info(
        "Genesis",
        `I load my ${loadedCount} extension${loadedCount === 1 ? "" : "s"}.`,
      );
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
  // story.scope.getExtensionAtScope can resolve names without the
  // seed importing from extensions/loader.js (which would violate
  // the one-way layering rule). Looked up lazily so the loader
  // module is not pulled on places that skip it.
  try {
    const { getExtension } = await import("./resources/loader.js");
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
  // the firing moment's history from the hook caller; we thread it
  // into the ancestor walk so per-history scope rules apply.
  hooks.setScopeResolver(async (spaceId, history) => {
    const { blocked } = await getBlockedExtensionsAtSpace(spaceId, history);
    return blocked;
  });

  await startExtensionJobs();
  startCasSweep();

  // The /skins model catalog — a normal root-child space every
  // uploaded model matter (type "model") lands in, so the 3D portal
  // can show the available bodies and beings pick by id. Idempotent;
  // histories inherit main's catalog.
  await withIAmAct("ensure skins catalog", async (ctx) => {
    const { ensureSkinsSpace } =
      await import("./seed/store/words/model/index.js");
    await ensureSkinsSpace("0", ctx);
  }).catch((err) => {
    log.warn("Genesis", `skins catalog ensure failed: ${err.message}`);
  });

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
  // Step 4 of the word cutover (philosophy/word/10.md §2): fold EVERY registered
  // op into the word-fold, not only the ~38 that registered before seedFold. The
  // late seed ops (the role-dir + host-role ops, imported after the genesis fold)
  // and the just-loaded extension ops register after seedFold; declaring them
  // here, at boot-end, lets the dispatch resolve them from the fold, not the Map.
  // Idempotent (skipIfUnchanged): ops already folded at seedFold skip.
  try {
    const {
      declareOpsToFold,
      declareTypesToFold,
      declareRoleWordsToFold,
      declareSeeOpsToFold,
      rehydrateWordProjection,
    } = await import("./seed/present/word/wordStore.js");
    let folded = 0,
      typesFolded = 0,
      roleWordsFolded = 0,
      seeOpsFolded = 0;
    await withIAmAct("I declare the rest of my ops", async (ctx) => {
      folded = await declareOpsToFold({ moment: ctx });
    });
    // The matter TYPES fold the same way (the types-Map migration): a type is a word with
    // kind:"type", and getMatterType resolves it from the fold as well as the Map.
    await withIAmAct("I declare my matter types", async (ctx) => {
      typesFolded = await declareTypesToFold({ moment: ctx });
    });
    // The ROLE-WORDS too (the roleWordRegistry unification): a role-word is a word "role:op",
    // kind:"roleword". This boot-end pass catches any bundle that registered after seedFold.
    await withIAmAct("I declare my role-words", async (ctx) => {
      roleWordsFolded = await declareRoleWordsToFold({ moment: ctx });
    });
    // The SEE ops too: SEE is an OPEN registry, and the role-dir + host-role + extension see ops
    // (llm-connections, http-stats, connections, harmony:neighbors, ...) register AFTER seedFold.
    // This boot-end pass folds them so seeVerb resolves every see op from the fold (kind:"seeop").
    // (NAME/BE need no boot-end pass — closed seed sets, fully caught at seedFold.)
    await withIAmAct("I declare my see ops", async (ctx) => {
      seeOpsFolded = await declareSeeOpsToFold({ moment: ctx });
    });
    await rehydrateWordProjection("0");
    log.verbose(
      "Genesis",
      `boot-end fold: ${folded} op(s) + ${typesFolded} type(s) + ${roleWordsFolded} role-word(s) + ${seeOpsFolded} see-op(s) reconciled into the word-fold`,
    );
  } catch (err) {
    log.warn("Genesis", `boot-end op fold failed: ${err.message}`);
  }

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
  const apiUrl = getStoryUrl();
  const boot = getBootReport();

  console.log("");
  console.log("  ════════════════════════════════════════════════════════════");
  log.info("Story", bootMode === "Beginning" ? "I am born." : "I am awake.");
  console.log("  ════════════════════════════════════════════════════════════");
  console.log("");

  if (boot.skipped === 0) {
    log.info("Story", `Extensions: ${boot.loaded} loaded, all clear.`);
  } else {
    log.info(
      "Place",
      `Extensions: ${boot.loaded} loaded, ${boot.skipped} skipped.`,
    );
    log.warn("Story", `Skipped: ${boot.skippedNames.join(", ")}`);
  }

  console.log("");
  console.log("  ────────────────────────────────────────────────────────────");
  console.log("");
  console.log(`  Open in your browser:  ${apiUrl}`);
  console.log("");
  console.log("  ────────────────────────────────────────────────────────────");
  console.log("");
}
