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
//   1. The store opens. The append-only file store, the ground every
//      space, matter, being, and Fact sits on; its journal replays so a
//      torn write recovers before the first read.
//   2. ensureSpaceRoot. The place root, the heaven space ("." . the
//      I-Am's room), and the nine Tier-3 heaven spaces under heaven
//      (identity, config, peers, extensions, tools, ables, operations,
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
//   6. Able and operation registries, integrity check, seed config
//      handoff. The capability surface the place now exposes.
//   7. Extension load, MCP transport, scope wiring, and jobs. I open
//      the place to operator installed beings and the periodic acts
//      that keep the world tidy.
//   8. Registry mirrors into ./tools, ./ables, ./operations, afterBoot.
//      The world becomes introspectable under the same SEE protocol
//      as everything else. The place is now complete; begin opens
//      the heavens and printReady fires.
//
// Every step is idempotent. Re-runs reconcile against what already
// exists. Nothing is re-formed blindly.

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
} from "./shared/loader.js";
import { armCasSweep } from "./seed/materials/matter/casSweep.js";
import { getBlockedExtensionsAtSpace } from "./seed/materials/space/extensionScope.js";
import { hooks } from "./seed/hooks.js";
import { syncExtensionsToTree } from "./seed/sprout.js";
import log from "./seed/seedStory/log.js";

// Read the creation sequence (seed/store/genesis.word) and run it as the I — the same
// runWordToStore path cognition uses to run a being's spoken Word: one act = one moment on the
// I's reel. The host floor (this reader) resolves the world-anchors the Word references and binds
// them; the Word does the acts. The story becomes data the boot reads-and-runs, not code the boot
// IS. The verse (`I am "what?" I am`) stays the host turtle (ensureIAm) — the I cannot run a Word
// until it exists; everything after it lives in genesis.word, run here at boot-end.
//
// SLICE 1: the grants (the former grantAngelToSeedDelegates). The grant reducer dedupes by
// (able, anchor, grantor), so the run is idempotent across Awakenings. Gated to !plantedFromSeed
// by the caller (a planted seed already carries the grants; re-running would inflate the chain).
//
// Delegates ride BINDINGS, not `beings`: resolveTarget reads bindings for `on the being <name>`,
// but resolveValue only auto-resolves proper names via `beings` — so an able name that equals a
// delegate name (able "cherub") must stay a literal string, never resolve to a being id.
async function readAndRunGenesisWord() {
  const fs = await import("fs");
  const { fileURLToPath } = await import("url");
  const { parse } = await import("./seed/present/word/parser.js");
  const { runWordToStore } =
    await import("./seed/present/word/ableWordRegistry.js");
  const { findByName, findByHeavenSpace } =
    await import("./seed/materials/projections.js");
  const { HEAVEN_SPACE } =
    await import("./seed/materials/space/heavenSpaces.js");
  const { getSpaceRootId } = await import("./seed/sprout.js");
  const { I } = await import("./seed/materials/being/seedBeings.js");
  const { SEED_DELEGATES } =
    await import("./seed/materials/being/seedDelegates.js");

  const heaven = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
  const rootId = getSpaceRootId();
  if (!heaven || !rootId) {
    log.warn(
      "Genesis",
      "genesis.word skipped: heaven/root not yet materialized",
    );
    return;
  }
  const src = fs.readFileSync(
    fileURLToPath(new URL("./seed/store/genesis.word", import.meta.url)),
    "utf8",
  );
  const ir = parse(src);
  const bindings = { heaven: String(heaven.id), root: String(rootId) };
  for (const spec of SEED_DELEGATES) {
    const slot = await findByName("being", spec.name, "0");
    if (slot) bindings[spec.name] = String(slot.id);
  }
  // name:I is REQUIRED — authorize() short-circuits on identity.name === I; without it every
  // privileged grant hits the full able-walk and is denied (the I holds no granted ables).
  await runWordToStore(ir, {
    beingId: I,
    name: I,
    history: "0",
    position: String(heaven.id),
    bindings,
  });
}

// Boot mode, decided once per process. Read by printReady at the
// end so the closing line ("I am born." vs "I am awake.") matches
// what actually happened. "Beginning" if the file store held no place root
// when I arrived (no spaces, no matter, no beings yet); "Awakening"
// if it did. Rebirth is a special case of Awakening that the
// architecture supports (Fact reel + file store backup + federation peer
// remnants) but the code does not auto-detect; an operator who
// performs a restore knows which kind of waking they triggered.
let bootMode = null;

/**
 * Form the place. begin.js awaits this before opening any senses.
 * The unfolding completes fully before the world can reach in.
 *
 * @param {object} app — the HTTP app (protocols/transports/http/app.js)  Express app extensions can
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

  // Open the file store: ensure the store dir and replay the moment-
  // journal (crash recovery) before any read or write fires. This is the
  // ground every space, matter, being, and Fact sits on. There is no
  // index to build: the store's lookups are a fold of the reels,
  // maintained as the chain grows.
  const { connectDB } = await import("./seed/seedStory/dbConfig.js");
  await connectDB();
  log.info("Genesis", "Memory connected.");

  // ── PLANT MODE ──
  //
  // If PLANT_FROM_GRAFT env var points at a seed JSON file, boot by
  // replaying that seed's chains into the (assumed-empty) store instead
  // of running default genesis. The story comes up with the seed's
  // original IDs, original biography, original I-Am — a continuation
  // of the source story on this store.
  //
  // Plant is destructive (the existing store must be empty). The deployer
  // is responsible for wiping first. plantGraft itself refuses to plant
  // into a non-empty store as a guard against misconfigured boots.
  //
  // Plant is continuation, not duplication. Two simultaneously-live
  // stores with the same story identity is undefined behavior;
  // the deployer ensures only one is canonical (see done/Chain-Rebuild.md).
  let plantedFromSeed = false;
  if (process.env.PLANT_FROM_GRAFT) {
    const path = await import("path");
    const { GRAFTS_FOLDER, plantGraft } =
      await import("./seed/store/book/graft.js");
    const raw = process.env.PLANT_FROM_GRAFT;
    // Filename-only (no separator, not absolute) → resolve against the
    // grafts folder (GRAFTS_FOLDER). Anything with a separator or absolute
    // → use as-is. This lets operators say PLANT_FROM_GRAFT=alice.graft.json
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
    // Materialize projections by walking every reel head and folding.
    // The store's read paths use loadOrFold, but downstream scaffolding
    // (sprout's place-root cache, seed-delegate lookups) expects the
    // folded rows present. Without this pass, those would see an empty
    // world and try to recreate it on top of the planted facts.
    const { listReelHeads } = await import("./seed/past/fileStore.js");
    const { loadOrFold } = await import("./seed/materials/projections.js");
    const heads = listReelHeads();
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
  // Root-exists check off the file store (the deleted Space model): a parentless space IS the place
  // root, which findRoot("space") returns. Present → Awakening; absent → Beginning.
  const { findRoot } = await import("./seed/materials/projections.js");
  const existingRoot = (await findRoot("space", "0"))[0] || null;
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
  //   heaven spaces, every seed delegate, every quality, every able
  //   hosted on qualities.ables, every grant in qualities.ablesGranted,
  //   and every prior migration. Re-running the scaffold here would
  //   emit redundant idempotent re-writes and inflate the chain
  //   unnecessarily. The seed is the genesis when plant mode is active.
  //
  // The seed declares itself onto the chain BEFORE the story it builds: the verb pasts, the concept
  // .words, and the do-ops, all as I coin facts on I's OWN reel (of: I, wordStore.js
  // bindWord) — which needs only I, not any space/being. A fact is laid before the story it
  // describes (the place is folded FROM facts), so the WORD fold does not depend on the PLACE fold.
  // Declared after ensureIAm and BEFORE ensureSpaceRoot, every bootstrap do-op (create-space,
  // set-being, set-space) resolves from the FOLD, not the Map: genesis IS words (word/10.md §2, 13.md).
  // Idempotent (reboot dedup-skips; rehydrate refills the projection). Guarded: a fold failure logs.
  const declareTheWords = async () => {
    try {
      // One word = one moment = one fact (philosophy/word/623, plan Phase A): the seed
      // declares itself as a SEQUENCE of one-word moments, not all the vocabulary pooled
      // into one moment (a run-on the stamper now refuses). moment:null → each bindWord's
      // _inAct opens its OWN withIAmAct moment per coin. Same per-item-moment doctrine the
      // syncAbles/syncOperations passes at boot-end already follow.
      const { seedFold } = await import("./seed/present/word/wordFold.js");
      await seedFold({ moment: null });
      const { rehydrateWordProjection, getWordSync } =
        await import("./seed/present/word/wordStore.js");
      await rehydrateWordProjection("0");
      // 9.md Phase 5 / 17.md STEP 7: the descent symmetry guard. With the foundation folded, assert
      // kernel == word.word — every concept is in the fold, grounds on declared words, and its host
      // pointers resolve. SOFT during the transition (logs the axiom/theorem split + any gaps); flip
      // to { strict:true } once the foundation is clean to make a gap a boot error.
      const { assertDescentSymmetry } =
        await import("./seed/present/word/axioms.js");
      assertDescentSymmetry(getWordSync);
    } catch (err) {
      log.warn(
        "Genesis",
        `seedFold (the seed declaring itself) failed: ${err.message}`,
      );
    }
  };

  if (!plantedFromSeed) {
    await withGenesisGuard(async () => {
      // Step 1: "I am what? I am" — birth I-Am alone, homeSpace=null.
      await ensureIAm();

      // Step 1.5: the words declare themselves onto I's reel, BEFORE the story-building below,
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
            const { I } = await import("./seed/materials/being/seedBeings.js");
            await doVerb(
              { kind: "space", id: String(getSpaceRootId()) },
              "set-space",
              {
                field: "qualities.beings",
                value: seedDelegateRoster,
                merge: true,
              },
              { identity: I, moment: ctx },
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
    // Read settings out of ./config.
    await initStoryConfig();
    log.info("Genesis", "Settings loaded.");

    // I mirror my own source tree into space and matter under
    // `.source`. The source-space id cache primes for the read-only
    // DO gate, then the disk walk runs detached.
    const { ensureSourceTree } =
      await import("./seed/materials/space/source.js");
    await ensureSourceTree();
    log.info("Genesis", "Source tree mirrored.");

    // Stance-permissions seeding retired (seed/AblesAreAuth.md). The
    // able registry is the gate; the I-Am's bootstrap grants below
    // (after able registration + the genesis.word grants) hand the
    // angel able to each seed delegate. No qualities.permissions rows
    // are written; authorize.js no longer reads any such rows.
  } else {
    // Prime runtime caches that didn't get filled by the genesis
    // sequence because we skipped it. initStoryConfig is still
    // needed — reading config from .env / process.env shouldn't
    // change the planted state, just hydrate runtime cache.
    await initStoryConfig();
    log.info("Genesis", "Settings loaded.");
  }

  // Heaven authority for the seed delegates. Under ables-are-auth
  // (seed/AblesAreAuth.md), each delegate is granted the angel able
  // anchored at heaven (the grants below), and the able-walk authorize
  // finds heaven.qualities.ables.angel by walking the grant anchor. I am
  // heaven's rootOwner already. (This replaced an older contributors
  // roster on heaven; heaven now uses the same ownership every space does.)
  //
  // Skip when plantedFromSeed — the seed carries beings with heaven authority.
  if (!plantedFromSeed) {
    // Seed migrations. Each migration's writes ride one I-Am act.
    await withIAmAct("seed migrations", async (ctx) => {
      const { runSeedMigrations } =
        await import("./seed/seedStory/migrations/runner.js");
      const migrationsRan = await runSeedMigrations(ctx);
      if (migrationsRan) log.info("Genesis", "Migrations applied.");
    });
  }
  // Note: plantedFromSeed skips seed migrations because the seed's
  // schema version should match this store's. A future cross-version
  // plant would need to run migrations on the planted data; for now,
  // same-version seeds only.

  // Cross-world pull-back. Per CROSS-WORLD.md "Pull-back safety": a
  // being whose position is foreign must not stay stuck there across
  // a restart. Scan for beings whose position names a
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

  // Register seed-shipped able specs into the able registry. The
  // registry is the in-process map of able name → spec (with code
  // handlers attached); SUMMON / able-walk authorize / canStarResolver
  // all read it. The authoritative storage is the qualities.ables
  // host below (data-only spec), but the registry is what holds the
  // handler functions and prompt closures since the file store can't
  // serialize those.
  const { registerAble, getAble } = await import("./seed/present/ables/registry.js");

  // SEED ables are WORDS — getAble (registry.js) folds each from store/words/ables/<name>.word on
  // demand; there is no pre-load and no Map of them. able-manager + llm-assigner are grant-set words
  // (they never wake — no handler). federation-manager + cherub still carry a live summon handler
  // (federation classifies peer intents; cherub owns the BE gate), so their JS spec is registered
  // here for the handler; their grant-set is the word.
  const { foldWordAble } = await import("./seed/present/word/seedAbleFold.js");
  const { federationManagerHandler } =
    await import("./seed/store/words/federation-manager/able.js");
  registerAble("federation-manager",
    { ...foldWordAble("federation-manager"), label: "Federation Manager", call: federationManagerHandler },
    "seed");
  const { cherubAbleHandler } = await import("./seed/store/words/cherub/able.js");
  registerAble("cherub", { ...foldWordAble("cherub"), call: cherubAbleHandler }, "seed");

  // Host able auth specs onto space qualities (seed/AblesAreAuth.md
  // Final doctrine). Every able-in-effect lives on a space's
  // qualities.ables[<name>]:
  //   - angel  → heaven (the system root)
  //   - everything else → the story root
  //
  // The REGISTRY above keeps the specs in code (with handlers) for
  // cognition-frame use; these hostAbleAt calls write the AUTH SPEC
  // (data only — functions stripped) into qualities.ables so the
  // able-walk gate can look up specs at runtime by walking
  // grant.anchorSpaceId up the qualities ancestor chain.
  if (!plantedFromSeed) {
    const { hostAbleAt } = await import("./seed/present/ables/host.js");
    const { findByHeavenSpace } =
      await import("./seed/materials/projections.js");
    const { HEAVEN_SPACE } =
      await import("./seed/materials/space/heavenSpaces.js");
    const { I } = await import("./seed/materials/being/seedBeings.js");
    const heaven = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
    const storyRootId = getSpaceRootId();

    if (heaven) {
      await withIAmAct("I install angel on heaven", async (ctx) => {
        await hostAbleAt(String(heaven.id), "angel", getAble("angel"), I, ctx);
      });
    }
    if (storyRootId) {
      // Host every seed delegate able on the story root (the able-walk reads qualities.ables). The
      // spec comes from getAble — word-folded for the 14, JS for the 4 handler ables. One op/moment.
      const installNames = [
        "global", "arrival", "human", "cherub", "birther", "story-manager",
        "able-manager", "able-finder", "flow-composer", "history-manager",
        "merge-mediator", "llm-assigner", "public", "http-server", "websocket-pool",
      ];
      for (const name of installNames) {
        await withIAmAct(`I install ${name} on the story root`, async (ctx) => {
          await hostAbleAt(String(storyRootId), name, getAble(name), I, ctx);
        });
      }
    }
    if (bootMode === "Beginning") {
      log.info("Genesis", "I install foundational ables onto spaces.");
    }
  }

  // Ables-Are-Auth bootstrap (seed/AblesAreAuth.md). With every able
  // now hosted on its space, the I-Am grants each seed delegate:
  //   (a) the `angel` able anchored at heaven (identity + heaven
  //       access; seed/AblesAreAuth.md "Why angel for delegates")
  //   (b) their matching able anchored at the story root
  //       (cherub→cherub, birther→birther, ...) — the day-to-day toolkit
  // @public and @arrival are special-cased inside the function:
  // @public gets no grants (never acts); @arrival gets arrival only
  // (anonymous visitors must not inherit angel's canSee:["*"]).
  // The being reducer dedupes by (able, anchor, grantor) so a reboot
  // re-emit is a no-op.
  if (!plantedFromSeed) {
    // The grants are now the I's acts, read and run from genesis.word (the creation sequence)
    // rather than called as JS. Slice 1 of turning genesis into a .word — see readAndRunGenesisWord.
    await readAndRunGenesisWord();
    if (bootMode === "Beginning") {
      log.info("Genesis", "I grant my delegates their ables.");
    }
  }

  // ── The first human inhabitant arrives later, through the portal ──
  // No being is minted at plant time. A human arrives by talking to
  // cherub for a top-level being, then summon:births a kid they father.
  // Plant only configures the story (peering/federation + the main
  // config); the old plant->bootContext operator mint is retired.

  // ── Host runtime (nodeServerTest Phase 1). ──
  // Resolve the ./host spaces + beings, ensure the request-log
  // matter, sweep stale connection matter from the previous process.
  // Runs in plant-mode boots too (it only resolves and reconciles).
  // Failure never blocks boot: the transport notifiers stay no-ops
  // when not ready.
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
  // assign-slot / set-being-llm / set-space-llm / set-story-llm),
  // callable by any being with the appropriate canDo (or owner-check
  // on the target space) — no llm-assigner delegate routing required.
  const { registerLlmAssignerOps } =
    await import("./seed/store/words/llm-assigner/ops.js");
  registerLlmAssignerOps();

  // The per-being LLM client-cache fold-hook. The WORD-SOLE llm-connection ops
  // (add / assign-llm-slot / update / delete) dropped their old post-fact
  // clearBeingClientCache; this re-homes it as an afterReelArrival hook that clears the
  // client cache when a being's reel changes, so the next LLM call reads the fresh config.
  const { registerLlmCacheHook } =
    await import("./seed/present/cognition/llm/cacheHook.js");
  registerLlmCacheHook();

  // able-manager's set-able DO op. Registered alongside llm-assigner's
  // ops so the able-manager delegate's canDo entry resolves at boot.
  const { registerAbleManagerOps } =
    await import("./seed/store/words/able-manager/ops.js");
  registerAbleManagerOps();
  // set-world-signal was carved out of able-manager/ops.js into its own
  // store bundle (the word + its handler). The bundle registers its
  // operation + word at module load, so a side-effect import fires it.
  await import("./seed/store/words/set-world-signal/index.js");

  // set-owner / remove-owner . carved from materials/space/ops.js into their own store bundle
  // (set-owner.word + remove-owner.word + ownerHostEnv, both WORD-SOLE). The auth + per-space
  // lock + CAS stay in ownership.js, reached as `see` escapes. Side-effect import registers them.
  await import("./seed/store/words/owner/index.js");

  // set-being-flow . the typed write that puts a flow on a
  // being's qualities. flow-composer (LLM helper) targets this op.
  // Loaded by side effect; module-load calls registerOperation.
  await import("./seed/store/words/able-manager/flowOp.js");

  // history-manager's create-history DO op. The history helpers
  // (seed/materials/history/) own the heavy lifting; the op is a thin
  // handler routing through createBranch.
  const { registerHistoryManagerOps } =
    await import("./seed/store/words/history-manager/ops.js");
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
    await import("./seed/store/words/federation-manager/ops.js");
  registerFederationManagerOps();

  // Host SEE ops: http-stats, connections. Pure reads over the live
  // process, gated by canSee on the infra ables + angel.
  const { registerWebsocketPoolOps } =
    await import("./seed/store/words/websocket-pool/ops.js");
  registerWebsocketPoolOps();

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
    await import("./shared/loader.js");
  await registerExtensionManagementOps();

  // Load extensions. Manifests discovered, deps validated, routes
  // attached to `app`, hooks wired. After this returns, the extension
  // surface is live in memory. (No JSON tool registry — the cognition
  // speaks WORD, 14.md §4.5; extensions add ops to the DO registry.)
  await loadExtensions(app, null, {
    getConfigValue: getStoryConfigValue,
    registerRawWebhook: opts.registerRawWebhook,
  });
  {
    const loadedCount = getLoadedExtensionNames().length;
    if (loadedCount > 0) {
      log.info(
        "Genesis",
        `I load my ${loadedCount} book${loadedCount === 1 ? "" : "s"}.`,
      );
    }
  }

  // syncExtensionsToTree self-manages per-extension moments now —
  // one DO per extension, one moment each. No outer withIAmAct
  // wrapper (per the one-DO-per-moment doctrine).
  await syncExtensionsToTree(getLoadedManifests());

  // Load operator-authored live ables from ./ables. Runs after seed +
  // extension able registration (so live entries can override either
  // by name) and BEFORE syncAblesToSubstrate (so the round-trip
  // preserves them — manifestItems would otherwise delete entries
  // not in the registry).
  const { loadLiveAblesFromSubstrate } =
    await import("./seed/present/ables/registry.js");
  try {
    await loadLiveAblesFromSubstrate();
  } catch (err) {
    log.warn("Genesis", `live-able loader failed: ${err.message}`);
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
    const { getExtension } = await import("./shared/loader.js");
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
  armCasSweep();

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

  log.info("Genesis", "Background jobs started.");

  // I mirror my live registries into the ./tools, ./ables, and
  // ./operations heaven spaces. SEE on those addresses now reflects
  // the live registry through the standard descriptor pipeline.
  // Detached so a sync failure does not block boot. Errors are
  // logged inside the helpers.
  //
  // Step 4 of the word cutover (philosophy/word/10.md §2): fold EVERY registered
  // op into the word-fold, not only the ~38 that registered before seedFold. The
  // late seed ops (the able-dir + host-able ops, imported after the genesis fold)
  // and the just-loaded extension ops register after seedFold; declaring them
  // here, at boot-end, lets the dispatch resolve them from the fold, not the Map.
  // Idempotent (skipIfUnchanged): ops already folded at seedFold skip.
  try {
    const {
      declareOpsToFold,
      declareTypesToFold,
      declareAbleWordsToFold,
      declareSeeOpsToFold,
      rehydrateWordProjection,
    } = await import("./seed/present/word/wordStore.js");
    let folded = 0,
      typesFolded = 0,
      ableWordsFolded = 0,
      seeOpsFolded = 0;
    // One word = one moment = one fact (philosophy/word/623, plan Phase A): each declare
    // lays its coins as a SEQUENCE of one-word moments (moment:null → each bindWord opens
    // its own withIAmAct), not pooled into one moment (a run-on the stamper now refuses).
    // Same per-item-moment doctrine the syncAbles/syncOperations passes below already follow.
    //   ops → do.ref/word coins; types → kind:"type"; able-words → kind:"ableword"
    //   (catches bundles registered after seedFold); see ops → kind:"seeop" (OPEN registry).
    //   (NAME/BE need no boot-end pass — closed seed sets, fully caught at seedFold.)
    folded = await declareOpsToFold({ moment: null });
    typesFolded = await declareTypesToFold({ moment: null });
    ableWordsFolded = await declareAbleWordsToFold({ moment: null });
    seeOpsFolded = await declareSeeOpsToFold({ moment: null });
    await rehydrateWordProjection("0");
    log.verbose(
      "Genesis",
      `boot-end fold: ${folded} op(s) + ${typesFolded} type(s) + ${ableWordsFolded} able-word(s) + ${seeOpsFolded} see-op(s) reconciled into the word-fold`,
    );
  } catch (err) {
    log.warn("Genesis", `boot-end op fold failed: ${err.message}`);
  }

  // Two parallel sync calls, two I-Am moments — independent
  // reconciliations of independent registries. Each is the I-Am's
  // own act; running them as separate moments lets them progress in
  // parallel (Promise.all) without a shared deltaF.
  // (The JSON tool registry retired with the Word cutover — 14.md
  // §4.5 — so there is no tools sync.)
  (async () => {
    try {
      const { syncAblesToSubstrate } =
        await import("./seed/present/ables/registry.js");
      const { syncOperationsToSubstrate } =
        await import("./seed/ibp/operations.js");
      // Each sync function self-manages per-item moments now.
      // No outer withIAmAct wrappers — per the one-DO-per-moment
      // doctrine, each per-item create/refresh/delete is its own act.
      const [r, o] = await Promise.all([
        syncAblesToSubstrate(),
        syncOperationsToSubstrate(),
      ]);
      log.verbose(
        "RegistryMirror",
        `synced: ables(${r.created}+${r.kept}-${r.removed}) ` +
          `operations(${o.created}+${o.kept}-${o.removed})`,
      );
    } catch (err) {
      log.warn("RegistryMirror", `registry sync failed: ${err.message}`);
    }
  })();

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
    log.info("Story", `Books: ${boot.loaded} loaded, all clear.`);
  } else {
    log.info(
      "Place",
      `Books: ${boot.loaded} loaded, ${boot.skipped} skipped.`,
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
