// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// capture.js — SHARE, the producer half of the Book (5d.md: "package a piece into a book").
//
// captureBook pulls selected elements of a story into a Book BODY { words?, reels?, matter?, code? }
// — the exact mirror of receive.js's readers, so a captured book round-trips through `receive`. It
// is PURE READ: it emits no fact, it just reads the store. The act of SHARING (laying the book on
// the Library reel) is the share-book op; receiving it is receive-book. Capture is symmetric with
// receive — one reads the slice out, the other replays it in.
//
// It generalizes the OLD capturePartialGraft / captureBeingGraft / captureTemplate (graft/seed are
// the old impl — the Book shape carries, the code is replaced). The defining difference: a book
// carries **reels, not act-chains** (a being is living matter; the act-chain stays home). So the
// reel-capture here drops acts/actHeads — only the fact-chain travels, verified self-contained.
//
// "nothing is extracted" (5d.md): every captured fact keeps its signer inside it; the colophon (the
// caller seals it) rides along. CAS makes a shared book one more perfect copy — the economy of Love.

import { makeBook } from "./book.js";

const HASH_RE = /^[0-9a-f]{64}$/;
const DEFAULT_BLOB_CAP = 8 * 1024 * 1024;   // per-blob byte cap (seedTemplate default)
const DEFAULT_TOTAL_CAP = 32 * 1024 * 1024; // total inlined bytes cap

/**
 * Capture selected story elements into an UNSIGNED Book. The caller seals it (sealColophon) — the
 * book is unsigned until a Name vouches it, symmetric with receive being pure-instate.
 *
 * @param {object} sel
 *   title?    : a renderable Word (the book's told-line name)
 *   words?    : string[] | [{name,history?}]            → body.words (folded coin descriptors)
 *   reelOf?   : {being,history?,mechanism?,fromSeq?,toSeq?,cutoffSeq?} | [...]  → body.reels (a thread/span)
 *   history?  : default history for word/reel selection (default "0")
 *   matter?   : (matterId | cas-hash)[]                 → body.matter (refs + inlined blobs)
 *   code?     : ref[]                                    → body.code (host floor the words need)
 *   sourceStory?, createdBy?, parent?                    → colophon provenance/lineage
 * @param {object} [opts] { maxCasBlobBytes?, maxCasTotalBytes? }
 * @returns {Promise<object>} an unsigned book (makeBook)
 */
export async function captureBook(sel = {}, opts = {}) {
  const history = sel.history != null ? String(sel.history) : "0";
  const body = {};
  const casHashes = new Set(); // cas-hashes referenced by captured reel facts → carried in body.matter

  // 1. WORDS — fold coin descriptors (receiveWords re-binds them as fresh coins; carry descriptors,
  //    not the coin facts).
  if (Array.isArray(sel.words) && sel.words.length) {
    const { getWord } = await import("../../present/word/wordStore.js");
    const words = [];
    for (const entry of sel.words) {
      const name = typeof entry === "string" ? entry : entry?.name;
      const wHist = (entry && typeof entry === "object" && entry.history != null) ? String(entry.history) : history;
      if (!name) continue;
      const w = await getWord(name, wHist);
      if (!w) continue; // retired / unknown → not carried (honest)
      const { word, ownerExtension, ...binding } = w;
      words.push({ name, kind: binding.kind ?? null, binding, ownerExtension: ownerExtension ?? null });
    }
    if (words.length) body.words = words;
  }

  // 2. REELS — verbatim being-reel slices, act-chains STRIPPED.
  const reelSel = Array.isArray(sel.reelOf) ? sel.reelOf : (sel.reelOf ? [sel.reelOf] : []);
  if (reelSel.length) {
    const Fact = (await import("../../past/fact/fact.js")).default;
    const { reelKey } = await import("../../past/reel/reelHeads.js");
    const { graftRootFromParts } = await import("../../past/fact/chainRoots.js");
    const { loadHistory } = await import("../../materials/history/histories.js");
    const reels = [];
    for (const r of reelSel) {
      const reel = await captureReel(r, { Fact, reelKey, graftRootFromParts, loadHistory, defaultHistory: history, casHashes });
      if (reel) reels.push(reel);
    }
    if (reels.length) body.reels = reels;
  }

  // 3. MATTER — CAS refs + inlined blobs (matter rows requested + every cas-hash the reels reference).
  const matterIds = Array.isArray(sel.matter) ? sel.matter : (sel.matter ? [sel.matter] : []);
  if (matterIds.length || casHashes.size) {
    const matter = await captureMatter(matterIds, casHashes, {
      history,
      maxCasBlobBytes: opts.maxCasBlobBytes ?? DEFAULT_BLOB_CAP,
      maxCasTotalBytes: opts.maxCasTotalBytes ?? DEFAULT_TOTAL_CAP,
    });
    if (matter) body.matter = matter;
  }

  // 4. CODE — the host refs the carried words assume (receiveCode only checks they resolve).
  if (Array.isArray(sel.code) && sel.code.length) {
    body.code = {};
    for (const ref of sel.code) body.code[String(ref)] = String(ref);
  }

  const { getStoryDomain } = await import("../../ibp/address.js");
  return makeBook(
    { title: sel.title ?? null, body },
    { sourceStory: sel.sourceStory ?? getStoryDomain(), createdBy: sel.createdBy ?? null, parent: sel.parent ?? null },
  );
}

// Capture one being-reel slice — verbatim facts, no act-chain (a book carries reels only). The
// mechanism mirrors capturePartialGraft: whole reel, a [fromSeq..toSeq] segment, or a genesis-prefix.
async function captureReel(r, { Fact, reelKey, graftRootFromParts, loadHistory, defaultHistory, casHashes }) {
  const being = r?.being ?? r?.beingId;
  if (!being) return null;
  const bid = String(being);
  const history = r.history != null ? String(r.history) : defaultHistory;

  const q = { "of.kind": "being", "of.id": bid, history };
  if (r.fromSeq != null || r.toSeq != null) {
    q.seq = {};
    if (r.fromSeq != null) q.seq.$gte = r.fromSeq;
    if (r.toSeq != null) q.seq.$lte = r.toSeq;
  } else if (r.cutoffSeq != null) {
    q.seq = { $lte: r.cutoffSeq };
  }
  const facts = await Fact.find(q).sort({ seq: 1 }).lean();
  if (!facts.length) return null;

  for (const f of facts) collectCasHashes(f, casHashes);

  const tip = facts[facts.length - 1];
  const reelHeads = [{
    _id: reelKey(history, "being", bid),
    type: "being", id: bid, history,
    head: tip.seq, headHash: String(tip._id),
  }];

  // Lineage History rows for a non-main fork, so receiveReels resolves + verifies the range.
  const histories = [];
  if (history !== "0") {
    let cur = history;
    while (cur && cur !== "0") {
      const row = await loadHistory(cur);
      if (!row) break;
      histories.push(row);
      cur = row.parent ? String(row.parent) : null;
    }
  }

  const root = graftRootFromParts({ beingId: bid, reelHeads, actHeads: [] });
  return { being: bid, facts, reelHeads, histories, root };
}

// Capture matter as CAS refs + inlined base64 blobs (the seedTemplate inliner discipline: honest
// manifest, per-blob + total byte caps, never silently drop — record omissions).
async function captureMatter(matterIds, casHashes, { history, maxCasBlobBytes, maxCasTotalBytes }) {
  const { getContent } = await import("../../materials/matter/contentStore.js");
  const casRefs = [];
  const seen = new Set(casHashes);

  if (matterIds.length) {
    const { loadOrFold } = await import("../../materials/projections.js");
    for (const mid of matterIds) {
      if (typeof mid === "string" && HASH_RE.test(mid)) { seen.add(mid); continue; } // a bare cas-hash
      const slot = await loadOrFold("matter", String(mid), history);
      const content = slot?.state?.content;
      if (content && content.kind === "cas" && content.hash) {
        casRefs.push({
          kind: "cas", hash: content.hash,
          mimeType: content.mimeType ?? null, name: content.name ?? null,
          encoding: content.encoding ?? null, size: content.size ?? null,
        });
        seen.add(content.hash);
      }
    }
  }
  // Every reel-referenced hash also gets a bare ref if not already named by a matter row.
  const named = new Set(casRefs.map((r) => r.hash));
  for (const h of seen) if (!named.has(h)) casRefs.push({ kind: "cas", hash: h });

  if (!seen.size) return casRefs.length ? { casRefs, casBlobs: {}, casManifest: { included: [], omitted: [] } } : null;

  const casBlobs = {}; const included = []; const omitted = []; let total = 0;
  for (const h of seen) {
    const buf = await getContent(h);
    if (!buf) { omitted.push({ hash: h, reason: "absent" }); continue; }
    if (buf.length > maxCasBlobBytes) { omitted.push({ hash: h, reason: "over-blob-cap", size: buf.length }); continue; }
    if (total + buf.length > maxCasTotalBytes) { omitted.push({ hash: h, reason: "over-total-cap", size: buf.length }); continue; }
    casBlobs[h] = buf.toString("base64");
    included.push({ hash: h, size: buf.length });
    total += buf.length;
  }
  return { casRefs, casBlobs, casManifest: { included, omitted } };
}

// Scan a fact for content-addressed refs ({kind:"cas", hash}) so the book carries the bytes its
// facts point at (a thin book by default would carry only the hashes — here we collect them so the
// matter step can inline, making the book fat/self-contained when those blobs exist locally).
function collectCasHashes(fact, set) {
  const scan = (v, depth) => {
    if (!v || typeof v !== "object" || depth > 8) return;
    if (v.kind === "cas" && typeof v.hash === "string" && HASH_RE.test(v.hash)) set.add(v.hash);
    for (const k of Object.keys(v)) scan(v[k], depth + 1);
  };
  scan(fact?.params, 0);
  scan(fact?.content, 0);
  scan(fact?.value, 0);
}
