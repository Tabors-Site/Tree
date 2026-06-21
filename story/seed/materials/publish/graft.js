// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Graft — identity-preserving transport: bring the thing ITSELF, verbatim.
//
// A graft moves a being (or a history, or the whole story) WITH its
// identity intact: same pubkey id, same act-chain, same fact hashes,
// byte-for-byte as it was at home. No id remapping; an imported chain is
// foreign by construction and lands by verbatim insert, never emitFact
// (the digest binds history + provenance, so re-homing is impossible).
//
// Scope ranges across one module:
//   - captureGraft({beingId}) / applyGraft  — a BEING into a LIVING story.
//   - capturePartialGraft                    — a coherent SUBSET of a being.
//   - captureGraft() / plantGraft            — the GENOME (whole story at
//     the root, boot-only into an empty DB; carries storyId so the result
//     IS the same story — a mirror/migration).
//
// The SHELL counterpart (a structural template, fresh ids on planting) is
// seedTemplate.js / seedPlant.js. See philosophy/OS/GRAFT-AND-SEED.md:
// graft brings the thing itself; seed brings the shape of the thing.
//
// Plant is the receive-side operation (boot-time only, lives in
// `genesis.js`). The substrate refuses to expose runtime plant because
// replacing a live story is destructive and belongs to the deployer.
//
// **Plant is continuation, not duplication.** A planted seed has the
// source's original IDs. Two simultaneously-live substrates with the
// same story identity is undefined behavior; the deployer ensures
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
import History from "../history/history.js";
import ReelHead from "../../past/reel/reelHead.js";
import log from "../../seedStory/log.js";
import { getStoryDomain } from "../../ibp/address.js";
import { writeFile, mkdir, readdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Collections the seed handles explicitly or that are pure caches
// re-derived from the chain at plant time. Everything ELSE in the
// database is "the rest of the story's data" — extension-owned
// collections, the peer registry, whatever future modules store — and
// the genome captures it verbatim (a seed is the WHOLE story; an
// extension's collection is as much its body as its facts are).
const SEED_CORE_COLLECTIONS = new Set(["facts", "acts", "histories", "reelHeads", "actHeads"]);
const REGENERABLE_COLLECTIONS = new Set([
  // fold caches — plant cold-folds these back from the chain
  "projections", "inbox_projection", "threads_projection", "position_projection",
  // legacy row caches of the fold (and the empty pre-rename stamps)
  "spaces", "beings", "matters", "stamps",
]);

export const GRAFT_BUNDLE_VERSION = "1.0";

// Canonical seeds folder: story/seeds/, sibling of story/extensions/.
// Operator artifacts (genome backups) live here, NOT inside the
// sovereign seed/ substrate folder.
// seed.js lives at story/seed/materials/publish/graft.js
// story/seeds is three levels up.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GRAFTS_FOLDER = path.resolve(__dirname, "..", "..", "..", "grafts");

/**
 * Capture the full story as a portable seed bundle.
 *
 * The bundle preserves original IDs verbatim — a planted seed becomes
 * the same story continuing on a new substrate. The substrate refuses
 * to expose a runtime plant; the receiving deployer plants at boot via
 * `genesis.js` mode.
 *
 * By default, writes the captured seed to `story/seeds/<storyName>-<timestamp>.graft.json`.
 * Pass `returnOnly: true` to skip the write and just return the bundle
 * (for callers who want to ship it over the wire or stash elsewhere).
 *
 * @param {object} opts
 * @param {string} [opts.capturedBy]  the operator beingId who initiated
 *                                    the capture (for audit meta)
 * @param {string} [opts.storyName] human label for the bundle meta + filename stem
 * @param {boolean} [opts.returnOnly] if true, skip the disk write and just return the bundle
 * @returns {Promise<object>} { bundle, savedTo? } — bundle is the seed; savedTo is the disk path (when written)
 */
export async function captureGraft(opts = {}) {
  // Scope dispatch: a beingId narrows the graft to one being (its reel,
  // act-chain, lineage). No beingId = the whole story (genome = graft at
  // maximal scope). Same operation, same verbatim-identity discipline.
  if (opts.beingId) return captureBeingGraft(opts);
  const startedAt = Date.now();
  log.info("Graft", "capturing story genome...");

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
  // makes the story more than a state snapshot.
  const acts = await Act.find({}).sort({ stampedAt: 1 }).lean();
  log.info("Graft", `captured ${acts.length} acts`);

  // ── 3. Collect every History ──
  // History registry: paths, branchPoints (per-reel snapshots of parent
  // heads at create-branch time), scopes, lifecycle flags.
  const histories = await History.find({}).lean();
  log.info("Graft", `captured ${histories.length} histories`);

  // ── 4. Collect every ReelHead ──
  // Per-reel-per-history seq counters. Without these the receiving
  // substrate would allocate seq 1 for every reel on a fresh boot,
  // breaking the hash chain continuity from the seed's facts.
  const reelHeads = await ReelHead.find({}).lean();
  log.info("Graft", `captured ${reelHeads.length} reel heads`);

  // ── 4b. Collect every ActHead ──
  // Per-being per-history act-chain tips. Acts are content-addressed
  // chains; the story root covers them, so the heads are core
  // genome, not extension luggage.
  const { default: ActHead } = await import("../../past/act/actHead.js");
  const actHeads = await ActHead.find({}).lean();
  log.info("Graft", `captured ${actHeads.length} act heads`);

  // ── 5. Collect everything else — extension collections et al ──
  // The genome is the WHOLE story. Extensions may keep their own
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
  // them or the planted story's matter resolves to nothing. Every
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
  // The story's behavior depends on which extensions are awake
  // (their roles, ops, schedules, collections). The receiving
  // deployer needs the same set for the planted story to BE the
  // same story; plant warns loudly about any that are missing.
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
    sourceStory: getStoryDomain() || null,
    capturedAt: new Date().toISOString(),
    capturedBy: opts.capturedBy || null,

    meta: {
      storyName: opts.storyName || null,
      extensions,
      counts: {
        facts:     facts.length,
        acts:      acts.length,
        histories: histories.length,
        reelHeads: reelHeads.length,
        actHeads:  actHeads.length,
        extensionCollections: Object.keys(extensionData).length,
      },
      // The captured story's chain fingerprint — computed PURELY
      // over the captured arrays (not the live DB, which keeps
      // moving while capture runs). A seed's identity IS this root:
      // any substrate planting these parts must recompute the same
      // root, or determinism broke — plantGraft verifies and reports.
      // Reproducible realities by construction.
      storyRoot: await (async () => {
        try {
          const { storyRootFromParts } =
            await import("../../past/fact/chainRoots.js");
          return storyRootFromParts({
            story: getStoryDomain() || null,
            histories,
            reelHeads,
            actHeads,
          });
        } catch { return null; }
      })(),
    },

    facts,
    acts,
    histories,
    reelHeads,
    actHeads,
    extensionData,
    casBlobs,
    casManifest,
  };

  // Sign the genome's chain fingerprint (meta.storyRoot) with the
  // story key, so a planter proves the bundle is an AUTHENTIC genome of
  // this story self-certifyingly — the same signed-root provenance
  // chainRoots.signedStoryRoot/verifyStoryRootSig give live, now
  // carried in the artifact. signerId = storyId (the story pubkey id).
  if (bundle.meta?.storyRoot) {
    try {
      const { getStoryIdentity, signData } = await import("../../storyIdentity.js");
      const rid = getStoryIdentity();
      bundle.meta.storySig = { signerId: rid.storyId, value: signData(bundle.meta.storyRoot) };
    } catch { /* unsigned genome (advisory); plant still recomputes + walks the chain */ }
  }

  const elapsedMs = Date.now() - startedAt;
  log.info("Graft", `genome captured in ${elapsedMs}ms`);

  // Default behavior: write to story/seeds/ so there's one canonical
  // place for genome artifacts. Callers wanting the raw bundle pass
  // returnOnly: true.
  if (opts.returnOnly) return { bundle };

  await mkdir(GRAFTS_FOLDER, { recursive: true });
  const stem = (opts.storyName || bundle.sourceStory || "story")
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
  for (const collection of ["facts", "acts", "histories", "reelHeads"]) {
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
 * this IS the story with those IDs. Two simultaneously-live
 * substrates with the same story identity is undefined behavior and
 * is the deployer's responsibility to prevent (see done/Chain-Rebuild.md).
 *
 * Replaying steps:
 *   1. Validate bundle shape
 *   2. Refuse if any target collection is non-empty (DB must be fresh)
 *   3. Bulk-insert histories, reelHeads, facts, acts (original IDs)
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
  // If the genome carries a story-root signature, verify it self-
  // certifyingly over meta.storyRoot — "this genome was vouched for by
  // the holder of storyId (the story key)." The post-plant recompute
  // below then proves THIS substrate reproduces that same root. Together:
  // authentic genome AND provable replay. Absent signature is advisory
  // (older genomes). Verifiable without the DB, so it gates cold.
  {
    const rsig = bundle.meta?.storySig;
    if (rsig?.value && bundle.meta?.storyRoot) {
      const { verifyStoryRootSig } = await import("../../past/fact/chainRoots.js");
      const ok = await verifyStoryRootSig(bundle.meta.storyRoot, rsig.signerId, rsig.value);
      if (!ok) {
        throw new Error(
          `plantGraft: genome story-root SIGNATURE invalid (signer ` +
          `${String(rsig.signerId || "").slice(0, 14)}…) — refusing before planting.`,
        );
      }
      log.info("Graft", `genome provenance verified — vouched by ${String(rsig.signerId).slice(0, 14)}…`);
    }
  }

  // ── 1. Refuse if DB isn't fresh ──
  // Plant is destructive on a live story. The substrate refuses to
  // expose runtime plant for exactly this reason. Boot mode in
  // `genesis.js` ensures it only runs against a fresh DB — but we
  // double-check here so a misconfigured boot can't silently corrupt
  // an existing story.
  const checks = await Promise.all([
    Fact.countDocuments({}),
    Act.countDocuments({}),
    History.countDocuments({}),
    ReelHead.countDocuments({}),
  ]);
  const [factCount, actCount, historyCount, reelCount] = checks;
  if (factCount > 0 || actCount > 0 || historyCount > 0 || reelCount > 0) {
    throw new Error(
      `plantGraft: refusing to plant into a non-empty DB. Found ` +
      `facts=${factCount}, acts=${actCount}, histories=${historyCount}, ` +
      `reelHeads=${reelCount}. Wipe the DB before planting (the deployer's ` +
      `responsibility — plant is destructive by design).`,
    );
  }

  log.info("Graft", "planting story genome...");
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

  // ── 2. Histories first ──
  // Plant order matters for foreign-key-like references inside the
  // substrate's read paths. Histories are referenced by facts.history
  // and reelHeads.history; insert them first.
  if (bundle.histories.length > 0) {
    await History.insertMany(bundle.histories, { ordered: false });
    log.info("Graft", `planted ${bundle.histories.length} histories`);
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
  // (the story root covers act chains).
  if (Array.isArray(bundle.actHeads) && bundle.actHeads.length > 0) {
    const { default: ActHead } = await import("../../past/act/actHead.js");
    await ActHead.insertMany(bundle.actHeads, { ordered: false });
    log.info("Graft", `planted ${bundle.actHeads.length} act heads`);
  }

  // ── 4. Facts ──
  // The substantive chain. Original _id, seq, history, p/h hashes
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
  // The bundle names the extensions the source story ran with. The
  // planted story needs the same set to behave the same (roles, ops,
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
          `planted story expects extension "${name}"${ext?.version ? ` (v${ext.version})` : ""} ` +
          `but it is not present in extensions/. Its beings, roles, ops, and data ` +
          `will be inert until it's installed.`,
        );
      }
    }
  }

  // ── 8. Provable replay ──
  // Recompute the planted chain's story root over what LANDED
  // (history + reelHead rows read straight back from the DB) and
  // compare to the bundle's captured fingerprint. Match = this
  // story IS the captured story, mathematically. Mismatch =
  // determinism broke (or the bundle was altered) — warn loudly,
  // never silently. Anchored to the bundle's sourceStory so the
  // same chain verifies regardless of the host's own domain.
  let rootVerified = null;
  const expectedRoot = bundle.meta?.storyRoot || null;
  if (expectedRoot) {
    try {
      const { storyRootFromParts } = await import("../../past/fact/chainRoots.js");
      const { default: ActHead } = await import("../../past/act/actHead.js");
      const [dbHistories, dbHeads, dbActHeads] = await Promise.all([
        History.find({}).lean(),
        ReelHead.find({}).select("_id history head headHash").lean(),
        ActHead.find({}).select("_id history headHash").lean(),
      ]);
      const actualRoot = storyRootFromParts({
        story: bundle.sourceStory || null,
        histories: dbHistories,
        reelHeads: dbHeads,
        actHeads: dbActHeads,
      });
      rootVerified = actualRoot === expectedRoot;
      if (rootVerified) {
        log.info("Graft", `chain root VERIFIED: ${actualRoot.slice(0, 16)}… — this story is the captured story`);
        // ── The root proves the COMMITMENT STRUCTURE; now prove the
        // facts behind it. The planted head rows came verbatim from
        // the bundle — a bundle with tampered fact rows but original
        // heads would pass the root match alone. Walk every reel
        // (hash chain end to end, history-aware) and every act-chain
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
            const v = await verifyReel(rh.type ?? rh._id?.split(":")[1], rh.id ?? rh._id?.split(":")[2], rh.history || "0");
            reelsWalked++;
            if (!v.ok) broken.push({ kind: "reel", key: rh._id, reason: v.reason, at: v.brokenAt });
          }
          for (const ah of dbActHeads) {
            const seg = String(ah._id || "").split(":"); // <story>:<history>:<being>
            const beingId = ah.beingId ?? seg[2];
            const v = await verifyActChain(ah.story ?? seg[0], ah.history ?? seg[1] ?? "0", beingId);
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
          const toClear = ["facts", "acts", "histories", "reelHeads", "actHeads"];
          for (const name of Object.keys(bundle.extensionData || {})) {
            if (!name.startsWith("system.")) toClear.push(name);
          }
          for (const name of toClear) {
            try { await db.collection(name).deleteMany({}); } catch { /* collection may not exist */ }
          }
          const { invalidateHistoryCache } = await import("../history/histories.js");
          invalidateHistoryCache(null);
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
      histories: bundle.histories.length,
      reelHeads: bundle.reelHeads.length,
      extensionCollections,
    },
    rootVerified,
    expectedRoot,
  };
}

// ─────────────────────────────────────────────────────────────────────
// BEING GRAFT — identity-preserving transport of ONE being into a
// LIVING story. Scope below the genome: the being's own reel + its
// full act-chain + its lineage, carried VERBATIM (original pubkey id,
// original fact/act hashes), deduped by pubkey on arrival. See
// philosophy/OS/GRAFT-AND-SEED.md.
// ─────────────────────────────────────────────────────────────────────

/**
 * Capture ONE being as an identity-preserving graft bundle. The being's
 * own reel (be:birth + its be-acts + do:set-being + its summons), its
 * full act-chain, the lineage History rows its facts span, the per-history
 * reel/act heads, and the CAS blobs its facts reference — all VERBATIM
 * (original ids, original p/h hashes). meta.lineage carries parentBeingId
 * + homeStory (bare refs; the referenced beings need NOT be present on
 * the target). meta.graftRoot is the scoped fingerprint; meta.graftSig is
 * this story vouching for the extract.
 */
async function captureBeingGraft(opts) {
  const beingId = String(opts.beingId);
  const story = getStoryDomain() || null;
  const { default: ActHead } = await import("../../past/act/actHead.js");
  const { actHeadKey } = await import("../../past/act/actHash.js");
  const { reelKey } = await import("../../past/reel/reelHeads.js");
  const { loadHistory } = await import("../history/histories.js");
  const { loadOrFold } = await import("../projections.js");
  const { graftRootFromParts } = await import("../../past/fact/chainRoots.js");

  // The being's OWN reel (single-writer: every fact here has the being as
  // its actor) + its full act-chain.
  const facts = await Fact.find({ "of.kind": "being", "of.id": beingId }).sort({ seq: 1 }).lean();
  const acts = await Act.find({ through: beingId }).sort({ stampedAt: 1 }).lean();

  // Lineage histories: every distinct non-main history the being touched,
  // plus its ancestor chain, so resolveHistoryLineage resolves on the
  // target. Main ("0") is implicit (no History row).
  const historySet = new Set();
  for (const f of facts) historySet.add(String(f.history ?? "0"));
  for (const a of acts) historySet.add(String(a.history ?? "0"));
  historySet.delete("0");
  const historyById = new Map();
  for (const b of historySet) {
    let cur = b;
    while (cur && cur !== "0" && !historyById.has(cur)) {
      const row = await loadHistory(cur);
      if (!row) break;
      historyById.set(cur, row);
      cur = row.parent ? String(row.parent) : null;
    }
  }
  const histories = [...historyById.values()];

  // Per-history heads (the being's reel + act-chain tips). Include main.
  const allHistories = [...new Set([...historySet, "0", ...historyById.keys()])];
  const reelKeys = allHistories.map((br) => reelKey(br, "being", beingId));
  const actKeys = allHistories.map((br) => actHeadKey(story, br, beingId));
  const reelHeads = await ReelHead.find({ _id: { $in: reelKeys } }).lean();
  const actHeads = await ActHead.find({ _id: { $in: actKeys } }).lean();

  // Lineage refs from the being's current projection.
  const slot = await loadOrFold("being", beingId, opts.history || "0");
  const lineage = {
    parentBeingId: slot?.state?.parentBeingId ?? null,
    homeStory: slot?.state?.homeStory ?? story,
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
    sourceStory: story,
    capturedAt: new Date().toISOString(),
    capturedBy: opts.capturedBy || null,
    meta: {
      beingId,
      lineage,
      graftRoot,
      counts: { facts: facts.length, acts: acts.length, histories: histories.length, reelHeads: reelHeads.length, actHeads: actHeads.length },
    },
    facts, acts, histories, reelHeads, actHeads, casBlobs, casManifest,
  };
  // Provenance: this story vouches the extract is authentic. signerId =
  // storyId (a pubkey id a foreign receiver decodes from the id alone).
  try {
    const { getStoryIdentity, signData } = await import("../../storyIdentity.js");
    const rid = getStoryIdentity();
    bundle.meta.graftSig = { signerId: rid.storyId, value: signData(graftRoot) };
  } catch { /* unsigned extract (advisory) */ }

  log.info("Graft", `captured being ${beingId.slice(0, 12)}… — ${facts.length} fact(s), ${acts.length} act(s), ${histories.length} lineage history(ies)`);
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
 *   "checkpoint-segment" — a contiguous SUFFIX [fromSeq..toSeq] on one history,
 *     anchored at the head hash of the fact immediately before fromSeq (carried
 *     as a signed checkpoint, NOT the fact itself). Verifies with the Phase-2
 *     verifyReelFrom seeded at that anchor. "Bring my recent history, provably
 *     mine, without my whole life" — a verifiable reference import.
 *
 *   "single-branch"      — every fact of the being that LIVES on one fork
 *     (history === opts.history, a non-main path), anchored at the FORK-POINT
 *     head on the parent. The fork's lineage History rows ride along so the
 *     receiver resolves the history and verifyReelFrom checks only the fork's
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
 * @param {object} opts { beingId, mechanism?, cutoffSeq, fromSeq?, toSeq?, history?, beyondExtract?, capturedBy? }
 *   genesis-prefix needs cutoffSeq; checkpoint-segment needs fromSeq (>=2);
 *   single-branch needs history (a non-main fork); state-snapshot needs neither.
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
  const history = opts.history || "0";
  const story = getStoryDomain() || null;
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
    const snap = await loadOrFold("being", beingId, history);
    if (!snap || !snap.state || Object.keys(snap.state).length === 0) {
      throw new Error(`capturePartialGraft: being ${beingId.slice(0, 10)}… does not fold on history ${history} (nothing to snapshot)`);
    }
    const reelHeadRow = await ReelHead.findById(reelKey(history, "being", beingId)).lean();
    const atHead = reelHeadRow?.headHash || GENESIS_PREV;
    const atSeq = reelHeadRow?.head ?? null;
    const state = snap.state;
    // Hash the state, then bind it, the head, and the being into one signed root.
    const stateHash = computeHash(GENESIS_PREV, state);
    const snapshotRoot = computeHash(GENESIS_PREV, { kind: "state-snapshot", beingId, history, atHead, atSeq, stateHash });
    const bundle = {
      kind: "graft",
      bundleVersion: GRAFT_BUNDLE_VERSION,
      sourceStory: story,
      capturedAt: new Date().toISOString(),
      capturedBy: opts.capturedBy || null,
      meta: {
        beingId,
        lineage: { parentBeingId: state.parentBeingId ?? null, homeStory: state.homeStory ?? story },
        graftRoot: snapshotRoot,
        partial: { mechanism: "state-snapshot", history, atHead, atSeq, stateHash, beyondExtract: opts.beyondExtract || "refuse" },
        counts: { facts: 0, acts: 0, histories: 0, reelHeads: 0, actHeads: 0 },
      },
      snapshot: { state, history, atHead, atSeq },
      facts: [], acts: [], histories: [], reelHeads: [], actHeads: [], casBlobs: {}, casManifest: { included: [], omitted: [] },
    };
    try {
      const { getStoryIdentity, signData } = await import("../../storyIdentity.js");
      bundle.meta.graftSig = { signerId: getStoryIdentity().storyId, value: signData(snapshotRoot) };
    } catch { /* unsigned extract (advisory) */ }
    log.info("Graft", `captured state-snapshot of being ${beingId.slice(0, 12)}… — as-of seq ${atSeq} (head ${String(atHead).slice(0, 10)}…), no reel`);
    return { bundle };
  }

  // ── reel-based mechanisms (genesis-prefix / checkpoint-segment / single-
  // branch): capture the chosen range of the being's reel + the partial
  // descriptor declaring its shape, plus (single-branch) the fork's lineage
  // History rows so the receiver can resolve and verify the history. ──
  let facts, partialMeta;
  let captureHistory = history;
  let historiesToCarry = [];
  if (mechanism === "genesis-prefix") {
    const cutoffSeq = Number(opts.cutoffSeq);
    if (!(Number.isInteger(cutoffSeq) && cutoffSeq > 0)) {
      throw new Error("capturePartialGraft: cutoffSeq must be a positive integer");
    }
    // The being's reel on `history`, seq 1..cutoff — a genesis-rooted prefix.
    facts = await Fact.find({ "of.kind": "being", "of.id": beingId, history: history, seq: { $lte: cutoffSeq } }).sort({ seq: 1 }).lean();
    if (facts.length === 0) {
      throw new Error(`capturePartialGraft: no facts on being ${beingId.slice(0, 10)}… reel (history ${history}) at or before seq ${cutoffSeq}`);
    }
    partialMeta = { mechanism: "genesis-prefix", history, cutoffSeq: facts[facts.length - 1].seq, beyondExtract: opts.beyondExtract || "refuse" };
  } else if (mechanism === "checkpoint-segment") {
    // A contiguous SUFFIX [fromSeq..toSeq?] on `history`. fromSeq must be >= 2
    // (fromSeq 1 IS a genesis-prefix). The anchor is the prev-hash the first
    // segment fact already chains to — carried as the checkpoint; the fact
    // before fromSeq is NOT included.
    const fromSeq = Number(opts.fromSeq);
    if (!(Number.isInteger(fromSeq) && fromSeq >= 2)) {
      throw new Error("capturePartialGraft: checkpoint-segment fromSeq must be an integer >= 2 (fromSeq 1 is a genesis-prefix)");
    }
    const seqFilter = { $gte: fromSeq };
    if (opts.toSeq != null) seqFilter.$lte = Number(opts.toSeq);
    facts = await Fact.find({ "of.kind": "being", "of.id": beingId, history: history, seq: seqFilter }).sort({ seq: 1 }).lean();
    if (facts.length === 0) {
      throw new Error(`capturePartialGraft: no facts on being ${beingId.slice(0, 10)}… reel (history ${history}) at seq ${fromSeq}..`);
    }
    if (facts[0].seq !== fromSeq) {
      throw new Error(`capturePartialGraft: reel has no fact at seq ${fromSeq} (a checkpoint-segment must be contiguous from fromSeq)`);
    }
    const anchorPrev = String(facts[0].p);
    partialMeta = {
      mechanism: "checkpoint-segment", history, fromSeq, cutoffSeq: facts[facts.length - 1].seq,
      // The signed checkpoint: "at seq fromSeq-1 this reel's head was anchorPrev."
      // The receiver seeds verifyReelFrom here; the value is committed
      // transitively by the segment chain, so graftSig already vouches it.
      checkpoint: { history, seq: fromSeq - 1, headHash: anchorPrev },
      beyondExtract: opts.beyondExtract || "refuse",
    };
  } else {
    // single-branch: every fact of the being that LIVES on a fork (history ===
    // targetHistory), the divergent slice after the fork point. The inherited
    // parent prefix is shared history the being already holds on the parent
    // line and is NOT brought. Anchored at the fork-point head (the prev-hash
    // the fork's first fact chains to). The fork's lineage History rows ride
    // along so the receiver can resolveHistoryLineage + verifyReelFrom on it.
    const { isMain, loadHistory } = await import("../history/histories.js");
    const targetHistory = opts.history;
    if (!targetHistory || isMain(targetHistory)) {
      throw new Error("capturePartialGraft: single-branch requires a non-main history (main is the trunk — use genesis-prefix or checkpoint-segment there)");
    }
    captureHistory = targetHistory;
    facts = await Fact.find({ "of.kind": "being", "of.id": beingId, history: targetHistory }).sort({ seq: 1 }).lean();
    if (facts.length === 0) {
      throw new Error(`capturePartialGraft: being ${beingId.slice(0, 10)}… has no facts on history ${targetHistory}`);
    }
    const anchorPrev = String(facts[0].p);
    const fromSeq = facts[0].seq;
    // The fork + its non-main ancestors, so the receiver can resolve the lineage.
    const seen = new Set();
    let cur = targetHistory;
    while (cur && !isMain(cur) && !seen.has(cur)) {
      seen.add(cur);
      const row = await loadHistory(cur);
      if (!row) break;
      historiesToCarry.push(row);
      cur = row.parent ? String(row.parent) : null;
    }
    const parentHistory = historiesToCarry[0]?.parent != null ? String(historiesToCarry[0].parent) : "0";
    partialMeta = {
      mechanism: "single-branch", history: targetHistory, fromSeq, cutoffSeq: facts[facts.length - 1].seq,
      // The fork-point anchor: at the parent's head where this branch split, the
      // reel head was anchorPrev (the fork's first fact chains to it).
      checkpoint: { history: parentHistory, seq: fromSeq - 1, headHash: anchorPrev },
      beyondExtract: opts.beyondExtract || "refuse",
    };
  }

  const head = facts[facts.length - 1];
  // A reelHead AT the captured tip (on the capture history), so the landed
  // extract records its lawful tip and a later graft can advance from it.
  const reelHeads = [{ _id: reelKey(captureHistory, "being", beingId), type: "being", id: beingId, history: captureHistory, head: head.seq, headHash: String(head._id) }];

  const slot = await loadOrFold("being", beingId, captureHistory);
  const lineage = { parentBeingId: slot?.state?.parentBeingId ?? null, homeStory: slot?.state?.homeStory ?? story };
  const graftRoot = graftRootFromParts({ beingId, reelHeads, actHeads: [] });

  const bundle = {
    kind: "graft",
    bundleVersion: GRAFT_BUNDLE_VERSION,
    sourceStory: story,
    capturedAt: new Date().toISOString(),
    capturedBy: opts.capturedBy || null,
    meta: {
      beingId,
      lineage,
      graftRoot,
      partial: partialMeta,
      counts: { facts: facts.length, acts: 0, histories: historiesToCarry.length, reelHeads: 1, actHeads: 0 },
    },
    facts, acts: [], histories: historiesToCarry, reelHeads, actHeads: [], casBlobs: {}, casManifest: { included: [], omitted: [] },
  };
  try {
    const { getStoryIdentity, signData } = await import("../../storyIdentity.js");
    bundle.meta.graftSig = { signerId: getStoryIdentity().storyId, value: signData(graftRoot) };
  } catch { /* unsigned extract (advisory) */ }

  const logLine = {
    "genesis-prefix":     `captured genesis-prefix of being ${beingId.slice(0, 12)}… — seq 1..${head.seq} (${facts.length} fact(s))`,
    "checkpoint-segment": `captured checkpoint-segment of being ${beingId.slice(0, 12)}… — seq ${partialMeta.fromSeq}..${head.seq} anchored at ${String(facts[0].p).slice(0, 10)}… (${facts.length} fact(s))`,
    "single-branch":      `captured single-branch of being ${beingId.slice(0, 12)}… — history ${captureHistory} seq ${partialMeta.fromSeq}..${head.seq}, ${historiesToCarry.length} lineage history(ies) (${facts.length} fact(s))`,
  }[mechanism];
  log.info("Graft", logLine);
  return { bundle };
}
