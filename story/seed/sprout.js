// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Genesis. The I-Am's autobiography of self-creation, told as a
// sequence of moments on its own reel:
//
//   1. "I am that I am"                        ensureIAm
//   2. "I create the place root"               ensureSpaceRoot
//   3. "I create the . heaven space"           ensureSpaceRoot
//   4..11. "I create the <tier-3> heaven space"  (one moment each)
//   12. "I take heaven as my home"             setIAmHomeSpace
//   13. "I stand at heaven"                    setIAmHomeSpace
//   14..22. "I birth @<delegate>"              ensureSeedDelegates (one moment per delegate)
//   23. "I register my delegates on the place root"   genesis.js (final scaffold step)
//
// One moment, one act, always (philosophy/MOMENT.md "Moment, act,
// batch"). Each step is its own withIAmAct and seals on its own.
// Partial-boot completion is a recoverable state — every step is
// idempotent or detectable on the next boot.
//
// THE CONTRACT — withGenesisGuard runs the sequence once per process.
//
//   The guard is a thin singleton; it opens no moment. Inside it,
//   genesis.js calls the steps in order, each via withIAmAct. The
//   chicken-and-egg of "the I-Am as actor for create-space facts
//   when its Being row doesn't yet exist" is resolved by ordering:
//   ensureIAm() runs first, its be:birth fact materializes the row,
//   then create-space facts attribute to the now-real I-Am.
//
// THE I-AM IS BORN WITH HOMESPACE = NULL.
//
//   Heaven doesn't exist when ensureIAm runs (it's created in step 3).
//   The substrate accepts null homeSpace on birth; setIAmHomeSpace
//   (step 12) points it at heaven once heaven materializes. This is
//   the "split birth from home" doctrine from seed/done/IamToActs.md.
//
// Idempotent. Beginning runs the full chain (~141 acts); Awakening on
// an unchanged story runs zero ops (every helper's "if (existing)
// return" short-circuits).

import log from "./seedStory/log.js";
import { randomUUID as uuidv4 } from "node:crypto";
import Space from "./materials/space/space.js";
import {
  findByHeavenSpace,
  loadProjection,
  findByParent as findByParentSlot,
  countByParent as countByParentSlot,
} from "./materials/projections.js";

// Sprout-local helper: find the space whose heavenSpace marker matches.
// Returns a row-shaped object with `_id` so downstream genesis code
// (which expects Space-row shape) keeps working without rewrites.
async function findRootForHeavenSpace(heavenSpaceKind) {
  const slot = await findByHeavenSpace(heavenSpaceKind, "0");
  if (!slot) return null;
  return { _id: slot.id, ...slot.state };
}
import { HEAVEN_SPACE } from "./materials/space/heavenSpaces.js";
import { I_AM } from "./materials/being/seedBeings.js";
import {
  createStoryHeavenSpace,
  assertValidSpaceSize,
} from "./materials/space/spaces.js";
import { emitFact } from "./past/fact/facts.js";
import { sealAct } from "./present/stamper/4-stamped.js";

let spaceRootCache = null;
let iAmBeingIdCache = null;

// ─────────────────────────────────────────────────────────────────────
// Boot — the genesis sequence
// ─────────────────────────────────────────────────────────────────────
//
// withBootMoment retired (Pass 5 of seed/done/IamToActs.md). Genesis is no
// longer a single multi-fact moment; it is a sequence of
// withIAmAct moments orchestrated by genesis.js. The "I am that
// I am" first act is now ensureIAm; the place root, heaven, tier-3
// heaven spaces, delegate births, and roster registration each
// open their own withIAmAct moment.
//
// A future cross-moment atomicity primitive (`withBatch`) belongs
// next to a real use case (federation pull, cross-reel transfer);
// per seed/done/IamToActs.md it's intentionally deferred.

let _genesisRan = false;

/**
 * Genesis singleton guard. Ensures genesis() runs once per substrate
 * process. Inside, the I-Am calls a sequence of withIAmAct moments
 * — birth, place root, heaven, tier-3 spaces, delegates, roster,
 * permissions.
 *
 * Use: `await withGenesisGuard(async () => { ...genesis sequence... })`.
 * Idempotent guard only — no moment opened by this wrapper itself.
 *
 * @param {() => Promise<void>} fn
 */
export async function withGenesisGuard(fn) {
  if (typeof fn !== "function") {
    throw new Error("withGenesisGuard: fn must be a function");
  }
  if (_genesisRan) {
    throw new Error(
      "withGenesisGuard: genesis already ran for this process. The I-Am is born once per substrate.",
    );
  }
  _genesisRan = true;
  await fn();
}

/**
 * The I-Am acts in a single moment.
 *
 * Opens one Act under through=to=I_AM, runs fn with a fresh
 * moment, seals one act with whatever facts fn emitted. One moment,
 * one act, always (philosophy/MOMENT.md). The genesis sequence is
 * one of these per step; scaffold reconciliations (manifest sync,
 * registry mirrors, default permissions, seed migrations) likewise
 * open one of these per logical operation.
 *
 * Use this when the I-Am is the structural actor of a piece of work
 * the substrate needs to record. If there's a real being available
 * (operator, cherub, a seed delegate), prefer THAT being's identity
 * with a real moment from its moment (or withBeingAct(beingId, ...)).
 *
 * Zero facts → the moment is a no-op; no Act row is written. Stable
 * reconciliations cost nothing.
 *
 * @param {string} sourceLabel
 * @param {(moment: { actId: string, deltaF: object[], afterSeal: Function[] }) => Promise<*>} fn
 * @returns {Promise<*>} fn's return value
 */
export async function withIAmAct(sourceLabel, fn) {
  if (typeof fn !== "function") {
    throw new Error("withIAmAct: fn must be a function");
  }
  // Open→seal under the per-(history, being) act-chain lock: the act's
  // identity chains off the head read here, so concurrent helpers on
  // the I-Am's chain (position persists, manifest writes, circuit
  // trips, delegate births) must serialize or the second seal forks
  // the chain. Reentrant per async context; see actChainLock.js.
  const { withActChainLock } = await import("./past/act/actChainLock.js");
  const { getStoryDomain } = await import("./ibp/address.js");
  const story = getStoryDomain();
  return withActChainLock(story, "0", I_AM, async () => {
    const now = new Date();

    // Content-addressed like every act (past/act/actHash.js): identity
    // = hash of the opening, chained to the I-Am's previous sealed act.
    const { computeActId, readActHead } = await import("./past/act/actHash.js");
    const opening = {
      through: I_AM,
      to: I_AM,
      ibpAddress: null,
      activeRole: null,
      inboxMessageId: null,
      inReplyTo: null,
      parentThread: null,
      startMessage: { content: sourceLabel || "I-Am acts.", source: "I-Am" },
      story,
      history: "0",
    };
    const p = await readActHead(story, "0", I_AM);
    const actId = computeActId(p, opening);
    const plannedAct = {
      _id: actId,
      p,
      // I_AM the being expresses I_AM the Name (its key is the story key).
      by: I_AM,
      through: I_AM,
      to: I_AM,
      ibpAddress: null,
      activeRole: null,
      inboxMessageId: null,
      inReplyTo: null,
      rootCorrelation: actId,
      parentThread: null,
      answers: null,
      receivedAt: now,
      stampedAt: now,
      startMessage: { content: sourceLabel || "I-Am acts.", source: "I-Am" },
      story,
      // I-Am scaffold acts on main.
      history: "0",
    };

    // I-Am scaffold acts on main. Explicit "0" — the "no silent
    // main-bias" invariant; history is always declared. actorAct
    // points to the Act being built; downstream consumers read
    // identity (story, history, through, _id) from there.
    const moment = { actId, deltaF: [], afterSeal: [], actorAct: plannedAct };
    const result = await fn(moment);

    if (moment.deltaF.length === 0) {
      return result;
    }

    const sealed = await sealAct(plannedAct, {
      content: `I-Am sealed: ${sourceLabel}.`,
      stopped: false,
      deltaF: moment.deltaF,
      afterSeal: moment.afterSeal,
      opCount: moment._opCount || 0,
    });
    if (!sealed) {
      throw new Error(
        `withIAmAct(${sourceLabel}): sealAct returned null — Act did not materialize`,
      );
    }
    return result;
  });
}

/**
 * Generalized form of withIAmAct: open a moment under ANY being and
 * seal it. Used when a non-I-Am being is the structural actor — e.g.,
 * the graft engine emitting one act per fact under the grafter's
 * identity, so the grafter's reel reads as "I did this, then this,
 * then this..." instead of one mega-moment with 40 facts in its ΔF.
 *
 * Doctrine: per [MOMENT.md], the stamper aims for one fact per act.
 * Batches that ride a single ΔF degrade fold throughput non-linearly
 * (40 qualities writes in one moment fold sequentially under append
 * lock; 40 small acts fold independently). The graft engine takes
 * this seriously.
 *
 * Zero facts → no-op, no Act row written.
 *
 * @param {string} beingId       actor being-id on the act
 * @param {string} sourceLabel   short human label for the act's startMessage
 * @param {string} history        REQUIRED. No silent main-bias.
 * @param {(moment) => Promise<*>} fn
 * @returns {Promise<*>} fn's return value
 */
export async function withBeingAct(beingId, sourceLabel, history, fn) {
  if (typeof beingId !== "string" || !beingId.length) {
    throw new Error("withBeingAct: beingId is required");
  }
  if (typeof history !== "string" || !history.length) {
    throw new Error('withBeingAct: history is required (pass "0" for main)');
  }
  if (typeof fn !== "function") {
    throw new Error("withBeingAct: fn must be a function");
  }
  // Same open→seal serialization as withIAmAct (see there). The
  // scheduler's moments are NOT under this lock — their cross-check
  // is the CAS'd head advance at seal.
  const { withActChainLock } = await import("./past/act/actChainLock.js");
  const { getStoryDomain } = await import("./ibp/address.js");
  const story = getStoryDomain();
  return withActChainLock(story, history, beingId, async () => {
    const now = new Date();

    // Content-addressed like every act (past/act/actHash.js).
    const { computeActId, readActHead } = await import("./past/act/actHash.js");
    const opening = {
      through: beingId,
      to: beingId,
      ibpAddress: null,
      activeRole: null,
      inboxMessageId: null,
      inReplyTo: null,
      parentThread: null,
      startMessage: { content: sourceLabel || "graft act", source: beingId },
      story,
      history: history,
    };
    // The actor NAME — the being expresses a trueName (the name whose key
    // signs). No fallback: a being with no trueName cannot act.
    const { loadOrFold } = await import("./materials/projections.js");
    const actorSlot = await loadOrFold("being", beingId, history);
    const nameId = actorSlot?.state?.trueName;
    if (!nameId) {
      throw new Error(
        `withBeingAct: being ${String(beingId).slice(0, 8)} has no trueName; ` +
          `cannot resolve the name that signs.`,
      );
    }
    const p = await readActHead(story, history, beingId);
    const actId = computeActId(p, opening);
    const plannedAct = {
      _id: actId,
      p,
      by: nameId,
      through: beingId,
      to: beingId,
      ibpAddress: null,
      activeRole: null,
      inboxMessageId: null,
      inReplyTo: null,
      rootCorrelation: actId,
      parentThread: null,
      answers: null,
      receivedAt: now,
      stampedAt: now,
      startMessage: { content: sourceLabel || "graft act", source: beingId },
      story,
      history: history,
    };

    const moment = { actId, deltaF: [], afterSeal: [], actorAct: plannedAct };
    const result = await fn(moment);

    if (moment.deltaF.length === 0) return result;

    const sealed = await sealAct(plannedAct, {
      content: `${sourceLabel}: sealed.`,
      stopped: false,
      deltaF: moment.deltaF,
      afterSeal: moment.afterSeal,
      opCount: moment._opCount || 0,
    });
    if (!sealed) {
      throw new Error(
        `withBeingAct(${sourceLabel}): sealAct returned null — Act did not materialize`,
      );
    }
    return result;
  });
}

/**
 * withNameAct — open + seal a 5D NAME-ACT: a Name acts in the library with NO being (5d.md — the
 * being stays home; only the name acts there). The act-chain keys by the NAME (not a being), on
 * history "0" (the library reel never forks — separated by KIND, not by a history marker). `by` is
 * the name itself (it IS the signer); `through` is null. The 4D peer of withBeingAct, with the body
 * dropped: by/through stay split (as the schema already has them), through goes home.
 *
 * @param {string} nameId       the acting Name (the signer + the chain key)
 * @param {string} sourceLabel  short human label for the act's startMessage
 * @param {(moment) => Promise<*>} fn
 * @returns {Promise<*>} fn's return value
 */
export async function withNameAct(nameId, sourceLabel, fn) {
  if (typeof nameId !== "string" || !nameId.length) {
    throw new Error("withNameAct: nameId is required");
  }
  if (typeof fn !== "function") {
    throw new Error("withNameAct: fn must be a function");
  }
  const { withActChainLock } = await import("./past/act/actChainLock.js");
  const { getStoryDomain } = await import("./ibp/address.js");
  const story = getStoryDomain();
  // Keyed by the NAME on the 5D marker history "5d" — runs parallel to that name's being-chains
  // (different key AND different history, so even the I_AM, whose name==being id, never collides).
  return withActChainLock(story, "5d", nameId, async () => {
    const now = new Date();
    const { computeActId, readActHead } = await import("./past/act/actHash.js");
    const opening = {
      through: null, // 5D: the being stays home
      to: null,
      ibpAddress: null,
      activeRole: null,
      inboxMessageId: null,
      inReplyTo: null,
      parentThread: null,
      startMessage: { content: sourceLabel || "name acts.", source: nameId },
      story,
      history: "5d",
    };
    const p = await readActHead(story, "5d", nameId);
    const actId = computeActId(p, opening);
    const plannedAct = {
      _id: actId,
      p,
      by: nameId,    // the Name IS the signer + the chain key
      through: null, // no body
      to: null,
      ibpAddress: null,
      activeRole: null,
      inboxMessageId: null,
      inReplyTo: null,
      rootCorrelation: actId,
      parentThread: null,
      answers: null,
      receivedAt: now,
      stampedAt: now,
      startMessage: { content: sourceLabel || "name acts.", source: nameId },
      story,
      history: "5d",
    };
    const moment = { actId, deltaF: [], afterSeal: [], actorAct: plannedAct };
    const result = await fn(moment);
    if (moment.deltaF.length === 0) return result;
    const sealed = await sealAct(plannedAct, {
      content: `${sourceLabel}: sealed.`,
      stopped: false,
      deltaF: moment.deltaF,
      afterSeal: moment.afterSeal,
      opCount: moment._opCount || 0,
    });
    if (!sealed) {
      throw new Error(`withNameAct(${sourceLabel}): sealAct returned null — Act did not materialize`);
    }
    return result;
  });
}

// `withBatch` is intentionally NOT defined here. Earlier sketches
// modeled a batch as "many ops folded into one moment with a label" —
// that violates the moment-act discipline. Per philosophy/MOMENT.md,
// a batch is a grouping of multiple moments (each still one act) that
// share a Mongo transaction for cross-moment atomicity. Building that
// requires session-threading through every child sealAct call; it
// lands when a real use case appears (federation pull, cross-reel
// transfer). Until then, the verbs themselves seal one act per call
// and the wrappers (withIAmAct / withBeingAct) each carry one op.

// The heaven space. Named "." . sits directly under the space root
// and parents every Tier-3 heaven space below. The I-Am's home.
// Beings of the land lacking heaven stance see the door but cannot
// enter; the place root stays uncluttered by the I-Am's working
// memory rooms.
const STORY_HEAVEN_SPACE = {
  name: ".",
  heavenSpace: HEAVEN_SPACE.HEAVEN,
};

// NOTE: identity / peers / library / config are NOT planted as heaven spaces anymore — they were
// "facts dumped on a space reel." Story/name-level data lives on the ONE 5D library reel now
// (of:{kind:"library"}, name-signed, out of any history): config = config-set/config-delete facts
// (storyConfig.js), books = share-book facts, peers = peer-add/remove facts. identity's domain is
// read from process.env.STORY_DOMAIN (the space's quality had zero readers). The defaults that the
// old ./config space pre-seeded (STORY_NAME, storyUrl) are covered by CONFIG_DEFAULTS + the env
// fallback in getStoryConfigValue — no genesis seed needed. The KEEP-list (extensions/tools/roles/
// operations/source/threads/histories/host/factory) are registry-mirrors / structural containers,
// not data storage.
const STORY_HEAVEN_SPACES = [
  { name: "extensions", heavenSpace: HEAVEN_SPACE.EXTENSIONS },
  { name: "tools", heavenSpace: HEAVEN_SPACE.TOOLS },
  { name: "roles", heavenSpace: HEAVEN_SPACE.ROLES },
  { name: "operations", heavenSpace: HEAVEN_SPACE.OPERATIONS },
  // source mirrors story/. Populated by seed/materials/space/
  // source.js (the disk-fold populator) at boot. After MIRROR.md
  // step 2 the chain is the truth: the FUSE mount (scripts/
  // mirror-mount.mjs) renders source matter onto disk and bridges
  // FUSE writes back into the verb path as sealed acts.
  { name: "source", heavenSpace: HEAVEN_SPACE.SOURCE },
  // threads is a derived projection. Live rootCorrelation chains
  // surface as synthetic children at `<story>/./threads/<id>`; the
  // descriptor is computed on demand from inbox + Act records.
  // SUMMON to a thread address is a cut. See seed/materials/space/threads.js.
  { name: "threads", heavenSpace: HEAVEN_SPACE.THREADS },
  // histories mirrors the history collection — each child names a
  // divergent world by path. Pass 3 adds the create-history op that
  // plants child rows here; Pass 2 ships the container space so the
  // SEE surface and child-discovery paths work the moment branches
  // start landing. See seed/materials/history/.
  { name: "histories", heavenSpace: HEAVEN_SPACE.HISTORIES },
  // host is the running machine, represented. Its children (below,
  // NOT in this list — the tier-3 repair loop would re-parent them
  // under heaven) hold the HTTP listener, WebSocket pool, and Mongo
  // connection as beings + matter. See seed/materials/host/.
  { name: "host", heavenSpace: HEAVEN_SPACE.HOST },
  // factory is the stamping machinery, watched: read-side
  // projections over Act + Fact rows (children below, same NOT-in-
  // this-list rule). present = stampers, past = reels. See
  // seed/materials/space/factory.js.
  { name: "factory", heavenSpace: HEAVEN_SPACE.FACTORY },
];

// Children of ./host. Created/repaired by their own block in
// ensureSpaceRoot, parented under the host space rather than heaven.
const HOST_CHILD_SPACES = [
  { name: "http", heavenSpace: HEAVEN_SPACE.HOST_HTTP, size: { x: 8, y: 8 } },
  {
    name: "websocket",
    heavenSpace: HEAVEN_SPACE.HOST_WEBSOCKET,
    size: { x: 8, y: 8 },
  },
  { name: "mongo", heavenSpace: HEAVEN_SPACE.HOST_MONGO, size: { x: 8, y: 8 } },
];

// Children of ./factory. Same create/repair shape as the host block.
// Both are sized rooms: the grid render needs a size for occupants'
// coords to mean anything.
const FACTORY_CHILD_SPACES = [
  {
    name: "present",
    heavenSpace: HEAVEN_SPACE.FACTORY_PRESENT,
    size: { x: 12, y: 12 },
  },
  {
    name: "past",
    heavenSpace: HEAVEN_SPACE.FACTORY_PAST,
    size: { x: 12, y: 12 },
  },
];

export async function ensureSpaceRoot() {
  // Pass 3 of seed/done/IamToActs.md: each step opens its own withIAmAct moment.
  // No `moment` parameter — the function orchestrates a sequence
  // and each emit/doVerb rides its own act on the I-Am's reel.
  let spaceRoot = await findRootForHeavenSpace(HEAVEN_SPACE.SPACE_ROOT);

  if (!spaceRoot) {
    const storyName = process.env.STORY_NAME || "My Place";
    const rootId = uuidv4();
    // "I create the place root" — its own moment on the I-Am's reel.
    await withIAmAct("I create the place root", async (ctx) => {
      await emitFact(
        {
          verb: "do",
          act: "create-space",
          through: I_AM,
          of: { kind: "space", id: rootId },
          params: {
            name: storyName,
            type: null,
            parent: null,
            // The I-Am is the structural owner of the story.
            owner: I_AM,
            heavenSpace: HEAVEN_SPACE.SPACE_ROOT,
            size: assertValidSpaceSize(null, { applyDefault: true }),
            qualities: {},
          },
          actId: ctx.actId,
          history: "0",
        },
        ctx,
      );
    });
    spaceRoot = { _id: rootId };
    log.verbose("Story", `Created place root: ${rootId.slice(0, 8)}`);
  }

  // Heaven — the "." space under the place root. Each step is its own
  // moment via createStoryHeavenSpace's per-call withIAmAct.
  let heavenSpace = await findRootForHeavenSpace(HEAVEN_SPACE.HEAVEN);
  if (!heavenSpace) {
    try {
      heavenSpace = await createStoryHeavenSpace({
        name: STORY_HEAVEN_SPACE.name,
        parentId: spaceRoot._id,
        heavenSpace: STORY_HEAVEN_SPACE.heavenSpace,
        qualities: null,
        // No moment — createStoryHeavenSpace opens its own.
      });
      log.verbose("Story", `Created heaven space: ${STORY_HEAVEN_SPACE.name}`);
    } catch (err) {
      log.error(
        "Place",
        `Failed to create heaven space ${STORY_HEAVEN_SPACE.name}: ${err.message}. Boot continues.`,
      );
    }
  } else if (
    heavenSpace.parent &&
    heavenSpace.parent.toString() !== spaceRoot._id.toString()
  ) {
    log.warn("Place", `Heaven space has wrong parent. Repairing.`);
    const { doVerb } = await import("./ibp/verbs/do.js");
    await withIAmAct("I repair heaven's parent", async (ctx) => {
      await doVerb(
        { kind: "space", id: String(heavenSpace._id) },
        "set-space",
        { field: "parent", value: String(spaceRoot._id) },
        { identity: I_AM, moment: ctx },
      );
    });
  }

  // Heaven is the parent of every Tier-3 heaven space. Fall back to
  // spaceRoot only if heaven failed to plant above (degraded boot);
  // the repair pass on next boot adopts these spaces back under
  // heaven once it materializes.
  const heavenSpaceParentId = heavenSpace ? heavenSpace._id : spaceRoot._id;

  for (const def of STORY_HEAVEN_SPACES) {
    let space = await findRootForHeavenSpace(def.heavenSpace);

    if (!space) {
      try {
        space = await createStoryHeavenSpace({
          name: def.name,
          parentId: heavenSpaceParentId,
          heavenSpace: def.heavenSpace,
          qualities: def.buildQualities ? def.buildQualities() : null,
          // No moment — own moment.
        });
        log.verbose("Story", `Created heaven space: ${def.name}`);
      } catch (err) {
        log.error(
          "Place",
          `Failed to create heaven space ${def.name}: ${err.message}. Boot continues.`,
        );
        continue;
      }
    }

    // Repair: a Tier-3 heaven space found at the wrong parent (manual
    // DB edit, corruption, or migration from an older layout where
    // they parented directly under the place root) gets moved back
    // under heaven. Each repair is its own moment.
    if (
      space.parent &&
      !space._pending &&
      space.parent.toString() !== heavenSpaceParentId.toString()
    ) {
      log.warn("Place", `Seed space ${def.name} has wrong parent. Repairing.`);
      const { doVerb } = await import("./ibp/verbs/do.js");
      await withIAmAct(`I repair ${def.name}'s parent`, async (ctx) => {
        await doVerb(
          { kind: "space", id: String(space._id) },
          "set-space",
          { field: "parent", value: String(heavenSpaceParentId) },
          { identity: I_AM, moment: ctx },
        );
      });
    }
  }

  // Heaven-region children: http/websocket/mongo under ./host,
  // present/past under ./factory. Same create/repair shape as the
  // tier-3 loop, but parented under their region space. Skipped when
  // the region failed to plant (degraded boot); next boot heals.
  const REGION_CHILDREN = [
    { region: HEAVEN_SPACE.HOST, label: "host", defs: HOST_CHILD_SPACES },
    {
      region: HEAVEN_SPACE.FACTORY,
      label: "factory",
      defs: FACTORY_CHILD_SPACES,
    },
  ];
  for (const { region, label, defs } of REGION_CHILDREN) {
    const regionSlot = await findRootForHeavenSpace(region);
    if (!regionSlot) continue;
    for (const def of defs) {
      let space = await findRootForHeavenSpace(def.heavenSpace);
      if (!space) {
        try {
          space = await createStoryHeavenSpace({
            name: def.name,
            parentId: regionSlot._id,
            heavenSpace: def.heavenSpace,
            qualities: null,
            size: def.size || null,
            // No moment — own moment.
          });
          log.verbose("Story", `Created ${label} space: ${def.name}`);
        } catch (err) {
          log.error(
            "Place",
            `Failed to create ${label} space ${def.name}: ${err.message}. Boot continues.`,
          );
          continue;
        }
      }
      if (
        space.parent &&
        !space._pending &&
        space.parent.toString() !== regionSlot._id.toString()
      ) {
        log.warn(
          "Place",
          `${label} space ${def.name} has wrong parent. Repairing.`,
        );
        const { doVerb } = await import("./ibp/verbs/do.js");
        await withIAmAct(
          `I repair ${label}/${def.name}'s parent`,
          async (ctx) => {
            await doVerb(
              { kind: "space", id: String(space._id) },
              "set-space",
              { field: "parent", value: String(regionSlot._id) },
              { identity: I_AM, moment: ctx },
            );
          },
        );
      }
      // Size drift-repair: an already-planted sizeless room whose
      // definition now carries a size gets one (boot repair — the
      // grid render and occupant coords need it).
      if (def.size && !space._pending) {
        const live = await loadProjection("space", String(space._id), "0");
        const hasSize = live?.state?.size?.x > 0 && live?.state?.size?.y > 0;
        if (live && !hasSize) {
          const { doVerb } = await import("./ibp/verbs/do.js");
          await withIAmAct(`I size ${label}/${def.name}`, async (ctx) => {
            await doVerb(
              { kind: "space", id: String(space._id) },
              "set-space",
              { field: "size", value: def.size },
              { identity: I_AM, moment: ctx },
            );
          });
        }
      }
    }
  }

  // Adopt orphan tree roots (owner is not me, parent is null). These
  // exist when a tree was created before the space root, or when a
  // prior boot crashed mid-creation. Each adoption is its own moment.
  try {
    const { findRoot } = await import("./materials/projections.js");
    const { getSpaceOwner } = await import("./materials/space/members.js");
    const allRoots = await findRoot("space", "0");
    const orphanRoots = [];
    for (const r of allRoots) {
      const slot = await loadProjection("space", r.id, "0");
      const ownerId = getSpaceOwner(slot?.state) || null;
      if (ownerId != null && ownerId !== I_AM) orphanRoots.push({ _id: r.id });
    }
    const { doVerb } = await import("./ibp/verbs/do.js");
    for (const root of orphanRoots) {
      try {
        await withIAmAct(
          `I adopt orphan ${String(root._id).slice(0, 8)}`,
          async (ctx) => {
            await doVerb(
              { kind: "space", id: String(root._id) },
              "set-space",
              { field: "parent", value: String(spaceRoot._id) },
              { identity: I_AM, moment: ctx },
            );
          },
        );
      } catch (err) {
        log.error(
          "Place",
          `Failed to migrate orphan root ${root._id}: ${err.message}`,
        );
      }
    }
    if (orphanRoots.length > 0) {
      log.verbose(
        "Place",
        `Adopted ${orphanRoots.length} orphan tree root(s) under space root`,
      );
    }
  } catch (err) {
    log.error(
      "Place",
      `Orphan root adoption failed: ${err.message}. Some trees may be parentless.`,
    );
  }

  spaceRootCache = spaceRoot;

  // I-Am is NO LONGER birthed here. Per seed/done/IamToActs.md the genesis
  // sequence has ensureIAm() run BEFORE ensureSpaceRoot (so I-Am is a
  // real actor by the time these create-space facts emit), and a
  // separate setIAmHomeSpace(heaven) step runs AFTER heaven exists.

  // childCount read only meaningful on Awakening (rows exist).
  if (!spaceRoot._pending) {
    // Count children of the space root in the projection collection.
    const { countByParent: _ } = await import("./materials/projections.js");
    const { default: Projection } =
      await import("./materials/history/projection.js");
    const childCount = await Projection.countDocuments({
      history: "0",
      type: "space",
      "state.parent": spaceRoot._id,
      tombstoned: { $ne: true },
    });
    log.verbose(
      "Place",
      `Space root verified: ${spaceRoot._id} (${childCount} children)`,
    );
  }
  return spaceRoot;
}

// My Being row. parentBeingId null (root of the being-tree); no
// roles (I precede the role registry); cognition scripted (code
// cognition only). The random password is never used; I cannot be
// claimed or summoned interactively.
//
// The be:birth Fact self-stamps: beingId points at the not-yet-
// existing Being row whose materialization the same Fact triggers.
// Per MOMENT.md "Genesis": "the I-Am's first moment is one act: 'I am
// that I am' — the be:birth fact that issues its own actor." Inside
// the withIAmAct moment opened here, the seal + reduce path
// atomically writes the be:birth fact AND materializes the Being row.
//
// Standalone: opens its own moment, no caller-supplied moment.
// Idempotent. homeSpace stays null at birth; a separate moment later
// in the genesis sequence (setIAmHomeSpace) takes heaven as home once
// it exists. Splitting birth from home-setting is the
// chicken-and-egg unlock from seed/done/IamToActs.md.
export async function ensureIAm() {
  const { findByName } = await import("./materials/projections.js");
  const existing = await findByName("being", I_AM, "0");
  if (existing) {
    iAmBeingIdCache = String(existing.id);
    return { _id: existing.id, ...existing.state };
  }

  // The I-Am's _id IS the I_AM string constant. This is the doctrinal
  // shape. When other code says `through: I_AM` (in facts, in parent
  // references, in audit attribution), it names the actual being row
  // whose _id is the I_AM constant. No indirection, no string-vs-uuid
  // mismatch.
  const id = I_AM;
  // I_AM the being carries NO password. The root's authority is its Name's story key
  // (the i-am Name has privateKeyEnc:null and signs with storyIdentity — see the
  // name:declare just below), never a being credential; and a being password is OPTIONAL,
  // owned by the Name. The auto-generated credential every other being gets at birth is a
  // vestige at the root — nothing authenticates as the i-am being, so it carries none.
  const qualities = {
    cognition: { defaultKind: "scripted" },
  };

  await withIAmAct("I am that I am", async (ctx) => {
    // I_AM is first a NAME (the root identity, parentNameId=null) and then
    // a being that expresses it. The name:declare folds the i-am Name row;
    // the being born just below belongs to it (trueName=I_AM). The i-am
    // Name signs with the story key (storyIdentity), so it stores no
    // privateKeyEnc — loadSigningKey special-cases the i-am name to the
    // story key. The name reel is the most primitive reel.
    await emitFact(
      {
        verb: "name",
        act: "declare",
        through: id, // self-stamping — i-am declares its own name
        of: { kind: "name", id },
        params: {
          spec: {
            parentNameId: null, // the root name, a facet of nothing above
            privateKeyEnc: null, // signs with the story key, not a stored key
            identity: { alg: "ed25519", keyEnc: "story-key", v: 1 },
            soulType: "scripted",
          },
        },
        actId: ctx.actId,
        history: "0",
      },
      ctx,
    );

    await emitFact(
      {
        verb: "be",
        act: "birth",
        through: id, // self-stamping — the not-yet-existing being is its own actor
        of: { kind: "being", id },
        params: {
          name: I_AM,
          roles: [],
          defaultRole: null,
          // The being expresses the i-am Name (the root identity). Every
          // being birthed under i-am inherits this trueName.
          trueName: I_AM,
          // Root of the being-tree.
          parentBeingId: null,
          // homeSpace is null at birth. A later step in the genesis
          // sequence (setIAmHomeSpace) sets it to heaven once heaven
          // exists. The reducer accepts a null homeSpace; downstream
          // consumers that read homeSpace handle null by falling back
          // to the place root (or treating the being as unhomed).
          homeSpace: null,
          position: null,
          // Optional traits (isRemote / homeStory) ride birth facts
          // only when set, the reducer defaults absence.
          qualities,
        },
        actId: ctx.actId,
        // Genesis is main-only — I_AM births before any history exists.
        history: "0",
        // Op count: this be:birth is emitted directly (not through
        // beVerb), so it doesn't bump opCount. The moment seals with
        // opCount=0 — no warn, as intended (the act is one logical
        // birth).
      },
      ctx,
    );
  });

  iAmBeingIdCache = id;
  // Birth announcement on the console; "I am that I am" lives on the
  // chain as the I-Am's first act-startMessage. Order: act seals
  // first (the chain truth), then this line (the substrate noting it).
  log.info("Story", `I am born.`);
  return { _id: id };
}

// `setIAmHomeSpace` — step 4 of the genesis sequence. Takes the
// heaven space id and stamps a do:set-being fact on the I-Am's reel
// putting heaven as its homeSpace + position. Idempotent: if the
// I-Am already has the same homeSpace, no fact is emitted.
//
// Why this is a separate moment: the I-Am is born with homeSpace=null
// because heaven doesn't exist yet at birth. Once ensureSpaceRoot has
// run and heaven materializes, this fixes the home pointer. Per
// seed/done/IamToActs.md "the chicken-and-egg unlock."
export async function setIAmHomeSpace(heavenSpaceId) {
  if (!heavenSpaceId) {
    throw new Error("setIAmHomeSpace: heavenSpaceId is required");
  }
  const { loadProjection } = await import("./materials/projections.js");
  const iAmSlot = await loadProjection("being", I_AM, "0");
  const currentHome = iAmSlot?.state?.homeSpace || null;
  if (currentHome === String(heavenSpaceId)) {
    return { _id: I_AM, _alreadyHome: true };
  }
  const { doVerb } = await import("./ibp/verbs/do.js");
  await withIAmAct("I take heaven as my home", async (ctx) => {
    await doVerb(
      { kind: "being", id: I_AM },
      "set-being",
      { field: "homeSpace", value: String(heavenSpaceId) },
      { identity: I_AM, moment: ctx },
    );
  });
  // The position field follows the same value: I-Am stands at heaven.
  await withIAmAct("I stand at heaven", async (ctx) => {
    await doVerb(
      { kind: "being", id: I_AM },
      "set-being",
      { field: "position", value: String(heavenSpaceId) },
      { identity: I_AM, moment: ctx },
    );
  });
  return { _id: I_AM };
}

export async function getSpaceRoot() {
  if (spaceRootCache) return spaceRootCache;
  spaceRootCache = await findRootForHeavenSpace(HEAVEN_SPACE.SPACE_ROOT);
  return spaceRootCache;
}

// Sync accessor. Only valid after ensureSpaceRoot() has run.
export function getSpaceRootId() {
  return spaceRootCache?._id || null;
}

/**
 * The I-Am Being's actual _id. After 2026-05-29 this is the I_AM
 * string constant ("i-am") on fresh installs. sprout's ensureIAm
 * mints the I-Am with _id = I_AM, so the constant IS the id. Pre-
 * existing realities whose I-Am row was minted with a UUID before
 * the change retain that UUID; the cache reflects whichever shape
 * the row has. Sync accessor — only valid after ensureIAm() has run
 * (the first step of the genesis sequence in genesis.js).
 */
export function getIAmBeingId() {
  return iAmBeingIdCache;
}

// A tree root is a child of the space root with a non-I-Am owner and
// no heavenSpace. Single source of truth; use everywhere.
export function isBeingRoot(space) {
  if (!space) return false;
  if (space.heavenSpace) return false;
  const ownerId = space.owner ? String(space.owner) : null;
  if (!ownerId || ownerId === I_AM) return false;
  const spaceRootId = getSpaceRootId();
  const parentId = space.parent ? String(space.parent) : null;
  if (spaceRootId && parentId && parentId !== String(spaceRootId)) return false;
  return true;
}

// Mirror loaded extensions into the `./extensions` heaven space so SEE
// on `<story>/./extensions/<name>` returns the extension's surface
// (capabilities, deps, scope) via the standard descriptor pipeline.
//
// Runs as part of post-genesis reconciliation (after the genesis
// sequence has materialized the I-Am Being row). Per the
// one-moment-one-act doctrine: each per-extension write opens its own
// withIAmAct internally — "I sync this one extension" is one act.
// Caller doesn't wrap. Idempotent — when nothing changed, zero facts.
export async function syncExtensionsToTree(manifests) {
  const extSpace = await findRootForHeavenSpace(HEAVEN_SPACE.EXTENSIONS);
  if (!extSpace) return;

  // Query by parent — children[] on the parent is retired.
  const { default: Projection } =
    await import("./materials/history/projection.js");
  const existingChildren = (
    await Projection.find({
      history: "0",
      type: "space",
      "state.parent": extSpace._id,
      tombstoned: { $ne: true },
    }).lean()
  ).map((s) => ({
    _id: s.id,
    name: s.state?.name,
    type: s.state?.type,
    extensionQuality: s.state?.qualities?.extension ?? null,
  }));

  const existingByName = new Map();
  for (const c of existingChildren) existingByName.set(c.name, c);

  const currentNames = new Set();

  for (const manifest of manifests) {
    currentNames.add(manifest.name);

    const extensionQuality = {
      version: manifest.version || "0.0.0",
      description: manifest.description || null,
      type: manifest.type || null,
      scope: manifest.scope === "confined" ? "confined" : "open",
      needs: manifest.needs || {},
      optional: manifest.optional || {},
      provides: {
        routes: !!manifest.provides?.routes,
        tools: !!manifest.provides?.tools,
        jobs: !!manifest.provides?.jobs,
        models: Object.keys(manifest.provides?.models || {}),
        energyActions: Object.keys(manifest.provides?.energyActions || {}),
        sessionTypes: Object.keys(manifest.provides?.sessionTypes || {}),
      },
    };
    const qualities = new Map([["extension", extensionQuality]]);

    if (existingByName.has(manifest.name)) {
      // Refresh existing extension space — emit each set-space in its
      // own moment per the one-DO-per-moment doctrine. Idempotent
      // guards still apply: skip when the existing state already matches.
      const existing = existingByName.get(manifest.name);
      const extChildId = existing?._id;
      if (extChildId) {
        const extChildTarget = { kind: "space", id: String(extChildId) };
        const { doVerb } = await import("./ibp/verbs/do.js");
        if (existing.type !== "resource") {
          await withIAmAct(`sync-ext:type ${manifest.name}`, async (ctx) => {
            await doVerb(
              extChildTarget,
              "set-space",
              { field: "type", value: "resource" },
              { identity: I_AM, moment: ctx },
            );
          });
        }
        // Canonical JSON compare with sorted keys so insertion-order
        // differences don't trigger false-positive rewrites.
        const canon = (v) => {
          if (v === null || typeof v !== "object") return v;
          if (Array.isArray(v)) return v.map(canon);
          return Object.keys(v)
            .sort()
            .reduce((acc, k) => {
              acc[k] = canon(v[k]);
              return acc;
            }, {});
        };
        const existingJson = JSON.stringify(
          canon(existing.extensionQuality || null),
        );
        const desiredJson = JSON.stringify(canon(extensionQuality));
        if (existingJson !== desiredJson) {
          await withIAmAct(
            `sync-ext:qualities ${manifest.name}`,
            async (ctx) => {
              await doVerb(
                extChildTarget,
                "set-space",
                {
                  field: "qualities.extension",
                  value: extensionQuality,
                  merge: false,
                },
                { identity: I_AM, moment: ctx },
              );
            },
          );
        }
      }
    } else {
      try {
        // Extension-space birth. One create-space per extension, each
        // in its own moment.
        const { doVerb } = await import("./ibp/verbs/do.js");
        await withIAmAct(`sync-ext:create ${manifest.name}`, async (ctx) => {
          await doVerb(
            { kind: "space", id: String(extSpace._id) },
            "create-space",
            {
              name: manifest.name,
              type: "resource",
              parent: String(extSpace._id),
              qualities: Object.fromEntries(qualities),
            },
            { identity: I_AM, moment: ctx },
          );
        });
      } catch (err) {
        log.error(
          "Place",
          `Failed to sync extension space "${manifest.name}": ${err.message}`,
        );
      }
    }
  }

  // Mark unloaded extensions in their own namespace. One moment per
  // unloaded entry.
  for (const [name, spaceId] of existingByName) {
    if (!currentNames.has(name)) {
      const { doVerb } = await import("./ibp/verbs/do.js");
      await withIAmAct(`sync-ext:unload ${name}`, async (ctx) => {
        await doVerb(
          { kind: "space", id: String(spaceId) },
          "set-space",
          { field: "qualities.extension.loaded", value: false },
          { identity: I_AM, moment: ctx },
        );
      });
    }
  }
}
