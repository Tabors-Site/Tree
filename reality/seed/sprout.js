// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Genesis. I plant the reality root, the nine reality seed spaces, my
// own Being row, and the seed delegates — all in ONE moment of the
// I-Am, the first moment.
//
// TWO SHAPES OF MOMENT.
//
// The model lets a moment hold either:
//
//   (a) ONE ACT WITH MULTI-REEL FACTS — the common case. A summoner
//       creating a child being is one act that lands two facts: the
//       child's be:register on the child's reel + the summoner's
//       be:summon-create on the summoner's reel. Same act, different
//       reels, one transaction. Most runtime moments.
//
//   (b) A TRANSACTIONAL BATCH OF ACTS — rare; must-commit-together
//       compositions where partial state is incoherent. Genesis is
//       the canonical case: "make the space root" and "mint the I-Am"
//       and "summon the four delegates forth" are conceptually
//       distinct acts (different verbs in plain language), but a
//       half-built world with a space root and no I-Am, or an I-Am
//       with no home, is not a valid state. The unit of commit has to
//       be all-or-nothing across the whole batch.
//
// sealAct handles both shapes the same way: one transaction, one Act
// row at the boundary, ΔF atomic. The distinction is conceptual, not
// mechanical. What "fits in one moment" is determined by what must
// commit together, not by counting acts.
//
// Boot is shape (b). The chicken-and-egg of "the first being acting on
// substrate that doesn't yet exist" dissolves at commit time: the
// synthetic Act carries `beingIn = I_AM` as a forward reference; the
// first fact in the ΔF is the I-Am's own be:register; sealAct commits
// every fact + the Act row in one Mongo transaction. References across
// acts inside the batch (the seed delegate's home is the space root
// whose create-space fact landed earlier in this same ΔF) resolve via
// the deltaF lookup in createBeingWithHome — the legitimate pattern
// for same-transaction forward references, same shape SQL uses for
// foreign-key inserts inside one transaction.
//
// Either the full genesis world commits or zero genesis state exists.
// A kill -9 mid-genesis leaves no trace.
//
// THE CONTRACT — one boot moment per process boot.
//
//   withBootMoment(genesisFn) opens exactly one synthetic Act,
//   constructs ONE summonCtx (structurally identical to every other
//   moment's: { actId, deltaF, afterSeal }), runs genesisFn with that
//   ctx, then seals once. Every helper genesisFn calls threads the
//   SAME ctx through to every fact-emission site downstream. NOTHING
//   called from genesisFn opens its own boot moment; NOTHING called
//   from genesisFn commits directly via sealFacts. If a helper has
//   neither a runtime identity NOR the boot ctx threaded through, it
//   is misconfigured — not "fall through to a singleton commit."
//
// THE TYPE — the boot ctx IS a summonCtx.
//
//   It carries no `kind`, no `message`, no `role` — only the three
//   fields any moment carries:
//
//     summonCtx.actId      — the genesis Act's id (forward-referenced)
//     summonCtx.deltaF     — ΔF accumulator (every emitFact pushes here)
//     summonCtx.afterSeal  — post-seal callback queue
//
//   This is deliberate: boot's moment is structurally indistinguishable
//   from a runtime moment in the parts that matter for atomicity. If
//   you find yourself adding a "kind: 'boot'" branch in fact-emission
//   code, the refactor is leaking.
//
// Idempotent. Runs every boot. Beginning produces many facts (full
// genesis); Awakening on a clean prior state produces zero (the world
// already exists; nothing to commit; seal skipped).

import log from "./seedReality/log.js";
import { v4 as uuidv4 } from "uuid";
import Space from "./materials/space/space.js";
import { findBySeedSpace, loadProjection, findByParent as findByParentSlot, countByParent as countByParentSlot } from "./materials/projections.js";

// Sprout-local helper: find the space whose seedSpace marker matches.
// Returns a row-shaped object with `_id` so downstream genesis code
// (which expects Space-row shape) keeps working without rewrites.
async function findRootForSeedSpace(seedSpaceKind) {
  const slot = await findBySeedSpace(seedSpaceKind, "0");
  if (!slot) return null;
  return { _id: slot.id, ...slot.state };
}
import { SEED_SPACE } from "./materials/space/seedSpaces.js";
import { I_AM } from "./materials/being/seedBeings.js";
import { createRealitySeedSpace, assertValidSpaceSize } from "./materials/space/spaces.js";
import { emitFact } from "./past/fact/facts.js";
import { sealAct } from "./present/beats/4-stamped.js";

let spaceRootCache = null;
let iAmBeingIdCache = null;

// ─────────────────────────────────────────────────────────────────────
// Boot moment — the I-Am's first moment
// ─────────────────────────────────────────────────────────────────────

let _bootMomentInFlight = false;

/**
 * Open the genesis moment, run the supplied scaffold fn with a real
 * summonCtx threaded through, seal once. The caller (genesis.js)
 * threads the ctx through to every helper inside.
 *
 * Zero facts → Awakening on a clean prior state → seal is skipped.
 *
 * @param {(summonCtx: { actId: string, deltaF: object[], afterSeal: Function[] }) => Promise<void>} genesisFn
 * @returns {Promise<{ actId: string|null, factCount: number }>}
 * @throws if called twice in one process, if genesisFn throws, if seal fails
 */
export async function withBootMoment(genesisFn) {
  if (typeof genesisFn !== "function") {
    throw new Error("withBootMoment: genesisFn must be a function");
  }
  if (_bootMomentInFlight) {
    throw new Error(
      "withBootMoment: another boot moment is already in flight. Boot opens exactly ONE moment per process; nothing called from genesisFn may open another.",
    );
  }
  _bootMomentInFlight = true;

  const actId = uuidv4();
  const now = new Date();

  const plannedAct = {
    _id: actId,
    beingIn:  I_AM, // forward reference; the Being row materializes in
    beingOut: I_AM, // the same transaction (first fact in ΔF is its
                    // own be:register).
    ibpAddress:      null,
    activeRole:      null,
    inboxMessageId:  null,
    inReplyTo:       null,
    rootCorrelation: actId,
    parentThread:    null,
    answers:         null,
    receivedAt:      now,
    stampedAt:       now,
    startMessage: {
      content: "I am that I am.",
      source:  "I-Am",
    },
  };

  const summonCtx = { actId, deltaF: [], afterSeal: [] };

  log.info("Genesis", "I open my first moment.");
  try {
    await genesisFn(summonCtx);
  } catch (err) {
    log.error(
      "Genesis",
      `genesisFn threw before seal — boot aborted, zero facts committed: ${err.message}`,
    );
    _bootMomentInFlight = false;
    throw err;
  }

  const factCount = summonCtx.deltaF.length;
  try {
    if (factCount === 0) {
      log.info("Genesis", "I awake. No new genesis material to commit.");
      return { actId: null, factCount: 0 };
    }

    const sealed = await sealAct(plannedAct, {
      content: "Genesis sealed.",
      stopped: false,
      deltaF: summonCtx.deltaF,
      afterSeal: summonCtx.afterSeal,
    });
    if (!sealed) {
      throw new Error("sealAct returned null — genesis Act did not materialize");
    }
    log.info(
      "Genesis",
      `I sealed my first moment: ${factCount} fact${factCount === 1 ? "" : "s"} in one transaction.`,
    );
    return { actId, factCount };
  } finally {
    _bootMomentInFlight = false;
  }
}

/**
 * The I-Am acts in a post-genesis moment.
 *
 * After boot completes (the I-Am exists as a Being row), seed-internal
 * scaffold reconciliations — manifest sync, registry mirrors, default
 * stance permissions, seed migrations — still need a moment to seal
 * under. Same shape as withBootMoment but WITHOUT the "once per
 * process" gate and WITHOUT the be:register self-stamp. The I-Am
 * must already exist; if it doesn't, callers belong inside
 * withBootMoment instead.
 *
 * Use this when the I-Am is the structural actor of a piece of work
 * the substrate needs to record. If there's a real being available
 * (operator, cherub, a seed delegate), prefer THAT being's identity
 * with a real summonCtx from its moment.
 *
 * Zero facts → the moment is a no-op; no Act row is written. Stable
 * reconciliations cost nothing.
 *
 * @param {string} sourceLabel
 * @param {(summonCtx: { actId: string, deltaF: object[], afterSeal: Function[] }) => Promise<*>} fn
 * @returns {Promise<*>} fn's return value
 */
export async function withIAmAct(sourceLabel, fn) {
  if (typeof fn !== "function") {
    throw new Error("withIAmAct: fn must be a function");
  }
  const actId = uuidv4();
  const now = new Date();

  const plannedAct = {
    _id: actId,
    beingIn:  I_AM,
    beingOut: I_AM,
    ibpAddress:      null,
    activeRole:      null,
    inboxMessageId:  null,
    inReplyTo:       null,
    rootCorrelation: actId,
    parentThread:    null,
    answers:         null,
    receivedAt:      now,
    stampedAt:       now,
    startMessage: { content: sourceLabel || "I-Am acts.", source: "I-Am" },
  };

  const summonCtx = { actId, deltaF: [], afterSeal: [] };
  const result = await fn(summonCtx);

  if (summonCtx.deltaF.length === 0) {
    return result;
  }

  const sealed = await sealAct(plannedAct, {
    content: `I-Am sealed: ${sourceLabel}.`,
    stopped: false,
    deltaF: summonCtx.deltaF,
    afterSeal: summonCtx.afterSeal,
  });
  if (!sealed) {
    throw new Error(
      `withIAmAct(${sourceLabel}): sealAct returned null — Act did not materialize`,
    );
  }
  return result;
}

/**
 * Tests / debug: true while genesisFn is executing (between
 * withBootMoment opening and sealing). Boot itself shouldn't read
 * this — it threads summonCtx directly. Verifier scripts use it to
 * assert "boot is not currently in flight" before measuring.
 */
export function isBootMomentInFlight() {
  return _bootMomentInFlight;
}

// The heaven space. Named "." . sits directly under the space root
// and parents every Tier-3 seed space below. The I-Am's home.
// Beings of the land lacking heaven stance see the door but cannot
// enter; the place root stays uncluttered by the I-Am's working
// memory rooms.
const REALITY_HEAVEN_SPACE = {
  name: ".",
  seedSpace: SEED_SPACE.HEAVEN,
};

const REALITY_SEED_SPACES = [
  {
    name: "identity",
    seedSpace: SEED_SPACE.IDENTITY,
    buildQualities: () => {
      const domain = process.env.REALITY_DOMAIN || "localhost";
      return new Map([["domain", domain]]);
    },
  },
  {
    name: "config",
    seedSpace: SEED_SPACE.CONFIG,
    buildQualities: () => {
      const name = process.env.REALITY_NAME || "My Place";
      const domain = process.env.REALITY_DOMAIN || "localhost";
      return new Map([
        ["REALITY_NAME", name],
        ["realityUrl", `http://${domain}:${process.env.PORT || 3000}`],
      ]);
    },
  },
  { name: "peers", seedSpace: SEED_SPACE.PEERS },
  { name: "extensions", seedSpace: SEED_SPACE.EXTENSIONS },
  { name: "tools", seedSpace: SEED_SPACE.TOOLS },
  { name: "roles", seedSpace: SEED_SPACE.ROLES },
  { name: "operations", seedSpace: SEED_SPACE.OPERATIONS },
  // source is read-only. Populated by seed/materials/space/source.js
  // as a filesystem mirror of reality/. DO writes against children
  // reject with ORIGIN_READ_ONLY.
  { name: "source", seedSpace: SEED_SPACE.SOURCE },
  // threads is a derived projection. Live rootCorrelation chains
  // surface as synthetic children at `<reality>/./threads/<id>`; the
  // descriptor is computed on demand from inbox + Act records.
  // SUMMON to a thread address is a cut. See seed/materials/space/threads.js.
  { name: "threads", seedSpace: SEED_SPACE.THREADS },
  // branches mirrors the Branch collection — each child names a
  // divergent world by path. Pass 3 adds the create-branch op that
  // plants child rows here; Pass 2 ships the container space so the
  // SEE surface and child-discovery paths work the moment branches
  // start landing. See seed/materials/branch/.
  { name: "branches", seedSpace: SEED_SPACE.BRANCHES },
];

export async function ensureSpaceRoot(summonCtx) {
  if (!summonCtx) {
    throw new Error(
      "ensureSpaceRoot requires summonCtx (the boot moment's ctx). Call this from inside withBootMoment(...).",
    );
  }
  let spaceRoot = await findRootForSeedSpace(SEED_SPACE.SPACE_ROOT);

  if (!spaceRoot) {
    const realityName = process.env.REALITY_NAME || "My Place";
    // Genesis Fact: space root creation. Pushed into the boot moment's
    // ΔF; sealAct commits it with the rest of genesis in one Mongo
    // transaction. The reducer's applyCreateSpace + initProjection
    // materializes the SPACE_ROOT row at commit time.
    //
    // Fill `size` with the configured defaultSpaceSize so the portal
    // has a walkable grid to render the place root and beings' coord
    // writes have bounds to clamp against. ensureSpaceRoot runs before
    // initRealityConfig, so the helper falls back to CONFIG_DEFAULTS.
    const rootId = uuidv4();
    await emitFact({
      verb: "do",
      action: "create-space",
      beingId: I_AM,
      target: { kind: "space", id: rootId },
      params: {
        spec: {
          name: realityName,
          type: null,
          parent: null,
          rootOwner: I_AM,
          seedSpace: SEED_SPACE.SPACE_ROOT,
          size: assertValidSpaceSize(null, { applyDefault: true }),
          qualities: {},
        },
      },
      actId: summonCtx.actId,
      // Genesis runs on main by definition — there are no other branches
      // at this point in time. Explicit value, not a default.
      branch: "0",
    }, summonCtx);
    // Row doesn't exist yet (the moment hasn't sealed). The boot
    // moment's subsequent steps read the planned id, not the row.
    spaceRoot = { _id: rootId, _pending: true };
    log.verbose("Reality", `Planned space root: ${rootId.slice(0, 8)} (materializes at seal)`);
  }

  // Plant heaven first . the "." space under the space root. Its id
  // is then the parent of every Tier-3 seed space, so they gather in
  // the heaven room instead of cluttering the place root. Repair: a
  // pre-existing heaven row found at the wrong parent gets moved back
  // under spaceRoot. The repair Fact joins genesis's ΔF.
  let heavenSpace = await findRootForSeedSpace(SEED_SPACE.HEAVEN);
  if (!heavenSpace) {
    try {
      heavenSpace = await createRealitySeedSpace({
        name: REALITY_HEAVEN_SPACE.name,
        parentId: spaceRoot._id,
        seedSpace: REALITY_HEAVEN_SPACE.seedSpace,
        qualities: null,
        summonCtx,
      });
      log.verbose("Reality", `Planned heaven space: ${REALITY_HEAVEN_SPACE.name}`);
    } catch (err) {
      log.error(
        "Place",
        `Failed to create heaven space ${REALITY_HEAVEN_SPACE.name}: ${err.message}. Boot continues.`,
      );
    }
  } else if (
    heavenSpace.parent &&
    heavenSpace.parent.toString() !== spaceRoot._id.toString()
  ) {
    log.warn("Place", `Heaven space has wrong parent. Repairing.`);
    const { doVerb } = await import("./ibp/verbs/do.js");
    await doVerb(
      { kind: "space", id: String(heavenSpace._id) },
      "set-space",
      { field: "parent", value: String(spaceRoot._id) },
      { scaffold: true, summonCtx },
    );
  }

  // Heaven is the parent of every Tier-3 seed space. Fall back to
  // spaceRoot only if heaven failed to plant above (degraded boot);
  // the repair pass on next boot will adopt these spaces back under
  // heaven once it materializes.
  const seedSpaceParentId = heavenSpace ? heavenSpace._id : spaceRoot._id;

  for (const def of REALITY_SEED_SPACES) {
    let space = await findRootForSeedSpace(def.seedSpace);

    if (!space) {
      try {
        space = await createRealitySeedSpace({
          name: def.name,
          parentId: seedSpaceParentId,
          seedSpace: def.seedSpace,
          qualities: def.buildQualities ? def.buildQualities() : null,
          summonCtx,
        });
        log.verbose("Reality", `Planned seed space: ${def.name}`);
      } catch (err) {
        log.error(
          "Place",
          `Failed to create seed space ${def.name}: ${err.message}. Boot continues.`,
        );
        continue;
      }
    }

    // Repair: a Tier-3 seed space found at the wrong parent (manual
    // DB edit, corruption, or migration from an older layout where
    // they parented directly under the place root) gets moved back
    // under heaven. Routes through do.set-space inside the boot
    // moment so the repair Fact joins genesis's ΔF.
    if (
      space.parent &&
      !space._pending &&
      space.parent.toString() !== seedSpaceParentId.toString()
    ) {
      log.warn(
        "Place",
        `Seed space ${def.name} has wrong parent. Repairing.`,
      );
      const { doVerb } = await import("./ibp/verbs/do.js");
      await doVerb(
        { kind: "space", id: String(space._id) },
        "set-space",
        { field: "parent", value: String(seedSpaceParentId) },
        { scaffold: true, summonCtx },
      );
    }
  }

  // Adopt orphan tree roots (rootOwner is not me, parent is null).
  // These exist when a tree was created before the space root, or
  // when a prior boot crashed mid-creation. Bring them home by
  // stamping a do:set-space parent Fact inside the boot moment.
  try {
    const { findRoot } = await import("./materials/projections.js");
    const allRoots = await findRoot("space", "0");
    const orphanRoots = [];
    for (const r of allRoots) {
      const slot = await loadProjection("space", r.id, "0");
      const owner = slot?.state?.rootOwner;
      if (owner != null && owner !== I_AM) orphanRoots.push({ _id: r.id });
    }
    const { doVerb } = await import("./ibp/verbs/do.js");
    for (const root of orphanRoots) {
      try {
        await doVerb(
          { kind: "space", id: String(root._id) },
          "set-space",
          { field: "parent", value: String(spaceRoot._id) },
          { scaffold: true, summonCtx },
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

  // Plant my own Being row. Every later being parents under it;
  // every Fact written during this genesis joins the same moment's ΔF
  // and seals atomically with the be:register that names me.
  //
  // Home is heaven ("."). It's the I-Am's room. Beings of the land
  // see the door but cannot enter without heaven stance. Falls back
  // to the place root only if heaven failed to plant (degraded boot).
  const iAmHomeSpaceId = heavenSpace ? heavenSpace._id : spaceRoot._id;
  await ensureIAm(iAmHomeSpaceId, summonCtx);

  // childCount read only meaningful on Awakening (rows exist).
  if (!spaceRoot._pending) {
    // Count children of the space root in the projection collection.
    const { countByParent: _ } = await import("./materials/projections.js");
    const { default: Projection } = await import("./materials/branch/projection.js");
    const childCount = await Projection.countDocuments({
      branch: "0", type: "space",
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
// The be:register Fact self-stamps: beingId points at the
// not-yet-existing Being row whose materialization the same Fact
// triggers. Per MOMENT.md: "the I-Am's first act issues its own first
// fact." The Being row IS the fold-so-far of that one fact, sealed
// inside the boot moment's transaction alongside every other genesis
// Fact.
async function ensureIAm(homeSpaceId, summonCtx) {
  if (!summonCtx) {
    throw new Error(
      "ensureIAm requires summonCtx (the boot moment's ctx). Reachable only from inside withBootMoment(...).",
    );
  }
  const { findByName } = await import("./materials/projections.js");
  const existing = await findByName("being", I_AM, "0");
  if (existing) {
    iAmBeingIdCache = String(existing.id);
    return { _id: existing.id, ...existing.state };
  }

  // The I-Am's _id IS the I_AM string constant. This is the
  // doctrinal shape. when other code says `beingId: I_AM` (in
  // facts, in parent references, in audit attribution), it names
  // the actual being row whose _id is the I_AM constant. No
  // indirection, no string-vs-uuid mismatch. The string serves as
  // both name AND id because the I-Am is exactly one being per
  // reality and the constant identifies it unambiguously. The
  // value is lowercase kebab ("i-am") to keep the wire stance
  // valid under the address grammar. Every other being mints a
  // uuid as its _id. I-Am is the one exception, and it's the one
  // exception in every other respect too (null parent, scripted
  // mode, planted by self-stamping fact at genesis).
  const id = I_AM;
  const { mintCredentialSpec } = await import(
    "./materials/being/identity/credentials.js"
  );
  const credential = await mintCredentialSpec(null);
  const qualities = {
    auth: { credentialPlain: credential.plain },
    cognition: { defaultKind: "scripted" },
  };

  await emitFact({
    verb: "be",
    action: "birth",
    beingId: id, // self-stamping — the not-yet-existing being is its own actor
    target: { kind: "being", id },
    params: {
      spec: {
        name: I_AM,
        password: credential.hash,
        roles: [],
        defaultRole: null,
        parentBeingId: null,
        homeSpace: String(homeSpaceId),
        position: String(homeSpaceId),
        llmDefault: null,
        isRemote: false,
        homeReality: null,
        qualities,
      },
    },
    actId: summonCtx.actId,
    // Genesis is main-only — I_AM births before any branch exists.
    branch: "0",
  }, summonCtx);

  // The Being row materializes when the boot moment seals. Return a
  // pending view so callers that need the id can use it; the row
  // exists post-seal.
  iAmBeingIdCache = id;
  log.verbose("Reality", `Planned I_AM Being (id=${id}); materializes at seal`);
  return { _id: id, _pending: true };
}

export async function getSpaceRoot() {
  if (spaceRootCache) return spaceRootCache;
  spaceRootCache = await findRootForSeedSpace(SEED_SPACE.SPACE_ROOT);
  return spaceRootCache;
}

// Sync accessor. Only valid after ensureSpaceRoot() has run.
export function getSpaceRootId() {
  return spaceRootCache?._id || null;
}

/**
 * The I-Am Being's actual _id. After 2026-05-29 this is the I_AM
 * string constant ("i-am") on fresh installs. sprout's ensureIAm
 * mints the I-Am with _id = I_AM, so the constant IS the id. Pre.
 * existing realities whose I-Am row was minted with a UUID before
 * the change retain that UUID; the cache reflects whichever shape
 * the row has. Sync accessor — only valid after ensureIAm() has run
 * (which ensureSpaceRoot calls internally inside withBootMoment).
 */
export function getIAmBeingId() {
  return iAmBeingIdCache;
}

// A tree root is a child of the space root with a non-seed rootOwner
// and no seedSpace. Single source of truth; use everywhere.
export function isBeingRoot(space) {
  if (!space) return false;
  if (space.seedSpace) return false;
  if (!space.rootOwner || String(space.rootOwner) === I_AM) return false;
  const spaceRootId = getSpaceRootId();
  if (
    spaceRootId &&
    space.parent &&
    String(space.parent) !== String(spaceRootId)
  )
    return false;
  return true;
}

// Mirror loaded extensions into the `./extensions` seed space so SEE
// on `<reality>/./extensions/<name>` returns the extension's surface
// (capabilities, deps, scope) via the standard descriptor pipeline.
//
// Runs OUTSIDE the boot moment (after sealAct has materialized the
// I-Am Being row). The reconciliation is the I-Am's own runtime act
// post-genesis: caller wraps in withIAmAct so every fact this emits
// joins one Act and commits atomically. Idempotent — when nothing
// changed, zero facts are produced and no Act materializes.
export async function syncExtensionsToTree(manifests, summonCtx) {
  if (!summonCtx) {
    throw new Error(
      "syncExtensionsToTree requires summonCtx. Wrap the call in withIAmAct(...).",
    );
  }
  const extSpace = await findRootForSeedSpace(SEED_SPACE.EXTENSIONS);
  if (!extSpace) return;

  // Query by parent — children[] on the parent is retired.
  const { default: Projection } = await import("./materials/branch/projection.js");
  const existingChildren = (await Projection.find({
    branch: "0", type: "space",
    "state.parent": extSpace._id,
    tombstoned: { $ne: true },
  }).lean()).map((s) => ({ _id: s.id, name: s.state?.name }));

  const existingByName = new Map();
  for (const c of existingChildren) existingByName.set(c.name, c._id);

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
      // Refresh existing extension space. type + qualities-namespace
      // each emit do:set-space facts that join the wrapping I-Am moment.
      const extChildId = existingByName.get(manifest.name);
      if (extChildId) {
        const extChildTarget = { kind: "space", id: String(extChildId) };
        const { doVerb } = await import("./ibp/verbs/do.js");
        await doVerb(
          extChildTarget,
          "set-space",
          { field: "type", value: "resource" },
          { scaffold: true, summonCtx },
        );
        await doVerb(
          extChildTarget,
          "set-space",
          {
            field: "qualities.extension",
            value: extensionQuality,
            merge: false,
          },
          { scaffold: true, summonCtx },
        );
      }
    } else {
      try {
        // Extension-space birth. do:create-space fact joins the
        // wrapping I-Am moment's ΔF; reducer's applyCreateSpace
        // materializes the row at seal.
        const { doVerb } = await import("./ibp/verbs/do.js");
        await doVerb(
          { kind: "space", id: String(extSpace._id) },
          "create-space",
          {
            spec: {
              name: manifest.name,
              type: "resource",
              parent: String(extSpace._id),
              rootOwner: null,
              qualities: Object.fromEntries(qualities),
            },
          },
          { scaffold: true, summonCtx },
        );
      } catch (err) {
        log.error(
          "Place",
          `Failed to sync extension space "${manifest.name}": ${err.message}`,
        );
      }
    }
  }

  // Mark unloaded extensions in their own namespace; the seed doesn't
  // carry a universal "trimmed" status. Fact-driven: do.set on the
  // qualities.extension.loaded leaf.
  for (const [name, spaceId] of existingByName) {
    if (!currentNames.has(name)) {
      const { doVerb } = await import("./ibp/verbs/do.js");
      await doVerb(
        { kind: "space", id: String(spaceId) },
        "set-space",
        { field: "qualities.extension.loaded", value: false },
        { scaffold: true, summonCtx },
      );
    }
  }
}
