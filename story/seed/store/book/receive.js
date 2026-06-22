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
  // Resolve the dependency by its pinned root (sealed-by-hash, immutable — the lockfile) from the
  // Library, then receive it transitively. A book imports another by colophon.root, so the meaning
  // can't drift. The dep receives atomically on its own (a received language is an independently
  // valid book); an unresolved pin is recorded, not fatal — the importer may already hold it.
  if (!imp?.root) return { name: imp?.name ?? null, root: null, resolved: false, reason: "no root" };
  const { resolveBook } = await import("./library.js");
  const dep = await resolveBook(imp.root);
  if (!dep) return { name: imp.name ?? null, root: imp.root, resolved: false, reason: "not in library" };
  const got = await receive(dep, opts); // transitive (a master book pulls its graph)
  return { name: imp.name ?? null, root: imp.root, resolved: true, kind: got.kind };
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
  // Instate each being-reel VERBATIM via the shared core (past/reel/instateReel.js) — scope,
  // integrity, dedup, reel-divergence, branch-collision, landed[]-tracked insert, verifyReel. The
  // book's colophon (verified in receive()) is the PROVENANCE; the core's gates protect the LOCAL
  // chain. NO act-chains: a being is living matter; its act-chain keys per (story, history, being)
  // and stays home — graft adds the act layer around this same core, book-receive does not.
  const list = Array.isArray(reels) ? reels : [];
  if (list.length === 0) return 0;

  const deps = {
    Fact: (await import("../../past/fact/fact.js")).default,
    History: (await import("../../materials/history/history.js")).default,
    ReelHead: (await import("../../past/reel/reelHead.js")).default,
    ...(await import("../../past/fact/hash.js")),       // computeHash, contentOf
    ...(await import("../../past/fact/verifyReel.js")), // verifyReel
    graftRootFromParts: (await import("../../past/fact/chainRoots.js")).graftRootFromParts,
  };
  const { instateReel } = await import("../../past/reel/instateReel.js");

  let total = 0;
  for (const reel of list) {
    const r = await instateReel(reel, { landed }, deps);
    total += r.newFacts.length;
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
    const name = def.name ?? (def.able && def.op ? `${def.able}:${def.op}` : null);
    if (!name) continue;
    // Build the serializable binding (handlers are refs {ref:'…'}, never inline fns — JSON drops them).
    const binding = {
      ...(def.binding || {}),
      ...(def.kind ? { kind: def.kind } : {}),
      ...(def.able ? { able: def.able } : {}),
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
