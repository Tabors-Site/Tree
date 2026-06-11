// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed — capture the full reality as a portable genetic encoding.
//
// **A seed is the genome.** It captures every fact, every act, every
// branch, every reel head — the complete experiential biography of the
// reality. Original IDs are preserved verbatim so a planted seed
// CONTINUES the reality on a new substrate, not duplicates it.
//
// Compare with `clone.js`:
//   - Clone captures the SETUP (current shape). Hollow face. Graft-only.
//     For setup transfer: "install my configuration elsewhere."
//   - Seed captures the WHOLE REALITY (chains + biography). Plant-only.
//     For continuation: "continue my computational life elsewhere."
//
// See `seed/done/Chain-Rebuild.md` for the doctrine: clone and seed are two
// distinct artifacts with two distinct purposes, not one artifact at
// two fidelity levels.
//
// Plant is the receive-side operation (boot-time only, lives in
// `genesis.js`). The substrate refuses to expose runtime plant because
// replacing a live reality is destructive and belongs to the deployer.
//
// **Plant is continuation, not duplication.** A planted seed has the
// source's original IDs. Two simultaneously-live substrates with the
// same reality identity is undefined behavior; the deployer ensures
// only one is canonical (migration / backup-restore / cold archive —
// not duplication).
//
// V1 implementation: dump-style. Walks each collection with .find().lean()
// and returns the full snapshot. For realities under ~100k facts this is
// fine; beyond that, future versions should stream with cursor batching.
// Per the doctrine — make it work, chisel later.

import mongoose from "mongoose";
import Fact from "../../past/fact/fact.js";
import Act from "../../past/act/act.js";
import Branch from "../branch/branch.js";
import ReelHead from "../../past/reel/reelHead.js";
import log from "../../seedReality/log.js";
import { getRealityDomain } from "../../ibp/address.js";
import { writeFile, mkdir, readdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Collections the seed handles explicitly or that are pure caches
// re-derived from the chain at plant time. Everything ELSE in the
// database is "the rest of the reality's data" — extension-owned
// collections, the peer registry, whatever future modules store — and
// the genome captures it verbatim (a seed is the WHOLE reality; an
// extension's collection is as much its body as its facts are).
const SEED_CORE_COLLECTIONS = new Set(["facts", "acts", "branches", "reelHeads"]);
const REGENERABLE_COLLECTIONS = new Set([
  // fold caches — plant cold-folds these back from the chain
  "projections", "inbox_projection", "threads_projection", "position_projection",
  // legacy row caches of the fold (and the empty pre-rename stamps)
  "spaces", "beings", "matters", "stamps",
]);

export const SEED_BUNDLE_VERSION = "1.0";

// Canonical seeds folder: reality/seeds/, sibling of reality/extensions/.
// Operator artifacts (genome backups) live here, NOT inside the
// sovereign seed/ substrate folder.
// seed.js lives at reality/seed/materials/publish/seed.js
// reality/seeds is three levels up.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SEEDS_FOLDER = path.resolve(__dirname, "..", "..", "..", "seeds");

/**
 * Capture the full reality as a portable seed bundle.
 *
 * The bundle preserves original IDs verbatim — a planted seed becomes
 * the same reality continuing on a new substrate. The substrate refuses
 * to expose a runtime plant; the receiving deployer plants at boot via
 * `genesis.js` mode.
 *
 * By default, writes the captured seed to `reality/seeds/<realityName>-<timestamp>.seed.json`.
 * Pass `returnOnly: true` to skip the write and just return the bundle
 * (for callers who want to ship it over the wire or stash elsewhere).
 *
 * @param {object} opts
 * @param {string} [opts.capturedBy]  the operator beingId who initiated
 *                                    the capture (for audit meta)
 * @param {string} [opts.realityName] human label for the bundle meta + filename stem
 * @param {boolean} [opts.returnOnly] if true, skip the disk write and just return the bundle
 * @returns {Promise<object>} { bundle, savedTo? } — bundle is the seed; savedTo is the disk path (when written)
 */
export async function captureSeed(opts = {}) {
  const startedAt = Date.now();
  log.info("Seed", "capturing reality genome...");

  // ── 1. Collect every Fact ──
  // The substantive change chain. Each fact has its hash chain (p/h)
  // and per-reel seq. Plant replays these verbatim so the destination
  // chain matches the source's exactly (modulo wall-clock dates which
  // stay as-stamped).
  const facts = await Fact.find({}).sort({ seq: 1, date: 1 }).lean();
  log.info("Seed", `captured ${facts.length} facts`);

  // ── 2. Collect every Act ──
  // The experiential chain. Each act carries the cognition transcript
  // (startMessage, endMessage, facadeSnapshot) — the biography that
  // makes the reality more than a state snapshot.
  const acts = await Act.find({}).sort({ stampedAt: 1 }).lean();
  log.info("Seed", `captured ${acts.length} acts`);

  // ── 3. Collect every Branch ──
  // Branch registry: paths, branchPoints (per-reel snapshots of parent
  // heads at create-branch time), scopes, lifecycle flags.
  const branches = await Branch.find({}).lean();
  log.info("Seed", `captured ${branches.length} branches`);

  // ── 4. Collect every ReelHead ──
  // Per-reel-per-branch seq counters. Without these the receiving
  // substrate would allocate seq 1 for every reel on a fresh boot,
  // breaking the hash chain continuity from the seed's facts.
  const reelHeads = await ReelHead.find({}).lean();
  log.info("Seed", `captured ${reelHeads.length} reel heads`);

  // ── 5. Collect everything else — extension collections et al ──
  // The genome is the WHOLE reality. Extensions may keep their own
  // Mongo collections (declared via their manifests); the peer
  // registry lives in its own collection; future modules will add
  // more. None of that is derivable from the chain, so the seed
  // captures every collection that isn't core (handled above) or a
  // regenerable cache (re-derived by plant's cold-fold). Keyed by
  // collection name; plant re-inserts verbatim.
  const extensionData = {};
  try {
    const db = mongoose.connection.db;
    const cols = await db.listCollections().toArray();
    for (const c of cols) {
      const name = c.name;
      if (name.startsWith("system.")) continue;
      if (SEED_CORE_COLLECTIONS.has(name)) continue;
      if (REGENERABLE_COLLECTIONS.has(name)) continue;
      const docs = await db.collection(name).find({}).toArray();
      if (docs.length > 0) {
        extensionData[name] = docs;
        log.info("Seed", `captured ${docs.length} docs from "${name}"`);
      }
    }
  } catch (err) {
    log.warn("Seed", `extension-collection sweep failed: ${err.message}. Core chain still captured.`);
  }

  // ── 6. Record the loaded extensions ──
  // The reality's behavior depends on which extensions are awake
  // (their roles, ops, schedules, collections). The receiving
  // deployer needs the same set for the planted reality to BE the
  // same reality; plant warns loudly about any that are missing.
  let extensions = [];
  try {
    const { getLoadedExtensionNames, getExtensionManifest } =
      await import("../../../extensions/loader.js");
    extensions = getLoadedExtensionNames().map((name) => ({
      name,
      version: getExtensionManifest(name)?.version || null,
    }));
  } catch {
    // Headless capture (no loader in this process). The extension
    // collections above still travel; only the declared list is empty.
  }

  // ── 7. Assemble the bundle ──
  const bundle = {
    kind: "seed",
    bundleVersion: SEED_BUNDLE_VERSION,
    sourceReality: getRealityDomain() || null,
    capturedAt: new Date().toISOString(),
    capturedBy: opts.capturedBy || null,

    meta: {
      realityName: opts.realityName || null,
      extensions,
      counts: {
        facts:     facts.length,
        acts:      acts.length,
        branches:  branches.length,
        reelHeads: reelHeads.length,
        extensionCollections: Object.keys(extensionData).length,
      },
      // The captured reality's chain fingerprint — computed PURELY
      // over the captured arrays (not the live DB, which keeps
      // moving while capture runs). A seed's identity IS this root:
      // any substrate planting these parts must recompute the same
      // root, or determinism broke — plantSeed verifies and reports.
      // Reproducible realities by construction.
      realityRoot: await (async () => {
        try {
          const { realityRootFromParts } =
            await import("../../past/fact/chainRoots.js");
          return realityRootFromParts({
            reality: getRealityDomain() || null,
            branches,
            reelHeads,
          });
        } catch { return null; }
      })(),
    },

    facts,
    acts,
    branches,
    reelHeads,
    extensionData,
  };

  const elapsedMs = Date.now() - startedAt;
  log.info("Seed", `genome captured in ${elapsedMs}ms`);

  // Default behavior: write to reality/seeds/ so there's one canonical
  // place for genome artifacts. Callers wanting the raw bundle pass
  // returnOnly: true.
  if (opts.returnOnly) return { bundle };

  await mkdir(SEEDS_FOLDER, { recursive: true });
  const stem = (opts.realityName || bundle.sourceReality || "reality")
    .replace(/[^a-zA-Z0-9._-]/g, "-");
  const stamp = bundle.capturedAt.replace(/[:.]/g, "-").slice(0, 19);
  const savedTo = path.join(SEEDS_FOLDER, `${stem}-${stamp}.seed.json`);
  await writeFile(savedTo, JSON.stringify(bundle));
  log.info("Seed", `genome saved to ${savedTo}`);
  return { bundle, savedTo };
}

/**
 * Validate a seed bundle's structural shape. Throws on mismatch.
 * Plant uses this before touching the substrate.
 */
export function assertValidSeed(bundle) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("seed: bundle must be an object");
  }
  if (bundle.kind !== "seed") {
    throw new Error(`seed: bundle.kind must be "seed" (got "${bundle.kind}")`);
  }
  if (bundle.bundleVersion !== SEED_BUNDLE_VERSION) {
    throw new Error(
      `seed: bundleVersion expected ${SEED_BUNDLE_VERSION}, got ${bundle.bundleVersion}`,
    );
  }
  for (const collection of ["facts", "acts", "branches", "reelHeads"]) {
    if (!Array.isArray(bundle[collection])) {
      throw new Error(`seed: bundle.${collection} must be an array`);
    }
  }
  // Optional sections (older bundles predate them): extensionData is a
  // name → docs[] map; meta.extensions is [{name, version}].
  if (bundle.extensionData != null && typeof bundle.extensionData !== "object") {
    throw new Error("seed: bundle.extensionData must be an object when present");
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// PLANT — boot-time only
// ─────────────────────────────────────────────────────────────────────

/**
 * Plant a seed into a fresh DB. **Boot-only.** The function refuses to
 * run if any of the target collections already contain documents — the
 * deployer is responsible for ensuring a wiped DB before plant.
 *
 * Plant is continuation, not duplication. The bundle's original IDs
 * land verbatim on the new substrate. From this substrate's perspective,
 * this IS the reality with those IDs. Two simultaneously-live
 * substrates with the same reality identity is undefined behavior and
 * is the deployer's responsibility to prevent (see done/Chain-Rebuild.md).
 *
 * Replaying steps:
 *   1. Validate bundle shape
 *   2. Refuse if any target collection is non-empty (DB must be fresh)
 *   3. Bulk-insert branches, reelHeads, facts, acts (original IDs)
 *   4. Caller (genesis.js boot mode) runs cold-fold over every
 *      aggregate to materialize projections — the chain IS truth, so
 *      projections are caches; replaying the chain re-derives them.
 *
 * @param {object} bundle  the seed bundle (typically parsed from disk)
 * @returns {Promise<{counts: object}>}
 */
export async function plantSeed(bundle) {
  assertValidSeed(bundle);

  // ── 1. Refuse if DB isn't fresh ──
  // Plant is destructive on a live reality. The substrate refuses to
  // expose runtime plant for exactly this reason. Boot mode in
  // `genesis.js` ensures it only runs against a fresh DB — but we
  // double-check here so a misconfigured boot can't silently corrupt
  // an existing reality.
  const checks = await Promise.all([
    Fact.countDocuments({}),
    Act.countDocuments({}),
    Branch.countDocuments({}),
    ReelHead.countDocuments({}),
  ]);
  const [factCount, actCount, branchCount, reelCount] = checks;
  if (factCount > 0 || actCount > 0 || branchCount > 0 || reelCount > 0) {
    throw new Error(
      `plantSeed: refusing to plant into a non-empty DB. Found ` +
      `facts=${factCount}, acts=${actCount}, branches=${branchCount}, ` +
      `reelHeads=${reelCount}. Wipe the DB before planting (the deployer's ` +
      `responsibility — plant is destructive by design).`,
    );
  }

  log.info("Seed", "planting reality genome...");
  const startedAt = Date.now();

  // ── 2. Branches first ──
  // Plant order matters for foreign-key-like references inside the
  // substrate's read paths. Branches are referenced by facts.branch
  // and reelHeads.branch; insert them first.
  if (bundle.branches.length > 0) {
    await Branch.insertMany(bundle.branches, { ordered: false });
    log.info("Seed", `planted ${bundle.branches.length} branches`);
  }

  // ── 3. ReelHeads ──
  // Per-reel seq counters. Needed before facts so allocSeq paths
  // don't try to re-allocate seq=1 on every reel.
  if (bundle.reelHeads.length > 0) {
    await ReelHead.insertMany(bundle.reelHeads, { ordered: false });
    log.info("Seed", `planted ${bundle.reelHeads.length} reel heads`);
  }

  // ── 4. Facts ──
  // The substantive chain. Original _id, seq, branch, p/h hashes
  // preserved. The fold engine derives projections from these.
  if (bundle.facts.length > 0) {
    await Fact.insertMany(bundle.facts, { ordered: false });
    log.info("Seed", `planted ${bundle.facts.length} facts`);
  }

  // ── 5. Acts ──
  // The experiential chain. Original _id, beingIn/beingOut, transcripts.
  if (bundle.acts.length > 0) {
    await Act.insertMany(bundle.acts, { ordered: false });
    log.info("Seed", `planted ${bundle.acts.length} acts`);
  }

  // ── 6. Extension collections et al ──
  // Everything the capture swept beyond the chain (extension-owned
  // collections, the peer registry). Re-inserted verbatim; the DB was
  // verified empty above, so there is nothing to collide with.
  let extensionCollections = 0;
  if (bundle.extensionData && typeof bundle.extensionData === "object") {
    const db = mongoose.connection.db;
    for (const [name, docs] of Object.entries(bundle.extensionData)) {
      if (!Array.isArray(docs) || docs.length === 0) continue;
      if (name.startsWith("system.")) continue;
      try {
        await db.collection(name).insertMany(docs, { ordered: false });
        extensionCollections++;
        log.info("Seed", `planted ${docs.length} docs into "${name}"`);
      } catch (err) {
        log.warn("Seed", `planting collection "${name}" failed: ${err.message}`);
      }
    }
  }

  // ── 7. Extension presence check ──
  // The bundle names the extensions the source reality ran with. The
  // planted reality needs the same set to behave the same (roles, ops,
  // schedules, collection consumers). Warn LOUDLY for any not present
  // on this substrate's disk — the operator fixes the extension folder
  // or the .treeos-profile before beings start acting.
  const declared = Array.isArray(bundle.meta?.extensions) ? bundle.meta.extensions : [];
  if (declared.length > 0) {
    let onDisk = new Set();
    try {
      const extensionsDir = path.resolve(__dirname, "..", "..", "..", "extensions");
      const entries = await readdir(extensionsDir, { withFileTypes: true });
      onDisk = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
    } catch { /* no extensions dir at all — everything below warns */ }
    for (const ext of declared) {
      const name = typeof ext === "string" ? ext : ext?.name;
      if (!name) continue;
      if (!onDisk.has(name)) {
        log.warn(
          "Seed",
          `planted reality expects extension "${name}"${ext?.version ? ` (v${ext.version})` : ""} ` +
          `but it is not present in extensions/. Its beings, roles, ops, and data ` +
          `will be inert until it's installed.`,
        );
      }
    }
  }

  // ── 8. Provable replay ──
  // Recompute the planted chain's reality root over what LANDED
  // (branch + reelHead rows read straight back from the DB) and
  // compare to the bundle's captured fingerprint. Match = this
  // reality IS the captured reality, mathematically. Mismatch =
  // determinism broke (or the bundle was altered) — warn loudly,
  // never silently. Anchored to the bundle's sourceReality so the
  // same chain verifies regardless of the host's own domain.
  let rootVerified = null;
  const expectedRoot = bundle.meta?.realityRoot || null;
  if (expectedRoot) {
    try {
      const { realityRootFromParts } = await import("../../past/fact/chainRoots.js");
      const [dbBranches, dbHeads] = await Promise.all([
        Branch.find({}).lean(),
        ReelHead.find({}).select("_id branch head headHash").lean(),
      ]);
      const actualRoot = realityRootFromParts({
        reality: bundle.sourceReality || null,
        branches: dbBranches,
        reelHeads: dbHeads,
      });
      rootVerified = actualRoot === expectedRoot;
      if (rootVerified) {
        log.info("Seed", `chain root VERIFIED: ${actualRoot.slice(0, 16)}… — this reality is the captured reality`);
      } else {
        log.warn("Seed", `chain root MISMATCH: expected ${expectedRoot.slice(0, 16)}…, got ${actualRoot.slice(0, 16)}… — the planted chain differs from the capture`);
      }
    } catch (err) {
      log.warn("Seed", `chain root verification failed to run: ${err.message}`);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  log.info("Seed", `genome planted in ${elapsedMs}ms`);

  return {
    counts: {
      facts:     bundle.facts.length,
      acts:      bundle.acts.length,
      branches:  bundle.branches.length,
      reelHeads: bundle.reelHeads.length,
      extensionCollections,
    },
    rootVerified,
    expectedRoot,
  };
}
