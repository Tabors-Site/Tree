// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// receive.js — the ONE verb that takes a Book in (book.md §7). It subsumes the old, separate
// graft-plant / extension-install / language-import / model-load behind a single seal-check +
// atomic instate + colophon-append.
//
//   visit  = SEE          read-in-place; nothing enters your story (the library "browse").
//   receive = this        copy it home + countersign. The one commitment.
//
// Atomicity: a `landed[]` records every undo BEFORE its insert, so ANY failure rolls back exactly
// what landed — the receiver's pre-existing chain is untouched. The colophon is verified BEFORE
// anything plants (refuse-before-plant), and the receive itself is the RECEIVER's act, over
// verbatim-with-provenance content — a book is content, not a transferred identity.
//
// A book carries NO act-chains — a being is living matter (a reel — qualities.memory, state).
// Act-chains key per (story, history, being-cas) and the Name signs; they're local biography and
// stay home. So receive lands reels (fact-chains, self-contained via verifyReel), matter (CAS),
// and words (coin facts); the receiver's own Name records the receive (its act, its seal).
//
// The chain fact (do:receive-book) is NOT emitted here — receive() returns its outcome and the
// receive-book DO op (store/book/ops.js) declares the fact via stampsFact so the dispatcher
// stamps it (the keystone). receive() owns the engine: seal-check, plant, rollback, colophon seal.

import { verifyColophon, sealColophon } from "./colophon.js";
import { kindOf, bookImports, isBook } from "./book.js";

/**
 * Receive a book into this reality.
 * @param {object} book
 * @param {object} [opts] { at?, as?, actorBeingId?, history?, moment?, signer?, allowUnsigned? }
 *   at            — the position/space body content plants under (model/history).
 *   as            — the receiving Name (colophon seal + attribution).
 *   actorBeingId  — the receiving being (authors the word coins / acts that need a being).
 *   history       — the dispatch history (word scope + reel context).
 *   moment        — the ambient moment (the receive rides the receiver's act).
 * @returns {Promise<{ root, kind, imports, words, reels, matter, missingHostRefs, colophon }>}
 */
export async function receive(book, opts = {}) {
  if (!book || typeof book !== "object" || !book.colophon) {
    throw new Error("receive: not a book (missing colophon).");
  }

  // 1. SEAL CHECK — refuse before plant. (tamper-evidence over the whole sealed object; every
  //    seal in the stack verifies against its signerId.)
  const v = await verifyColophon(book);
  if (!v.ok) {
    throw new Error(`receive: colophon verification failed — ${v.reason} Refusing before any insert.`);
  }
  if (v.unsigned && !opts.allowUnsigned) {
    throw new Error("receive: book is unsigned (unvouched). Pass opts.allowUnsigned to receive a trusted local book.");
  }

  const landed = []; // [ { undo: async () => …, what } ] — compensating rollback, newest-first.
  const got = {
    root: v.root,
    kind: kindOf(book),
    imports: [],
    words: 0,
    reels: 0,
    matter: 0,
    missingHostRefs: [],
    colophon: null,
  };

  try {
    // 2. IMPORTS first — transitive, pinned by root (a deep/master book pulls everything).
    for (const imp of bookImports(book)) {
      got.imports.push(await receiveImport(imp, opts, landed));
    }

    // 3. BODY parts — the kind falls out of which are present.
    const body = book.body || {};
    if (body.code) got.missingHostRefs = await receiveCode(body.code, opts, landed); // ground host refs first
    if (body.matter) got.matter = await receiveMatter(body.matter, opts, landed);    // CAS before refs resolve
    if (body.reels) got.reels = await receiveReels(body.reels, opts, landed);
    if (body.words) got.words = await receiveWords(body.words, body, opts, landed);

    // 4. COUNTERSIGN — the colophon LINEAGE seal only (the copyist's mark on the book itself).
    //    The chain fact is the receive-book op's job (stampsFact → dispatcher), NOT receive()'s.
    got.colophon = opts.signer ? sealColophon(book, opts.signer).colophon : book.colophon;
  } catch (err) {
    // ROLLBACK — undo exactly what landed, newest first; the pre-existing chain is untouched.
    for (let i = landed.length - 1; i >= 0; i--) {
      try { await landed[i].undo(); } catch (e) { /* best-effort; a partial may remain */ }
    }
    throw new Error(`receive: instate failed (${err.message}). Rolled back exactly what landed (${landed.length} step(s)).`);
  }

  return got;
}

/** visit — read-in-place. Resolve + describe a book without it entering your story. */
export async function visit(book) {
  if (!isBook(book)) throw new Error("visit: not a well-formed book.");
  const v = await verifyColophon(book);
  return { ok: v.ok, root: v.root, kind: kindOf(book), signers: v.signers || [], imports: bookImports(book), reason: v.reason };
}

// ── per-part handlers ────────────────────────────────────────────────────────────────────────
// Each records its undo onto `landed` BEFORE inserting, so the receive() catch removes exactly
// what landed. A handler that throws aborts the whole receive (refuse-and-rollback).

async function receiveImport(imp, opts, landed) {
  // Resolve the dependency by its pinned root (the library / peer graph), then receive it
  // transitively. Sealed-by-hash: imp.root is immutable, so the meaning can't drift.
  // TODO(§2 step 5 — the Library): wire the sealed-by-hash resolver (fetch the book whose
  // colophon.root === imp.root, then `await receive(dep, opts)`), recording undo. Until the
  // Library exists there's nowhere to resolve from, so we record the unmet pin.
  return { name: imp.name, root: imp.root, resolved: false };
}

async function receiveMatter(matter, opts, landed) {
  // Land CAS blobs, hash-verifying each against the manifest (refuse on mismatch). putContent
  // stores by the ACTUAL bytes, so `stored.hash !== declaredHash` is the lie-detector — a
  // substituted blob can't poison the claimed address, it just proves the lie and refuses cold.
  const blobs = (matter?.casBlobs && typeof matter.casBlobs === "object") ? matter.casBlobs : null;
  if (!blobs || Object.keys(blobs).length === 0) return 0;

  const { putContent } = await import("../../materials/matter/contentStore.js");
  const manifest = (matter.casManifest && typeof matter.casManifest === "object") ? matter.casManifest : {};
  const refByHash = new Map();
  for (const r of (Array.isArray(matter.casRefs) ? matter.casRefs : [])) {
    if (r && r.kind === "cas" && r.hash) refByHash.set(r.hash, r);
  }

  let count = 0;
  for (const [hash, b64] of Object.entries(blobs)) {
    const buf = Buffer.from(String(b64), "base64");
    const ref = refByHash.get(hash) || {};
    const stored = await putContent(buf, {
      mimeType: ref.mimeType || "application/octet-stream",
      name: ref.name || null,
      encoding: ref.encoding || null,
    });
    if (stored.hash !== hash) {
      throw new Error(
        `receive(matter): CAS BLOB INTEGRITY FAILED — book claims ${hash.slice(0, 16)}… but the ` +
        `bytes hash to ${stored.hash.slice(0, 16)}…. Refusing before any reel/word plants.`,
      );
    }
    const declared = manifest[hash];
    if (declared && typeof declared.size === "number" && declared.size !== buf.length) {
      throw new Error(`receive(matter): casManifest size mismatch for ${hash.slice(0, 16)}… ` +
        `(manifest ${declared.size}, bytes ${buf.length}) — refusing.`);
    }
    // UNDO = NO-OP. The blob is content-addressed: identical bytes from any other fact share this
    // exact file (putContent dedups). On rollback we must NOT delete it — that could clobber a
    // blob another live fact references. Retention owns truly-orphaned bytes.
    landed.push({ what: `cas:${hash.slice(0, 12)}`, undo: async () => { /* no-op — retention owns orphans */ } });
    count++;
  }
  return count;
}

async function receiveReels(reels, opts, landed) {
  // Instate each being-reel VERBATIM (facts keep their source ids + provenance), then verifyReel
  // (self-contained — recomputes each fact's identity from p+content; needs NO act-chain). The
  // book's colophon (verified in receive()) is the PROVENANCE; these gates protect the LOCAL
  // chain from corruption on insert. NO act-chains: a being is living matter; its act-chain keys
  // per (story, history, being) and stays home.
  const list = Array.isArray(reels) ? reels : [];
  if (list.length === 0) return 0;

  const Fact = (await import("../../past/fact/fact.js")).default;
  const History = (await import("../../materials/history/history.js")).default;
  const ReelHead = (await import("../../past/reel/reelHead.js")).default;
  const { computeHash, contentOf } = await import("../../past/fact/hash.js");
  const { verifyReel } = await import("../../past/fact/verifyReel.js");

  let total = 0;
  for (const reel of list) {
    const beingId = reel?.being ?? reel?.meta?.beingId;
    if (!beingId) throw new Error("receive(reels): each reel needs `being` (the target being id).");
    if (!Array.isArray(reel.facts)) throw new Error("receive(reels): reel.facts[] is required.");
    const bid = String(beingId);

    // SCOPE — every fact / reelHead must belong to THIS being (refuse a spliced-in foreign row).
    for (const f of reel.facts) {
      if (!(f.of && f.of.kind === "being" && String(f.of.id) === bid)) {
        throw new Error(`receive(reels): SCOPE VIOLATION — a fact targets ${f.of?.kind}:${String(f.of?.id || "").slice(0, 10)}…, not being ${bid.slice(0, 10)}….`);
      }
    }
    for (const rh of (reel.reelHeads || [])) {
      if (String(rh._id).split(":").slice(1).join(":") !== `being:${bid}`) {
        throw new Error(`receive(reels): SCOPE VIOLATION — reelHead ${rh._id} is not being ${bid.slice(0, 10)}….`);
      }
    }

    // INTEGRITY — each fact _id must recompute from (p, contentOf). A tampered fact can't lie.
    for (const f of reel.facts) {
      if (typeof f._id !== "string" || computeHash(f.p, contentOf(f)) !== f._id) {
        throw new Error(`receive(reels): FACT INTEGRITY FAILED at seq ${f.seq} (${String(f._id).slice(0, 12)}…).`);
      }
    }

    // DEDUP → newFacts; mode = create | idempotent | merge.
    const factIds = reel.facts.map((f) => String(f._id));
    const have = new Set((await Fact.find({ _id: { $in: factIds } }).select("_id").lean()).map((r) => String(r._id)));
    const newFacts = reel.facts.filter((f) => !have.has(String(f._id)));
    const mode = have.size === 0 ? "create" : (newFacts.length === 0 ? "idempotent" : "merge");

    // REEL-DIVERGENCE — a (history, seq) the being already holds with a DIFFERENT _id is a fork.
    if (newFacts.length) {
      const wantBySeq = new Map(newFacts.map((f) => [`${String(f.history ?? "0")}:${f.seq}`, String(f._id)]));
      const seqs = [...new Set(newFacts.map((f) => f.seq))];
      const clash = await Fact.find({ "of.kind": "being", "of.id": bid, seq: { $in: seqs } }).select("_id seq history").lean();
      for (const e of clash) {
        const want = wantBySeq.get(`${String(e.history ?? "0")}:${e.seq}`);
        if (want && want !== String(e._id)) {
          throw new Error(`receive(reels): REEL DIVERGENCE — being ${bid.slice(0, 10)}… already holds (history ${e.history ?? "0"}, seq ${e.seq}) with different content. Refusing.`);
        }
      }
    }

    // HISTORY (branch) collision — absent → insert; same parent+branchPoint → ok; differ → refuse.
    const newHistories = [];
    const normBP = (bp) => (bp instanceof Map ? Object.fromEntries(bp) : (bp || {}));
    const bpKey = (bp) => JSON.stringify(Object.entries(normBP(bp)).sort());
    for (const h of (reel.histories || [])) {
      const ex = await History.findById(h._id).lean();
      if (!ex) { newHistories.push(h); continue; }
      if (ex.parent !== h.parent || bpKey(ex.branchPoint) !== bpKey(h.branchPoint)) {
        throw new Error(`receive(reels): BRANCH COLLISION — history "${h._id}" exists with a different parent/branchPoint. Refusing.`);
      }
    }

    // INSERT — push undo BEFORE each insert; receive()'s catch rolls back on any later throw.
    if (newHistories.length) {
      for (const h of newHistories) landed.push({ what: `History:${h._id}`, undo: async () => { await History.deleteOne({ _id: h._id }); } });
      await History.insertMany(newHistories, { ordered: false });
    }
    for (const rh of (reel.reelHeads || [])) {
      const ex = await ReelHead.findById(rh._id).select("head").lean();
      if (!ex) {
        landed.push({ what: `ReelHead:${rh._id}`, undo: async () => { await ReelHead.deleteOne({ _id: rh._id }); } });
        await ReelHead.create(rh);
      } else if ((rh.head || 0) > (ex.head || 0)) {
        await ReelHead.updateOne({ _id: rh._id }, { $set: { head: rh.head, headHash: rh.headHash } }); // advance-only; pre-existing row, NOT rolled back
      }
    }
    if (newFacts.length) {
      for (const f of newFacts) landed.push({ what: `Fact:${String(f._id).slice(0, 10)}`, undo: async () => { await Fact.deleteOne({ _id: f._id }); } });
      await Fact.insertMany(newFacts, { ordered: false });
    }

    // VERIFY the landed chain — verifyReel per (being, history). A break throws → receive() rolls back.
    const reelHistories = [...new Set([
      ...(reel.reelHeads || []).map((r) => String(r._id).split(":")[0]),
      ...newFacts.map((f) => String(f.history ?? "0")),
    ])];
    for (const br of reelHistories) {
      const vr = await verifyReel("being", bid, br);
      if (!vr.ok) {
        throw new Error(`receive(reels): POST-RECEIVE reel verification FAILED on being:${bid.slice(0, 8)}@${br} — ${vr.reason} at ${vr.brokenAt}.`);
      }
    }

    // ROOT (optional) — if the reel declares a fingerprint, the LANDED heads must reproduce it.
    if (reel.root) {
      const { graftRootFromParts } = await import("../../past/fact/chainRoots.js");
      const reelKeys = (reel.reelHeads || []).map((r) => String(r._id));
      const landedReels = reelKeys.length ? await ReelHead.find({ _id: { $in: reelKeys } }).lean() : [];
      const repro = graftRootFromParts({ beingId: bid, reelHeads: landedReels, actHeads: [] });
      if (repro !== reel.root) {
        throw new Error(`receive(reels): ROOT MISMATCH — landed heads reproduce ${repro.slice(0, 12)}… vs declared ${String(reel.root).slice(0, 12)}…. Refusing.`);
      }
    }

    total += newFacts.length;
  }
  return total;
}

async function receiveWords(words, body, opts, landed) {
  // Declare each word-def into the vocabulary (a coin fact per word), scoped to a history (the
  // language root). Undo = retire (a coin's withdrawal is itself a fact).
  const list = Array.isArray(words) ? words : [];
  if (list.length === 0) return 0;

  const { bindWord, disableWord } = await import("../../present/word/wordStore.js");

  // SCOPE: the dispatch history the op resolved (opts.history). "0" = heaven/global vocab (valid
  // only when the receiver is I_AM — bedrock-guarded); a non-"0" history is the book's sandboxed
  // language root. The op threads the real history; "0" is the deliberate heaven fallback.
  const history = opts.history != null ? String(opts.history) : "0";
  const actorBeingId = opts.actorBeingId ? String(opts.actorBeingId) : null; // the receiver authors the coins
  const moment = opts.moment ?? null; // ride the receiver's act if present

  let count = 0;
  for (const def of list) {
    const name = def.name ?? (def.role && def.op ? `${def.role}:${def.op}` : null);
    if (!name) continue;
    // Build the serializable binding (handlers are refs {ref:'…'}, never inline fns — JSON drops them).
    const binding = {
      ...(def.binding || {}),
      ...(def.kind ? { kind: def.kind } : {}),
      ...(def.role ? { role: def.role } : {}),
      ...(def.op ? { op: def.op } : {}),
      ...(def.source ? { source: String(def.source) } : {}),
      ownerExtension: def.ownerExtension || "received",
    };
    // Record undo BEFORE the declare; rollback retires exactly this word (a retire is itself a fact).
    landed.push({ what: `word:${name}@${history}`, undo: async () => { try { await disableWord(name, { moment, history, actorBeingId }); } catch {} } });
    await bindWord(name, binding, { moment, history, actorBeingId, skipIfUnchanged: true });
    count++;
  }
  return count;
}

async function receiveCode(code, opts, landed) {
  // The host floor (emitFact / CAS / fold — the bottom turtle) a language's handler-backed words
  // assume. The floor is HOST-OWNED and not transmittable as data, so a book can only NAME the
  // refs its words need; a receiving host must already provide them. We verify the named refs
  // resolve and RETURN the missing ones (not fatal — a handler-backed word simply won't run until
  // its host fn exists; a stricter receive could refuse). No chain write, no landed entry.
  const refs = (code && typeof code === "object") ? Object.keys(code) : [];
  if (refs.length === 0) return [];
  const { resolveHostHandler } = await import("../../present/word/wordStore.js");
  return refs.filter((ref) => !resolveHostHandler(String(ref)));
}
