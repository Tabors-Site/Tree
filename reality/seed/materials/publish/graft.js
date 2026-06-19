// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Graft — identity-preserving transport: bring the thing ITSELF, verbatim.
//
// A graft moves a being (or a branch, or the whole reality) WITH its
// identity intact: same pubkey id, same act-chain, same fact hashes,
// byte-for-byte as it was at home. No id remapping; an imported chain is
// foreign by construction and lands by verbatim insert, never emitFact
// (the digest binds branch + provenance, so re-homing is impossible).
//
// Scope ranges across one module:
//   - captureGraft({beingId}) / applyGraft  — a BEING into a LIVING reality.
//   - capturePartialGraft                    — a coherent SUBSET of a being.
//   - captureGraft() / plantGraft            — the GENOME (whole reality at
//     the root, boot-only into an empty DB; carries realityId so the result
//     IS the same reality — a mirror/migration).
//
// The SHELL counterpart (a structural template, fresh ids on planting) is
// seedTemplate.js / seedPlant.js. See philosophy/OS/GRAFT-AND-SEED.md:
// graft brings the thing itself; seed brings the shape of the thing.
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
const SEED_CORE_COLLECTIONS = new Set(["facts", "acts", "branches", "reelHeads", "actHeads"]);
const REGENERABLE_COLLECTIONS = new Set([
  // fold caches — plant cold-folds these back from the chain
  "projections", "inbox_projection", "threads_projection", "position_projection",
  // legacy row caches of the fold (and the empty pre-rename stamps)
  "spaces", "beings", "matters", "stamps",
]);

export const GRAFT_BUNDLE_VERSION = "1.0";

// Canonical seeds folder: reality/seeds/, sibling of reality/extensions/.
// Operator artifacts (genome backups) live here, NOT inside the
// sovereign seed/ substrate folder.
// seed.js lives at reality/seed/materials/publish/graft.js
// reality/seeds is three levels up.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GRAFTS_FOLDER = path.resolve(__dirname, "..", "..", "..", "grafts");

/**
 * Capture the full reality as a portable seed bundle.
 *
 * The bundle preserves original IDs verbatim — a planted seed becomes
 * the same reality continuing on a new substrate. The substrate refuses
 * to expose a runtime plant; the receiving deployer plants at boot via
 * `genesis.js` mode.
 *
 * By default, writes the captured seed to `reality/seeds/<realityName>-<timestamp>.graft.json`.
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
export async function captureGraft(opts = {}) {
  // Scope dispatch: a beingId narrows the graft to one being (its reel,
  // act-chain, lineage). No beingId = the whole reality (genome = graft at
  // maximal scope). Same operation, same verbatim-identity discipline.
  if (opts.beingId) return captureBeingGraft(opts);
  const startedAt = Date.now();
  log.info("Graft", "capturing reality genome...");

  // ── 1. Collect every Fact ──
  // The substantive change chain. Each fact has its hash chain (p/h)
  // and per-reel seq. Plant replays these verbatim so the destination
  // chain matches the source's exactly (modulo wall-clock dates which
  // stay as-stamped).
  const facts = await Fact.find({}).sort({ seq: 1, date: 1 }).lean();
  log.info("Graft", `captured ${facts.length} facts`);

  // ── 2. Collect every Act ──
  // The experiential chain. Each act carries the cognition transcript
  // (startMessage, endMessage, innerFace) . the biography that
  // makes the reality more than a state snapshot.
  const acts = await Act.find({}).sort({ stampedAt: 1 }).lean();
  log.info("Graft", `captured ${acts.length} acts`);

  // ── 3. Collect every Branch ──
  // Branch registry: paths, branchPoints (per-reel snapshots of parent
  // heads at create-branch time), scopes, lifecycle flags.
  const branches = await Branch.find({}).lean();
  log.info("Graft", `captured ${branches.length} branches`);

  // ── 4. Collect every ReelHead ──
  // Per-reel-per-branch seq counters. Without these the receiving
  // substrate would allocate seq 1 for every reel on a fresh boot,
  // breaking the hash chain continuity from the seed's facts.
  const reelHeads = await ReelHead.find({}).lean();
  log.info("Graft", `captured ${reelHeads.length} reel heads`);

  // ── 4b. Collect every ActHead ──
  // Per-being per-branch act-chain tips. Acts are content-addressed
  // chains; the reality root covers them, so the heads are core
  // genome, not extension luggage.
  const { default: ActHead } = await import("../../past/act/actHead.js");
  const actHeads = await ActHead.find({}).lean();
  log.info("Graft", `captured ${actHeads.length} act heads`);

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
        log.info("Graft", `captured ${docs.length} docs from "${name}"`);
      }
    }
  } catch (err) {
    log.warn("Graft", `extension-collection sweep failed: ${err.message}. Core chain still captured.`);
  }

  // ── 5b. CAS blobs — the genome includes the BYTES ──
  // The chain holds facts ABOUT content; the bytes live in the
  // content store. A seed that travels to another machine must carry
  // them or the planted reality's matter resolves to nothing. Every
  // cas hash referenced by any fact travels (subject to caps, with
  // an honest omission ledger — no silent truncation). Plant puts
  // each blob and verifies its recomputed hash before the chain
  // inserts.
  const casBlobs = {};
  const casManifest = { included: [], omitted: [] };
  {
    const maxBlobBytes  = Number(opts.maxCasBlobBytes)  > 0 ? Number(opts.maxCasBlobBytes)  : 64 * 1024 * 1024;
    const maxTotalBytes = Number(opts.maxCasTotalBytes) > 0 ? Number(opts.maxCasTotalBytes) : 512 * 1024 * 1024;
    const hashes = new Set();
    const HASH_RE = /^[0-9a-f]{64}$/;
    for (const f of facts) {
      const c = f?.params?.content;
      if (c?.kind === "cas" && HASH_RE.test(c.hash || "")) hashes.add(c.hash);
      const v = f?.params?.value;
      if (v?.kind === "cas" && HASH_RE.test(v.hash || "")) hashes.add(v.hash);
    }
    if (hashes.size > 0) {
      const { getContent } = await import("../matter/contentStore.js");
      let total = 0;
      for (const hash of hashes) {
        try {
          const buf = await getContent(hash);
          if (!buf) { casManifest.omitted.push({ hash, reason: "bytes not in local store (purged/reclaimed)" }); continue; }
          if (buf.length > maxBlobBytes) { casManifest.omitted.push({ hash, size: buf.length, reason: `exceeds per-blob cap ${maxBlobBytes}` }); continue; }
          if (total + buf.length > maxTotalBytes) { casManifest.omitted.push({ hash, size: buf.length, reason: `seed cas budget ${maxTotalBytes} exhausted` }); continue; }
          casBlobs[hash] = buf.toString("base64");
          casManifest.included.push({ hash, size: buf.length });
          total += buf.length;
        } catch (err) {
          casManifest.omitted.push({ hash, reason: err?.message || "read failed" });
        }
      }
      log.info("Graft", `captured ${casManifest.included.length}/${hashes.size} content blob(s)` +
        (casManifest.omitted.length ? ` — ${casManifest.omitted.length} omitted (see casManifest)` : ""));
    }
  }

  // ── 6. Record the loaded extensions ──
  // The reality's behavior depends on which extensions are awake
  // (their roles, ops, schedules, collections). The receiving
  // deployer needs the same set for the planted reality to BE the
  // same reality; plant warns loudly about any that are missing.
  let extensions = [];
  try {
    const { getLoadedExtensionNames, getExtensionManifest } =
      await import("../../../resources/loader.js");
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
    kind: "graft",
    bundleVersion: GRAFT_BUNDLE_VERSION,
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
        actHeads:  actHeads.length,
        extensionCollections: Object.keys(extensionData).length,
      },
      // The captured reality's chain fingerprint — computed PURELY
      // over the captured arrays (not the live DB, which keeps
      // moving while capture runs). A seed's identity IS this root:
      // any substrate planting these parts must recompute the same
      // root, or determinism broke — plantGraft verifies and reports.
      // Reproducible realities by construction.
      realityRoot: await (async () => {
        try {
          const { realityRootFromParts } =
            await import("../../past/fact/chainRoots.js");
          return realityRootFromParts({
            reality: getRealityDomain() || null,
            branches,
            reelHeads,
            actHeads,
          });
        } catch { return null; }
      })(),
    },

    facts,
    acts,
    branches,
    reelHeads,
    actHeads,
    extensionData,
    casBlobs,
    casManifest,
  };

  // Sign the genome's chain fingerprint (meta.realityRoot) with the
  // reality key, so a planter proves the bundle is an AUTHENTIC genome of
  // this reality self-certifyingly — the same signed-root provenance
  // chainRoots.signedRealityRoot/verifyRealityRootSig give live, now
  // carried in the artifact. signerId = realityId (the reality pubkey id).
  if (bundle.meta?.realityRoot) {
    try {
      const { getRealityIdentity, signData } = await import("../../realityIdentity.js");
      const rid = getRealityIdentity();
      bundle.meta.realitySig = { signerId: rid.realityId, value: signData(bundle.meta.realityRoot) };
    } catch { /* unsigned genome (advisory); plant still recomputes + walks the chain */ }
  }

  const elapsedMs = Date.now() - startedAt;
  log.info("Graft", `genome captured in ${elapsedMs}ms`);

  // Default behavior: write to reality/seeds/ so there's one canonical
  // place for genome artifacts. Callers wanting the raw bundle pass
  // returnOnly: true.
  if (opts.returnOnly) return { bundle };

  await mkdir(GRAFTS_FOLDER, { recursive: true });
  const stem = (opts.realityName || bundle.sourceReality || "reality")
    .replace(/[^a-zA-Z0-9._-]/g, "-");
  const stamp = bundle.capturedAt.replace(/[:.]/g, "-").slice(0, 19);
  const savedTo = path.join(GRAFTS_FOLDER, `${stem}-${stamp}.graft.json`);
  await writeFile(savedTo, JSON.stringify(bundle));
  log.info("Graft", `genome saved to ${savedTo}`);
  return { bundle, savedTo };
}

/**
 * Validate a seed bundle's structural shape. Throws on mismatch.
 * Plant uses this before touching the substrate.
 */
export function assertValidGraft(bundle) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("seed: bundle must be an object");
  }
  if (bundle.kind !== "graft") {
    throw new Error(`graft: bundle.kind must be "graft" (got "${bundle.kind}")`);
  }
  if (bundle.bundleVersion !== GRAFT_BUNDLE_VERSION) {
    throw new Error(
      `seed: bundleVersion expected ${GRAFT_BUNDLE_VERSION}, got ${bundle.bundleVersion}`,
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
export async function plantGraft(bundle) {
  assertValidGraft(bundle);

  // ── 0. PROVENANCE gate (before touching the substrate) ──
  // If the genome carries a reality-root signature, verify it self-
  // certifyingly over meta.realityRoot — "this genome was vouched for by
  // the holder of realityId (the reality key)." The post-plant recompute
  // below then proves THIS substrate reproduces that same root. Together:
  // authentic genome AND provable replay. Absent signature is advisory
  // (older genomes). Verifiable without the DB, so it gates cold.
  {
    const rsig = bundle.meta?.realitySig;
    if (rsig?.value && bundle.meta?.realityRoot) {
      const { verifyRealityRootSig } = await import("../../past/fact/chainRoots.js");
      const ok = await verifyRealityRootSig(bundle.meta.realityRoot, rsig.signerId, rsig.value);
      if (!ok) {
        throw new Error(
          `plantGraft: genome reality-root SIGNATURE invalid (signer ` +
          `${String(rsig.signerId || "").slice(0, 14)}…) — refusing before planting.`,
        );
      }
      log.info("Graft", `genome provenance verified — vouched by ${String(rsig.signerId).slice(0, 14)}…`);
    }
  }

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
      `plantGraft: refusing to plant into a non-empty DB. Found ` +
      `facts=${factCount}, acts=${actCount}, branches=${branchCount}, ` +
      `reelHeads=${reelCount}. Wipe the DB before planting (the deployer's ` +
      `responsibility — plant is destructive by design).`,
    );
  }

  log.info("Graft", "planting reality genome...");
  const startedAt = Date.now();

  // ── 1b. CAS blobs land FIRST ──
  // Bytes before facts: by the time the chain inserts, every
  // travelling content ref resolves locally. Each blob's recomputed
  // hash MUST equal its claimed hash — a lying blob refuses the
  // plant cold (nothing inserted yet). Omitted blobs (see
  // casManifest) warn: their matter resolves to the purged marker
  // until the bytes arrive another way.
  if (bundle.casBlobs && typeof bundle.casBlobs === "object" && Object.keys(bundle.casBlobs).length > 0) {
    const { putContent } = await import("../matter/contentStore.js");
    let stored = 0;
    for (const [hash, b64] of Object.entries(bundle.casBlobs)) {
      const buf = Buffer.from(String(b64), "base64");
      const ref = await putContent(buf, { mimeType: "application/octet-stream" });
      if (ref.hash !== hash) {
        throw new Error(
          `plantGraft: CAS BLOB INTEGRITY FAILED — bundle claims ${String(hash).slice(0, 16)}… but the ` +
          `bytes hash to ${ref.hash.slice(0, 16)}…. Refusing before any chain inserts.`,
        );
      }
      stored++;
    }
    log.info("Graft", `planted ${stored} content blob(s), hash-verified`);
  }
  if (Array.isArray(bundle.casManifest?.omitted) && bundle.casManifest.omitted.length > 0) {
    log.warn("Graft", `seed omitted ${bundle.casManifest.omitted.length} content blob(s) at capture — ` +
      `their refs plant but the bytes are not here.`);
  }

  // ── 2. Branches first ──
  // Plant order matters for foreign-key-like references inside the
  // substrate's read paths. Branches are referenced by facts.branch
  // and reelHeads.branch; insert them first.
  if (bundle.branches.length > 0) {
    await Branch.insertMany(bundle.branches, { ordered: false });
    log.info("Graft", `planted ${bundle.branches.length} branches`);
  }

  // ── 3. ReelHeads ──
  // Per-reel seq counters. Needed before facts so allocSeq paths
  // don't try to re-allocate seq=1 on every reel.
  if (bundle.reelHeads.length > 0) {
    await ReelHead.insertMany(bundle.reelHeads, { ordered: false });
    log.info("Graft", `planted ${bundle.reelHeads.length} reel heads`);
  }

  // ── 3b. ActHeads ──
  // Act-chain tips. Needed before any new moment seals so the next
  // act chains from the planted biography, and before verification
  // (the reality root covers act chains).
  if (Array.isArray(bundle.actHeads) && bundle.actHeads.length > 0) {
    const { default: ActHead } = await import("../../past/act/actHead.js");
    await ActHead.insertMany(bundle.actHeads, { ordered: false });
    log.info("Graft", `planted ${bundle.actHeads.length} act heads`);
  }

  // ── 4. Facts ──
  // The substantive chain. Original _id, seq, branch, p/h hashes
  // preserved. The fold engine derives projections from these.
  if (bundle.facts.length > 0) {
    await Fact.insertMany(bundle.facts, { ordered: false });
    log.info("Graft", `planted ${bundle.facts.length} facts`);
  }

  // ── 5. Acts ──
  // The experiential chain. Original _id, beingIn/beingOut, transcripts.
  if (bundle.acts.length > 0) {
    await Act.insertMany(bundle.acts, { ordered: false });
    log.info("Graft", `planted ${bundle.acts.length} acts`);
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
        log.info("Graft", `planted ${docs.length} docs into "${name}"`);
      } catch (err) {
        log.warn("Graft", `planting collection "${name}" failed: ${err.message}`);
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
      const extensionsDir = path.resolve(__dirname, "..", "..", "..", "resources");
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
      const { default: ActHead } = await import("../../past/act/actHead.js");
      const [dbBranches, dbHeads, dbActHeads] = await Promise.all([
        Branch.find({}).lean(),
        ReelHead.find({}).select("_id branch head headHash").lean(),
        ActHead.find({}).select("_id branch headHash").lean(),
      ]);
      const actualRoot = realityRootFromParts({
        reality: bundle.sourceReality || null,
        branches: dbBranches,
        reelHeads: dbHeads,
        actHeads: dbActHeads,
      });
      rootVerified = actualRoot === expectedRoot;
      if (rootVerified) {
        log.info("Graft", `chain root VERIFIED: ${actualRoot.slice(0, 16)}… — this reality is the captured reality`);
        // ── The root proves the COMMITMENT STRUCTURE; now prove the
        // facts behind it. The planted head rows came verbatim from
        // the bundle — a bundle with tampered fact rows but original
        // heads would pass the root match alone. Walk every reel
        // (hash chain end to end, branch-aware) and every act-chain
        // back to genesis. Broken anywhere → unplant, same as a root
        // mismatch. Skippable for very large genomes via
        // opts-on-bundle escape; ON by default because "provable
        // replay" should mean the proof actually ran.
        if (bundle.skipChainWalk !== true) {
          const { verifyReel } = await import("../../past/fact/verifyReel.js");
          const { verifyActChain } = await import("../../past/act/actHash.js");
          const broken = [];
          let reelsWalked = 0;
          let actsWalked = 0;
          for (const rh of dbHeads) {
            const v = await verifyReel(rh.type ?? rh._id?.split(":")[1], rh.id ?? rh._id?.split(":")[2], rh.branch || "0");
            reelsWalked++;
            if (!v.ok) broken.push({ kind: "reel", key: rh._id, reason: v.reason, at: v.brokenAt });
          }
          for (const ah of dbActHeads) {
            const beingId = ah.beingId ?? ah._id?.split(":")[1];
            const v = await verifyActChain(ah.branch || "0", beingId);
            actsWalked++;
            if (!v.ok) broken.push({ kind: "act-chain", key: ah._id, reason: v.reason, at: v.brokenAt });
          }
          if (broken.length > 0) {
            rootVerified = false;
            log.warn("Graft", `chain walk FAILED on ${broken.length} chain(s): ` +
              broken.slice(0, 5).map((b) => `${b.kind}:${b.key}(${b.reason})`).join(", ") +
              (broken.length > 5 ? ` …+${broken.length - 5}` : ""));
          } else {
            log.info("Graft", `chain walk VERIFIED: ${reelsWalked} reel(s) + ${actsWalked} act-chain(s) recompute end to end`);
          }
        }
      }
      if (!rootVerified) {
        // ── UNPLANT ──
        // The planted chain does not reproduce the captured root: the
        // bundle was altered or determinism broke. Plant runs against
        // an EMPTY substrate (gated above), so "back to before the
        // attempt" is emptiness — remove everything this plant
        // inserted, loudly, and refuse. (This is the plant-time
        // sibling of graft's compensating rollback: graft unstamps
        // into a LIVING chain with end-X facts; plant restores the
        // void it started from. No pre-existing chain is touched —
        // there wasn't one.)
        const why = actualRoot === expectedRoot
          ? "chain walk found broken chains behind a matching root (tampered facts under original heads)"
          : `chain root MISMATCH: expected ${expectedRoot.slice(0, 16)}…, got ${actualRoot.slice(0, 16)}…`;
        log.warn("Graft", `${why} — UNPLANTING`);
        try {
          const db = mongoose.connection.db;
          const toClear = ["facts", "acts", "branches", "reelHeads", "actHeads"];
          for (const name of Object.keys(bundle.extensionData || {})) {
            if (!name.startsWith("system.")) toClear.push(name);
          }
          for (const name of toClear) {
            try { await db.collection(name).deleteMany({}); } catch { /* collection may not exist */ }
          }
          const { invalidateBranchCache } = await import("../branch/branches.js");
          invalidateBranchCache(null);
          log.warn("Graft", `unplanted ${toClear.length} collection(s); the substrate is empty again. ` +
            `Planted content blobs stay in the store under their true hashes (the retention sweeper owns orphans).`);
        } catch (unplantErr) {
          log.error("Graft", `UNPLANT FAILED: ${unplantErr.message} — the substrate may hold a partial, ` +
            `unverified chain. Wipe the DB before booting.`);
        }
        throw new Error(
          `plantGraft: chain verification failed (${why}). ` +
          `The plant was rolled back; the substrate is empty.`,
        );
      }
    } catch (err) {
      if (/chain verification failed/.test(err?.message || "")) throw err;
      log.warn("Graft", `chain root verification failed to run: ${err.message}`);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  log.info("Graft", `genome planted in ${elapsedMs}ms`);

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

// ─────────────────────────────────────────────────────────────────────
// BEING GRAFT — identity-preserving transport of ONE being into a
// LIVING reality. Scope below the genome: the being's own reel + its
// full act-chain + its lineage, carried VERBATIM (original pubkey id,
// original fact/act hashes), deduped by pubkey on arrival. See
// philosophy/OS/GRAFT-AND-SEED.md.
// ─────────────────────────────────────────────────────────────────────

/**
 * Capture ONE being as an identity-preserving graft bundle. The being's
 * own reel (be:birth + its be-acts + do:set-being + its summons), its
 * full act-chain, the lineage Branch rows its facts span, the per-branch
 * reel/act heads, and the CAS blobs its facts reference — all VERBATIM
 * (original ids, original p/h hashes). meta.lineage carries parentBeingId
 * + homeReality (bare refs; the referenced beings need NOT be present on
 * the target). meta.graftRoot is the scoped fingerprint; meta.graftSig is
 * this reality vouching for the extract.
 */
async function captureBeingGraft(opts) {
  const beingId = String(opts.beingId);
  const reality = getRealityDomain() || null;
  const { default: ActHead } = await import("../../past/act/actHead.js");
  const { actHeadKey } = await import("../../past/act/actHash.js");
  const { reelKey } = await import("../../past/reel/reelHeads.js");
  const { loadBranch } = await import("../branch/branches.js");
  const { loadOrFold } = await import("../projections.js");
  const { graftRootFromParts } = await import("../../past/fact/chainRoots.js");

  // The being's OWN reel (single-writer: every fact here has the being as
  // its actor) + its full act-chain.
  const facts = await Fact.find({ "of.kind": "being", "of.id": beingId }).sort({ seq: 1 }).lean();
  const acts = await Act.find({ through: beingId }).sort({ stampedAt: 1 }).lean();

  // Lineage branches: every distinct non-main branch the being touched,
  // plus its ancestor chain, so resolveBranchLineage resolves on the
  // target. Main ("0") is implicit (no Branch row).
  const branchSet = new Set();
  for (const f of facts) branchSet.add(String(f.branch ?? "0"));
  for (const a of acts) branchSet.add(String(a.branch ?? "0"));
  branchSet.delete("0");
  const branchById = new Map();
  for (const b of branchSet) {
    let cur = b;
    while (cur && cur !== "0" && !branchById.has(cur)) {
      const row = await loadBranch(cur);
      if (!row) break;
      branchById.set(cur, row);
      cur = row.parent ? String(row.parent) : null;
    }
  }
  const branches = [...branchById.values()];

  // Per-branch heads (the being's reel + act-chain tips). Include main.
  const allBranches = [...new Set([...branchSet, "0", ...branchById.keys()])];
  const reelKeys = allBranches.map((br) => reelKey(br, "being", beingId));
  const actKeys = allBranches.map((br) => actHeadKey(br, beingId));
  const reelHeads = await ReelHead.find({ _id: { $in: reelKeys } }).lean();
  const actHeads = await ActHead.find({ _id: { $in: actKeys } }).lean();

  // Lineage refs from the being's current projection.
  const slot = await loadOrFold("being", beingId, opts.branch || "0");
  const lineage = {
    parentBeingId: slot?.state?.parentBeingId ?? null,
    homeReality: slot?.state?.homeReality ?? reality,
  };

  // CAS blobs referenced by the being's facts (rare on a being reel, but a
  // do:set-being can carry a cas-backed quality value). Same store-by-true-
  // hash discipline the genome uses.
  const casBlobs = {};
  const casManifest = { included: [], omitted: [] };
  {
    const HASH_RE = /^[0-9a-f]{64}$/;
    const hashes = new Set();
    for (const f of facts) {
      for (const c of [f?.params?.content, f?.params?.value]) {
        if (c?.kind === "cas" && HASH_RE.test(c.hash || "")) hashes.add(c.hash);
      }
    }
    if (hashes.size > 0) {
      const { getContent } = await import("../matter/contentStore.js");
      for (const hash of hashes) {
        try {
          const buf = await getContent(hash);
          if (!buf) { casManifest.omitted.push({ hash, reason: "bytes not in local store" }); continue; }
          casBlobs[hash] = buf.toString("base64");
          casManifest.included.push({ hash, size: buf.length });
        } catch (err) { casManifest.omitted.push({ hash, reason: err?.message || "read failed" }); }
      }
    }
  }

  const graftRoot = graftRootFromParts({ beingId, reelHeads, actHeads });
  const bundle = {
    kind: "graft",
    bundleVersion: GRAFT_BUNDLE_VERSION,
    sourceReality: reality,
    capturedAt: new Date().toISOString(),
    capturedBy: opts.capturedBy || null,
    meta: {
      beingId,
      lineage,
      graftRoot,
      counts: { facts: facts.length, acts: acts.length, branches: branches.length, reelHeads: reelHeads.length, actHeads: actHeads.length },
    },
    facts, acts, branches, reelHeads, actHeads, casBlobs, casManifest,
  };
  // Provenance: this reality vouches the extract is authentic. signerId =
  // realityId (a pubkey id a foreign receiver decodes from the id alone).
  try {
    const { getRealityIdentity, signData } = await import("../../realityIdentity.js");
    const rid = getRealityIdentity();
    bundle.meta.graftSig = { signerId: rid.realityId, value: signData(graftRoot) };
  } catch { /* unsigned extract (advisory) */ }

  log.info("Graft", `captured being ${beingId.slice(0, 12)}… — ${facts.length} fact(s), ${acts.length} act(s), ${branches.length} lineage branch(es)`);
  return { bundle };
}

/**
 * Capture a PARTIAL graft — a coherent SUBSET of a being's chain (the four
 * mechanisms in GRAFT-AND-SEED.md). What is partial is the HISTORY available,
 * never the identity: the pubkey id is the same, the included facts verify,
 * the being is unambiguously itself.
 *
 * Four mechanisms. Three share one reel-capture path, distinguished by where
 * the captured range starts; the fourth carries no reel at all:
 *
 *   "genesis-prefix"     — the reel from seq 1 to a cutoff. COMPLETE FROM
 *     GENESIS, so it carries the being's birth and verifies/folds with the
 *     stock verifyReel (no anchor). A later full/longer graft MERGES the tail.
 *
 *   "checkpoint-segment" — a contiguous SUFFIX [fromSeq..toSeq] on one branch,
 *     anchored at the head hash of the fact immediately before fromSeq (carried
 *     as a signed checkpoint, NOT the fact itself). Verifies with the Phase-2
 *     verifyReelFrom seeded at that anchor. "Bring my recent history, provably
 *     mine, without my whole life" — a verifiable reference import.
 *
 *   "single-branch"      — every fact of the being that LIVES on one fork
 *     (branch === opts.branch, a non-main path), anchored at the FORK-POINT
 *     head on the parent. The fork's lineage Branch rows ride along so the
 *     receiver resolves the branch and verifyReelFrom checks only the fork's
 *     slice. "Bring one project's worth of my activity." Same anchored verify
 *     as checkpoint-segment, with a branchPoint anchor + carried lineage.
 *
 *   "state-snapshot"     — NO reel. A signed photo of the being's CURRENT
 *     folded state, as-of its head. The receiver trusts the attested state
 *     without replaying any chain (the one projection not folded from local
 *     facts). Its own bundle shape and apply path (applyStateSnapshot).
 *
 * The anchor of an anchored mechanism is committed transitively by the segment
 * hash chain → graftRoot → graftSig, so it cannot be forged past the cold
 * provenance gate. What is partial is the HISTORY, never the identity: same
 * pubkey id, the included facts verify, the being is unambiguously itself.
 * meta.partial declares the shape so the receiver knows what is missing and how
 * to answer history queries beyond the extract.
 *
 * @param {object} opts { beingId, mechanism?, cutoffSeq, fromSeq?, toSeq?, branch?, beyondExtract?, capturedBy? }
 *   genesis-prefix needs cutoffSeq; checkpoint-segment needs fromSeq (>=2);
 *   single-branch needs branch (a non-main fork); state-snapshot needs neither.
 * @returns {Promise<{ bundle }>}
 */
export async function capturePartialGraft(opts = {}) {
  const beingId = String(opts.beingId || "");
  if (!beingId) throw new Error("capturePartialGraft: opts.beingId is required");
  const mechanism = opts.mechanism || "genesis-prefix";
  const KNOWN = ["genesis-prefix", "checkpoint-segment", "single-branch", "state-snapshot"];
  if (!KNOWN.includes(mechanism)) {
    throw new Error(`capturePartialGraft: mechanism must be one of ${KNOWN.join(" / ")}`);
  }
  const branch = opts.branch || "0";
  const reality = getRealityDomain() || null;
  const { reelKey } = await import("../../past/reel/reelHeads.js");
  const { graftRootFromParts } = await import("../../past/fact/chainRoots.js");
  const { loadOrFold } = await import("../projections.js");

  // ── state-snapshot: no reel. A signed photo of the being's CURRENT folded
  // state, as-of its reel head. The receiver trusts the attested state without
  // replaying any chain. This is the one place a projection exists without a
  // backing local reel: an attested FOREIGN state, the state-level twin of
  // "imported facts are foreign by construction." It has its own bundle shape
  // (a `snapshot` block, empty reel/act collections), so it returns early. ──
  if (mechanism === "state-snapshot") {
    const { computeHash, GENESIS_PREV } = await import("../../past/fact/hash.js");
    const snap = await loadOrFold("being", beingId, branch);
    if (!snap || !snap.state || Object.keys(snap.state).length === 0) {
      throw new Error(`capturePartialGraft: being ${beingId.slice(0, 10)}… does not fold on branch ${branch} (nothing to snapshot)`);
    }
    const reelHeadRow = await ReelHead.findById(reelKey(branch, "being", beingId)).lean();
    const atHead = reelHeadRow?.headHash || GENESIS_PREV;
    const atSeq = reelHeadRow?.head ?? null;
    const state = snap.state;
    // Hash the state, then bind it, the head, and the being into one signed root.
    const stateHash = computeHash(GENESIS_PREV, state);
    const snapshotRoot = computeHash(GENESIS_PREV, { kind: "state-snapshot", beingId, branch, atHead, atSeq, stateHash });
    const bundle = {
      kind: "graft",
      bundleVersion: GRAFT_BUNDLE_VERSION,
      sourceReality: reality,
      capturedAt: new Date().toISOString(),
      capturedBy: opts.capturedBy || null,
      meta: {
        beingId,
        lineage: { parentBeingId: state.parentBeingId ?? null, homeReality: state.homeReality ?? reality },
        graftRoot: snapshotRoot,
        partial: { mechanism: "state-snapshot", branch, atHead, atSeq, stateHash, beyondExtract: opts.beyondExtract || "refuse" },
        counts: { facts: 0, acts: 0, branches: 0, reelHeads: 0, actHeads: 0 },
      },
      snapshot: { state, branch, atHead, atSeq },
      facts: [], acts: [], branches: [], reelHeads: [], actHeads: [], casBlobs: {}, casManifest: { included: [], omitted: [] },
    };
    try {
      const { getRealityIdentity, signData } = await import("../../realityIdentity.js");
      bundle.meta.graftSig = { signerId: getRealityIdentity().realityId, value: signData(snapshotRoot) };
    } catch { /* unsigned extract (advisory) */ }
    log.info("Graft", `captured state-snapshot of being ${beingId.slice(0, 12)}… — as-of seq ${atSeq} (head ${String(atHead).slice(0, 10)}…), no reel`);
    return { bundle };
  }

  // ── reel-based mechanisms (genesis-prefix / checkpoint-segment / single-
  // branch): capture the chosen range of the being's reel + the partial
  // descriptor declaring its shape, plus (single-branch) the fork's lineage
  // Branch rows so the receiver can resolve and verify the branch. ──
  let facts, partialMeta;
  let captureBranch = branch;
  let branchesToCarry = [];
  if (mechanism === "genesis-prefix") {
    const cutoffSeq = Number(opts.cutoffSeq);
    if (!(Number.isInteger(cutoffSeq) && cutoffSeq > 0)) {
      throw new Error("capturePartialGraft: cutoffSeq must be a positive integer");
    }
    // The being's reel on `branch`, seq 1..cutoff — a genesis-rooted prefix.
    facts = await Fact.find({ "of.kind": "being", "of.id": beingId, branch, seq: { $lte: cutoffSeq } }).sort({ seq: 1 }).lean();
    if (facts.length === 0) {
      throw new Error(`capturePartialGraft: no facts on being ${beingId.slice(0, 10)}… reel (branch ${branch}) at or before seq ${cutoffSeq}`);
    }
    partialMeta = { mechanism: "genesis-prefix", branch, cutoffSeq: facts[facts.length - 1].seq, beyondExtract: opts.beyondExtract || "refuse" };
  } else if (mechanism === "checkpoint-segment") {
    // A contiguous SUFFIX [fromSeq..toSeq?] on `branch`. fromSeq must be >= 2
    // (fromSeq 1 IS a genesis-prefix). The anchor is the prev-hash the first
    // segment fact already chains to — carried as the checkpoint; the fact
    // before fromSeq is NOT included.
    const fromSeq = Number(opts.fromSeq);
    if (!(Number.isInteger(fromSeq) && fromSeq >= 2)) {
      throw new Error("capturePartialGraft: checkpoint-segment fromSeq must be an integer >= 2 (fromSeq 1 is a genesis-prefix)");
    }
    const seqFilter = { $gte: fromSeq };
    if (opts.toSeq != null) seqFilter.$lte = Number(opts.toSeq);
    facts = await Fact.find({ "of.kind": "being", "of.id": beingId, branch, seq: seqFilter }).sort({ seq: 1 }).lean();
    if (facts.length === 0) {
      throw new Error(`capturePartialGraft: no facts on being ${beingId.slice(0, 10)}… reel (branch ${branch}) at seq ${fromSeq}..`);
    }
    if (facts[0].seq !== fromSeq) {
      throw new Error(`capturePartialGraft: reel has no fact at seq ${fromSeq} (a checkpoint-segment must be contiguous from fromSeq)`);
    }
    const anchorPrev = String(facts[0].p);
    partialMeta = {
      mechanism: "checkpoint-segment", branch, fromSeq, cutoffSeq: facts[facts.length - 1].seq,
      // The signed checkpoint: "at seq fromSeq-1 this reel's head was anchorPrev."
      // The receiver seeds verifyReelFrom here; the value is committed
      // transitively by the segment chain, so graftSig already vouches it.
      checkpoint: { branch, seq: fromSeq - 1, headHash: anchorPrev },
      beyondExtract: opts.beyondExtract || "refuse",
    };
  } else {
    // single-branch: every fact of the being that LIVES on a fork (branch ===
    // targetBranch), the divergent slice after the fork point. The inherited
    // parent prefix is shared history the being already holds on the parent
    // line and is NOT brought. Anchored at the fork-point head (the prev-hash
    // the fork's first fact chains to). The fork's lineage Branch rows ride
    // along so the receiver can resolveBranchLineage + verifyReelFrom on it.
    const { isMain, loadBranch } = await import("../branch/branches.js");
    const targetBranch = opts.branch;
    if (!targetBranch || isMain(targetBranch)) {
      throw new Error("capturePartialGraft: single-branch requires a non-main branch (main is the trunk — use genesis-prefix or checkpoint-segment there)");
    }
    captureBranch = targetBranch;
    facts = await Fact.find({ "of.kind": "being", "of.id": beingId, branch: targetBranch }).sort({ seq: 1 }).lean();
    if (facts.length === 0) {
      throw new Error(`capturePartialGraft: being ${beingId.slice(0, 10)}… has no facts on branch ${targetBranch}`);
    }
    const anchorPrev = String(facts[0].p);
    const fromSeq = facts[0].seq;
    // The fork + its non-main ancestors, so the receiver can resolve the lineage.
    const seen = new Set();
    let cur = targetBranch;
    while (cur && !isMain(cur) && !seen.has(cur)) {
      seen.add(cur);
      const row = await loadBranch(cur);
      if (!row) break;
      branchesToCarry.push(row);
      cur = row.parent ? String(row.parent) : null;
    }
    const parentBranch = branchesToCarry[0]?.parent != null ? String(branchesToCarry[0].parent) : "0";
    partialMeta = {
      mechanism: "single-branch", branch: targetBranch, fromSeq, cutoffSeq: facts[facts.length - 1].seq,
      // The fork-point anchor: at the parent's head where this branch split, the
      // reel head was anchorPrev (the fork's first fact chains to it).
      checkpoint: { branch: parentBranch, seq: fromSeq - 1, headHash: anchorPrev },
      beyondExtract: opts.beyondExtract || "refuse",
    };
  }

  const head = facts[facts.length - 1];
  // A reelHead AT the captured tip (on the capture branch), so the landed
  // extract records its lawful tip and a later graft can advance from it.
  const reelHeads = [{ _id: reelKey(captureBranch, "being", beingId), type: "being", id: beingId, branch: captureBranch, head: head.seq, headHash: String(head._id) }];

  const slot = await loadOrFold("being", beingId, captureBranch);
  const lineage = { parentBeingId: slot?.state?.parentBeingId ?? null, homeReality: slot?.state?.homeReality ?? reality };
  const graftRoot = graftRootFromParts({ beingId, reelHeads, actHeads: [] });

  const bundle = {
    kind: "graft",
    bundleVersion: GRAFT_BUNDLE_VERSION,
    sourceReality: reality,
    capturedAt: new Date().toISOString(),
    capturedBy: opts.capturedBy || null,
    meta: {
      beingId,
      lineage,
      graftRoot,
      partial: partialMeta,
      counts: { facts: facts.length, acts: 0, branches: branchesToCarry.length, reelHeads: 1, actHeads: 0 },
    },
    facts, acts: [], branches: branchesToCarry, reelHeads, actHeads: [], casBlobs: {}, casManifest: { included: [], omitted: [] },
  };
  try {
    const { getRealityIdentity, signData } = await import("../../realityIdentity.js");
    bundle.meta.graftSig = { signerId: getRealityIdentity().realityId, value: signData(graftRoot) };
  } catch { /* unsigned extract (advisory) */ }

  const logLine = {
    "genesis-prefix":     `captured genesis-prefix of being ${beingId.slice(0, 12)}… — seq 1..${head.seq} (${facts.length} fact(s))`,
    "checkpoint-segment": `captured checkpoint-segment of being ${beingId.slice(0, 12)}… — seq ${partialMeta.fromSeq}..${head.seq} anchored at ${String(facts[0].p).slice(0, 10)}… (${facts.length} fact(s))`,
    "single-branch":      `captured single-branch of being ${beingId.slice(0, 12)}… — branch ${captureBranch} seq ${partialMeta.fromSeq}..${head.seq}, ${branchesToCarry.length} lineage branch(es) (${facts.length} fact(s))`,
  }[mechanism];
  log.info("Graft", logLine);
  return { bundle };
}

/**
 * Apply a being-graft bundle into THIS (living) reality, preserving the
 * being's identity verbatim. NO id remapping — the pubkey id and every
 * fact/act hash land byte-identical (the digest binds branch + provenance,
 * so re-homing is impossible; an imported chain is foreign by construction
 * and goes in by verbatim insert, never emitFact).
 *
 * Verify ladder BEFORE any insert (refuse cold): graftSig provenance →
 * CAS hash-verify → recompute EVERY fact/act _id in memory → dedup by
 * pubkey. Then verbatim insert of only the rows the target lacks; verify
 * the landed chain; compensating-facts rollback on any failure (standalone
 * Mongo, no transactions).
 *
 * @param {object} bundle              a being-graft bundle (meta.beingId set)
 * @param {object} opts
 * @param {string} opts.operatorBeingId who is grafting (for the audit fact)
 * @param {string} [opts.branch="0"]    the branch the audit fact rides
 * @returns {Promise<{ beingId, mode, counts, verified }>}
 */
export async function applyGraft(bundle, opts = {}) {
  assertValidGraft(bundle);
  const beingId = bundle?.meta?.beingId;
  if (!beingId || typeof beingId !== "string") {
    throw new Error("applyGraft: bundle.meta.beingId is required (this is a being-graft, not a genome — use plantGraft for a genome)");
  }
  if (!opts.operatorBeingId) {
    throw new Error("applyGraft: opts.operatorBeingId is required (the grafter, for the audit fact)");
  }
  // state-snapshot carries no reel: route to the dedicated attested-state apply
  // (its whole verify ladder is sig + state-hash + root, not a chain walk).
  if (bundle.meta?.partial?.mechanism === "state-snapshot") {
    return await applyStateSnapshot(bundle, opts);
  }
  const branch = opts.branch || "0";
  const { computeHash, contentOf, GENESIS_PREV } = await import("../../past/fact/hash.js");
  const { computeActId, contentOfAct } = await import("../../past/act/actHash.js");
  const { default: ActHead } = await import("../../past/act/actHead.js");
  const { withBeingAct } = await import("../../sprout.js");
  const { emitFact } = await import("../../past/fact/facts.js");

  // ── 1. Provenance gate (cold, FAIL-CLOSED) ──
  // A graft into a LIVING reality requires the source's signature over the
  // extract, verified self-certifyingly against signerId (the source
  // realityId) — no callback. opts.allowUnsigned is the explicit escape for
  // a trusted local extract (e.g. a same-reality restore).
  if (bundle.meta?.graftSig?.value && bundle.meta?.graftRoot) {
    const { isKeyId } = await import("../name/keys.js");
    const { verifyRealityRootSig } = await import("../../past/fact/chainRoots.js");
    const sg = bundle.meta.graftSig;
    const ok = isKeyId(sg.signerId)
      ? await verifyRealityRootSig(bundle.meta.graftRoot, sg.signerId, sg.value)
      : false;
    if (!ok) throw new Error(`applyGraft: graft SIGNATURE invalid (signer ${String(sg.signerId || "").slice(0, 14)}…). Refusing before any insert.`);
  } else if (!opts.allowUnsigned) {
    throw new Error("applyGraft: unsigned graft refused — a signed graftRoot (meta.graftSig) is required. Pass opts.allowUnsigned only for a trusted local extract.");
  }

  // ── 2. CAS blobs land first (cold hash-verify) ──
  if (bundle.casBlobs && Object.keys(bundle.casBlobs).length > 0) {
    const { putContent } = await import("../matter/contentStore.js");
    for (const [hash, b64] of Object.entries(bundle.casBlobs)) {
      const buf = Buffer.from(String(b64), "base64");
      const stored = await putContent(buf, { mimeType: "application/octet-stream" });
      if (stored.hash !== hash) {
        throw new Error(`applyGraft: CAS BLOB INTEGRITY FAILED — claims ${hash.slice(0, 16)}… but bytes hash ${stored.hash.slice(0, 16)}…. Refusing.`);
      }
    }
  }

  // ── 3. SCOPE gate (cold): every row must BELONG to meta.beingId ──
  // Rows are hash-valid by construction, so the recompute gate below does
  // NOT stop a maliciously-assembled bundle that splices in hash-valid rows
  // targeting OTHER reels. Bind the whole graft to the being: facts on its
  // own reel, acts it authored, heads keyed to it. A being-graft is single-
  // writer on its OWN reel; nothing here may write another being's.
  for (const f of bundle.facts) {
    if (!(f.of && f.of.kind === "being" && String(f.of.id) === beingId)) {
      throw new Error(`applyGraft: BUNDLE SCOPE VIOLATION — a fact targets ${f.of?.kind}:${String(f.of?.id || "").slice(0, 10)}…, not the grafted being's reel. Refusing.`);
    }
  }
  for (const a of bundle.acts) {
    if (String(a.through) !== beingId) {
      throw new Error(`applyGraft: BUNDLE SCOPE VIOLATION — an act is authored by ${String(a.through || "").slice(0, 10)}…, not the grafted being. Refusing.`);
    }
  }
  for (const rh of bundle.reelHeads || []) {
    if (String(rh._id).split(":").slice(1).join(":") !== `being:${beingId}`) {
      throw new Error(`applyGraft: BUNDLE SCOPE VIOLATION — reelHead ${rh._id} is not the grafted being's reel. Refusing.`);
    }
  }
  for (const ah of bundle.actHeads || []) {
    if (String(ah._id).split(":").slice(1).join(":") !== String(beingId)) {
      throw new Error(`applyGraft: BUNDLE SCOPE VIOLATION — actHead ${ah._id} is not the grafted being's act-chain. Refusing.`);
    }
  }

  // ── 4. Recompute EVERY fact/act _id in memory (cold tamper gate) ──
  for (const f of bundle.facts) {
    if (typeof f._id !== "string" || computeHash(f.p, contentOf(f)) !== f._id) {
      throw new Error(`applyGraft: FACT INTEGRITY FAILED — fact at seq ${f.seq} (${String(f._id).slice(0, 12)}…) does not reproduce its hash. Refusing before any insert.`);
    }
  }
  for (const a of bundle.acts) {
    if (typeof a._id !== "string" || computeActId(a.p, contentOfAct(a)) !== a._id) {
      throw new Error(`applyGraft: ACT INTEGRITY FAILED — act ${String(a._id).slice(0, 12)}… does not reproduce its hash. Refusing before any insert.`);
    }
  }
  // NOTE: the act SEAL signature (act.sig — which additionally binds an act's
  // full ΔF factIds) is NOT re-verified here. A being-scoped bundle carries
  // the being's REEL, not every fact its acts produced on other reels, so the
  // ΔF can't be reconstructed from the bundle alone. The act IDENTITY
  // (computeActId, which binds through) + the SCOPE gate (through === being)
  // + the post-insert verifyActChain prove the chain. Full seal-sig
  // re-verification waits on the subtree-scoped graft (which carries the ΔF).

  // ── 5. Dedup by pubkey ──
  const factIds = bundle.facts.map((f) => String(f._id));
  const actIds = bundle.acts.map((a) => String(a._id));
  const haveFacts = new Set((await Fact.find({ _id: { $in: factIds } }).select("_id").lean()).map((r) => String(r._id)));
  const haveActs = new Set((await Act.find({ _id: { $in: actIds } }).select("_id").lean()).map((r) => String(r._id)));
  const newFacts = bundle.facts.filter((f) => !haveFacts.has(String(f._id)));
  const newActs = bundle.acts.filter((a) => !haveActs.has(String(a._id)));
  // Mode from the FACTS present, not the projection cache (applyGraft inserts
  // verbatim and does NOT fold — fold-on-read derives the projection later, so
  // the cache is empty right after a graft): nothing present → create; all
  // present → idempotent (re-graft); some present → merge (append the tail).
  const mode = haveFacts.size === 0 ? "create" : (newFacts.length === 0 ? "idempotent" : "merge");

  // ── 6. Reel-divergence gate (cold) ──
  // A (branch, seq) on the being's reel that the target already holds with
  // DIFFERENT content (different _id) is a FORK. The unique (branch, target,
  // seq) index would throw mid-insert; catch it cold and refuse — a graft
  // preserves the reel verbatim, it never forks it.
  if (newFacts.length > 0) {
    const wantBySeq = new Map();
    for (const f of newFacts) wantBySeq.set(`${String(f.branch ?? "0")}:${f.seq}`, String(f._id));
    const seqs = [...new Set(newFacts.map((f) => f.seq))];
    const clash = await Fact.find({ "of.kind": "being", "of.id": beingId, seq: { $in: seqs } }).select("_id seq branch").lean();
    for (const e of clash) {
      const want = wantBySeq.get(`${String(e.branch ?? "0")}:${e.seq}`);
      if (want && want !== String(e._id)) {
        throw new Error(`applyGraft: REEL DIVERGENCE — target already holds (branch ${e.branch ?? "0"}, seq ${e.seq}) with different content. Refusing (a graft preserves the reel verbatim).`);
      }
    }
  }

  // ── 7. Branch gate (cold): absent → insert; SAME (parent+branchPoint) →
  // ok; DIFFERENT → refuse. Comparing parent alone misses a same-path/same-
  // parent/different-branchPoint row, so compare branchPoint too.
  const newBranches = [];
  const normBP = (bp) => (bp instanceof Map ? Object.fromEntries(bp) : (bp || {}));
  const bpKey = (bp) => JSON.stringify(Object.entries(normBP(bp)).sort());
  for (const b of bundle.branches || []) {
    const existing = await Branch.findById(b._id).lean();
    if (!existing) { newBranches.push(b); continue; }
    if (existing.parent !== b.parent || bpKey(existing.branchPoint) !== bpKey(b.branchPoint)) {
      throw new Error(`applyGraft: BRANCH COLLISION — path "${b._id}" already exists on the target with a different parent/branchPoint. Refusing (a graft preserves branch paths verbatim).`);
    }
  }

  // ── 8. ActHead fork gate (cold): never regress the chain tip. A present
  // actHead whose head differs is admitted ONLY when the bundle EXTENDS it
  // (target head is an ancestor of the bundle head, walked within the
  // bundle's own acts). Otherwise it's a fork — refuse.
  const actPrevById = new Map(bundle.acts.map((a) => [String(a._id), String(a.p)]));
  const advanceActHeads = [];
  for (const ah of bundle.actHeads || []) {
    const existing = await ActHead.findById(ah._id).lean();
    if (!existing) continue;                                    // create path (step 9)
    if (!ah.headHash || ah.headHash === existing.headHash) continue; // equal: noop
    let h = String(ah.headHash); let reaches = false;
    for (let guard = 0; h && h !== GENESIS_PREV && guard < 200000; guard++) {
      if (h === String(existing.headHash)) { reaches = true; break; }
      if (!actPrevById.has(h)) break;
      h = actPrevById.get(h);
    }
    if (!reaches) {
      throw new Error(`applyGraft: ACT-CHAIN FORK — the target's act-chain head for ${ah._id} is not an ancestor of the grafted head. Refusing (won't regress the chain).`);
    }
    advanceActHeads.push(ah);
  }

  // ── 9. Verbatim insert ──
  // landed[] is recorded BEFORE each insertMany: insertMany(ordered:false)
  // COMMITS the non-failing docs then throws, so recording after would miss
  // the committed rows on a partial failure. deleteOne on a never-inserted
  // _id is a harmless no-op, so rollback then removes exactly what landed.
  const landed = [];
  const counts = { facts: 0, acts: 0, branches: 0 };
  try {
    if (newBranches.length > 0) {
      for (const b of newBranches) landed.push({ coll: "Branch", id: b._id });
      await Branch.insertMany(newBranches, { ordered: false });
      counts.branches = newBranches.length;
    }
    // ReelHeads: create when absent; advance-only when present (never regress).
    for (const rh of bundle.reelHeads || []) {
      const existing = await ReelHead.findById(rh._id).select("head").lean();
      if (!existing) { landed.push({ coll: "ReelHead", id: rh._id }); await ReelHead.create(rh); }
      else if ((rh.head || 0) > (existing.head || 0)) { await ReelHead.updateOne({ _id: rh._id }, { $set: { head: rh.head, headHash: rh.headHash } }); }
    }
    // ActHeads: create when absent; the advance set was vetted as fork-free above.
    for (const ah of bundle.actHeads || []) {
      const existing = await ActHead.findById(ah._id).lean();
      if (!existing) { landed.push({ coll: "ActHead", id: ah._id }); await ActHead.create(ah); }
    }
    for (const ah of advanceActHeads) { await ActHead.updateOne({ _id: ah._id }, { $set: { headHash: ah.headHash } }); }
    if (newFacts.length > 0) {
      for (const f of newFacts) landed.push({ coll: "Fact", id: f._id });
      await Fact.insertMany(newFacts, { ordered: false });
      counts.facts = newFacts.length;
    }
    if (newActs.length > 0) {
      for (const a of newActs) landed.push({ coll: "Act", id: a._id });
      await Act.insertMany(newActs, { ordered: false });
      counts.acts = newActs.length;
    }

    // ── 10. Verify the landed chain (verbatim heads must reproduce). Verify
    // every branch that received a fact/act, not just the ones with a
    // captured head row (a fact on a head-less branch must verify too). ──
    const { verifyActChain } = await import("../../past/act/actHash.js");
    const partial = bundle.meta?.partial;
    if (partial?.mechanism === "checkpoint-segment" || partial?.mechanism === "single-branch") {
      // A non-genesis-rooted segment, anchored at a signed checkpoint hash:
      //   checkpoint-segment — anchor is an earlier head on the SAME branch.
      //   single-branch      — anchor is the fork-point head on the PARENT.
      // Both verify with the Phase-2 verifyReelFrom seeded at that anchor (the
      // branch's lineage Branch rows landed in step 7, so the range resolves).
      // The anchor is committed transitively by the segment chain → graftRoot →
      // graftSig (verified cold in step 1), so a tampered anchor cannot survive.
      // Genesis-rooted verifyReel would (correctly) seq-gap here.
      const { verifyReelFrom } = await import("../../past/fact/verifyReelFrom.js");
      const cp = partial.checkpoint || {};
      const segBranch = partial.branch || branch;
      const v = await verifyReelFrom("being", beingId, segBranch, { fromSeq: partial.fromSeq, anchorPrev: String(cp.headHash || GENESIS_PREV) });
      if (!v.ok) throw new Error(`applyGraft: POST-GRAFT segment verification FAILED on being:${beingId.slice(0, 8)}@${segBranch} (${v.reason} at ${v.brokenAt}); anchor ${String(cp.headHash || "").slice(0, 10)}….`);
    } else {
      const { verifyReel } = await import("../../past/fact/verifyReel.js");
      const reelBranches = [...new Set([...(bundle.reelHeads || []).map((r) => String(r._id).split(":")[0]), ...newFacts.map((f) => String(f.branch ?? "0"))])];
      for (const br of reelBranches) {
        const v = await verifyReel("being", beingId, br);
        if (!v.ok) throw new Error(`applyGraft: POST-GRAFT reel verification FAILED on being:${beingId.slice(0, 8)}@${br} (${v.reason} at ${v.brokenAt}).`);
      }
    }
    const actBranches = [...new Set([...(bundle.actHeads || []).map((r) => String(r._id).split(":")[0]), ...newActs.map((a) => String(a.branch ?? "0"))])];
    for (const br of actBranches) {
      const v = await verifyActChain(br, beingId);
      if (!v.ok) throw new Error(`applyGraft: POST-GRAFT act-chain verification FAILED on being:${beingId.slice(0, 8)}@${br} (${v.reason}).`);
    }

    // ── 10b. Provable replay: the LANDED heads (read from the DB) must
    // reproduce the SIGNED graftRoot. Mirrors plantGraft's root proof —
    // ties the signature's commitment to what actually landed. ──
    if (bundle.meta?.graftRoot) {
      const { graftRootFromParts } = await import("../../past/fact/chainRoots.js");
      const reelKeys = (bundle.reelHeads || []).map((r) => String(r._id));
      const actKeys = (bundle.actHeads || []).map((r) => String(r._id));
      const [landedReels, landedActs] = await Promise.all([
        reelKeys.length ? ReelHead.find({ _id: { $in: reelKeys } }).lean() : [],
        actKeys.length ? ActHead.find({ _id: { $in: actKeys } }).lean() : [],
      ]);
      const reproduced = graftRootFromParts({ beingId, reelHeads: landedReels, actHeads: landedActs });
      if (reproduced !== bundle.meta.graftRoot) {
        throw new Error(`applyGraft: GRAFT ROOT MISMATCH — landed heads reproduce ${reproduced.slice(0, 12)}… but the signed graftRoot is ${String(bundle.meta.graftRoot).slice(0, 12)}…. Refusing.`);
      }
    }
  } catch (err) {
    // ── ROLLBACK: delete exactly what landed (scoped; the target's
    // pre-existing chain is untouched — this graft only ever inserted rows
    // it did NOT already have). Standalone Mongo: no transaction. ──
    const byColl = { Fact, Act, Branch, ReelHead, ActHead };
    for (let i = landed.length - 1; i >= 0; i--) {
      const { coll, id } = landed[i];
      try { await byColl[coll].deleteOne({ _id: id }); }
      catch (e) { log.warn("Graft", `rollback delete ${coll}:${String(id).slice(0, 10)} failed: ${e.message}`); }
    }
    // Failure audit (operator's reel, single-writer). Logged, never silent —
    // a swallowed audit is how the missing import hid.
    try {
      await withBeingAct(opts.operatorBeingId, "graft-being:failed", branch, async (ctx) => {
        await emitFact({ verb: "do", act: "graft-being-failed", through: opts.operatorBeingId, of: { kind: "being", id: opts.operatorBeingId }, params: { graftedBeing: beingId, sourceReality: bundle.sourceReality || null, error: String(err?.message || err) }, actId: ctx.actId, branch }, ctx);
      });
    } catch (e) { log.warn("Graft", `failure-audit fact could not be stamped: ${e.message}`); }
    throw err;
  }

  // If this being currently holds an ATTESTED state-snapshot (a projection
  // with no backing local reel), the now-landed real reel supersedes it: drop
  // the snapshot slot so fold-on-read rebuilds from the chain. Scoped to the
  // snapshot case; an ordinary graft leaves the projection cache untouched.
  if (newFacts.length > 0) {
    const { default: Projection, projectionKey } = await import("../branch/projection.js");
    const touched = [...new Set(newFacts.map((f) => String(f.branch ?? "0")))];
    for (const br of touched) {
      const key = projectionKey(br, "being", beingId);
      const existing = await Projection.findById(key).lean();
      if (existing?.state?.attested?.stateSnapshot) {
        try { await Projection.deleteOne({ _id: key }); } catch { /* fold-on-read refolds regardless */ }
      }
    }
  }

  // ── 11. Success audit (operator's reel; single-writer — the grafter
  // records the deed, it must NOT write the grafted being's reel). ──
  try {
    await withBeingAct(opts.operatorBeingId, "graft-being:completed", branch, async (ctx) => {
      await emitFact({ verb: "do", act: "graft-being-completed", through: opts.operatorBeingId, of: { kind: "being", id: opts.operatorBeingId }, params: { graftedBeing: beingId, sourceReality: bundle.sourceReality || null, mode, counts, partial: bundle.meta?.partial || null }, actId: ctx.actId, branch }, ctx);
    });
  } catch (e) { log.warn("Graft", `completion-audit fact could not be stamped: ${e.message}`); }

  log.info("Graft", `applied being ${beingId.slice(0, 12)}… [${mode}] — ${counts.facts} fact(s), ${counts.acts} act(s) landed verbatim`);
  return { beingId, mode, counts, verified: { graftSig: !!bundle.meta?.graftSig, chain: true } };
}

/**
 * Apply a state-snapshot bundle: land an ATTESTED foreign state for a being
 * that has no reel here. No chain is replayed; the receiver trusts the source
 * reality's signed snapshot of the being's folded state, as-of a declared head.
 *
 * This is the one projection NOT folded from local facts: an attested foreign
 * state (marked `state.attested`), the state-level twin of "imported facts are
 * foreign by construction." loadOrFold returns an existing slot without
 * refolding, so the snapshot sticks (nothing stamps facts on a reel-less being).
 * A later real graft of the being's reel supersedes it (applyGraft drops the
 * snapshot slot when it lands real facts).
 *
 * Verify ladder (cold, fail-closed): graftSig provenance → state reproduces its
 * declared hash → snapshot root reproduces from the parts. Then refuse to
 * downgrade a being whose real chain is already present, and land the slot.
 */
async function applyStateSnapshot(bundle, opts = {}) {
  const beingId = bundle?.meta?.beingId;
  if (!beingId) throw new Error("applyStateSnapshot: bundle.meta.beingId is required");
  if (!opts.operatorBeingId) throw new Error("applyStateSnapshot: opts.operatorBeingId is required (the grafter, for the audit fact)");
  const partial = bundle.meta?.partial || {};
  const snap = bundle.snapshot || {};
  const branch = partial.branch || snap.branch || "0";
  const { computeHash, GENESIS_PREV } = await import("../../past/fact/hash.js");
  const { withBeingAct } = await import("../../sprout.js");
  const { emitFact } = await import("../../past/fact/facts.js");

  // ── 1. Provenance gate (cold, fail-closed). ──
  if (bundle.meta?.graftSig?.value && bundle.meta?.graftRoot) {
    const { isKeyId } = await import("../name/keys.js");
    const { verifyRealityRootSig } = await import("../../past/fact/chainRoots.js");
    const sg = bundle.meta.graftSig;
    const ok = isKeyId(sg.signerId) ? await verifyRealityRootSig(bundle.meta.graftRoot, sg.signerId, sg.value) : false;
    if (!ok) throw new Error(`applyStateSnapshot: snapshot SIGNATURE invalid (signer ${String(sg.signerId || "").slice(0, 14)}…). Refusing.`);
  } else if (!opts.allowUnsigned) {
    throw new Error("applyStateSnapshot: unsigned snapshot refused — a signed graftRoot (meta.graftSig) is required. Pass opts.allowUnsigned only for a trusted local extract.");
  }

  // ── 2. The state must reproduce its declared hash, and the root must
  // reproduce from the parts (so the signature commits to exactly this state). ──
  const state = snap.state;
  if (!state || typeof state !== "object") throw new Error("applyStateSnapshot: bundle.snapshot.state is required");
  const stateHash = computeHash(GENESIS_PREV, state);
  if (stateHash !== partial.stateHash) {
    throw new Error(`applyStateSnapshot: STATE HASH MISMATCH — state hashes ${stateHash.slice(0, 12)}… but the attestation says ${String(partial.stateHash).slice(0, 12)}…. Refusing.`);
  }
  const reproduced = computeHash(GENESIS_PREV, { kind: "state-snapshot", beingId, branch, atHead: partial.atHead, atSeq: partial.atSeq, stateHash });
  if (reproduced !== bundle.meta.graftRoot) {
    throw new Error(`applyStateSnapshot: SNAPSHOT ROOT MISMATCH — parts reproduce ${reproduced.slice(0, 12)}… but the signed root is ${String(bundle.meta.graftRoot).slice(0, 12)}…. Refusing.`);
  }

  // ── 3. Refuse to downgrade a being whose real chain we already hold. ──
  const haveFacts = await Fact.countDocuments({ "of.kind": "being", "of.id": beingId });
  if (haveFacts > 0) {
    throw new Error(`applyStateSnapshot: being ${beingId.slice(0, 8)}… already has ${haveFacts} local fact(s); a snapshot would downgrade the real chain. Refusing.`);
  }

  // ── 4. Land the attested projection, marked so reads know it is a snapshot
  // (no history) and a later real graft can recognize and supersede it. ──
  const { initProjection, loadProjection } = await import("../projections.js");
  const existing = await loadProjection("being", beingId, branch);
  const mode = existing ? "refresh" : "create";
  const attestedState = {
    ...state,
    attested: {
      stateSnapshot: true,
      source: bundle.sourceReality || null,
      atHead: partial.atHead || null,
      atSeq: partial.atSeq ?? null,
      stateHash,
      signer: bundle.meta?.graftSig?.signerId || null,
    },
  };
  await initProjection("being", beingId, branch, {
    state: attestedState,
    foldedSeq: typeof partial.atSeq === "number" ? partial.atSeq : 0,
    position: state.position ?? null,
  });

  // ── 5. Success audit (operator's reel; single-writer). ──
  try {
    await withBeingAct(opts.operatorBeingId, "graft-being:snapshot", branch, async (ctx) => {
      await emitFact({ verb: "do", act: "graft-being-completed", through: opts.operatorBeingId, of: { kind: "being", id: opts.operatorBeingId }, params: { graftedBeing: beingId, sourceReality: bundle.sourceReality || null, mode, counts: { facts: 0, acts: 0 }, partial }, actId: ctx.actId, branch }, ctx);
    });
  } catch (e) { log.warn("Graft", `snapshot completion-audit could not be stamped: ${e.message}`); }

  log.info("Graft", `applied state-snapshot of being ${beingId.slice(0, 12)}… [${mode}] — attested state as-of seq ${partial.atSeq}, no reel`);
  return { beingId, mode, counts: { facts: 0, acts: 0 }, verified: { graftSig: !!bundle.meta?.graftSig, snapshot: true } };
}
