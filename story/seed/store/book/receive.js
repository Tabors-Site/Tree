// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// receive.js — the ONE verb that takes a Book in (book.md §7). It subsumes the old, separate
// graft-plant / extension-install / language-import / model-load behind a single seal-check +
// atomic instate + colophon-append.
//
//   visit  = SEE          read-in-place; nothing enters your story (the library "browse").
//   receive = this        copy it home + countersign. The one commitment.
//
// Atomicity (the engine that already works in applyGraft, generalized): a `landed[]` records
// every undo BEFORE its insert, so ANY failure rolls back exactly what landed — the receiver's
// pre-existing chain is untouched. The colophon is verified BEFORE anything plants
// (refuse-before-plant), and the receive itself is the RECEIVER's act (their fact + their seal),
// over verbatim-with-provenance content — a book is content, not a transferred identity.
//
// A book carries NO act-chains — a being is living matter (a reel — qualities.memory, state).
// Act-chains key per (story, history, being-cas) and the Name signs; they're local biography and
// stay home. So receive lands reels (fact-chains, self-contained via verifyReel), matter (CAS),
// and words (coin facts); the receiver's own Name records the receive (its act, its seal).
//
// TOUCH-UP (wiring the deep handlers to the live machinery) is marked TODO; the structure +
// contracts are down. Reuse map (book-build.md): words → declareOpsToFold/registerRoleWord ;
// reels → the applyGraft cold-gates + verbatim-insert + verifyReel (minus all act-chain code) ;
// matter → putContent/hasContent ; imports → the sealed-by-hash resolver.

import { verifyColophon, sealColophon } from "./colophon.js";
import { kindOf, bookImports, isBook } from "./book.js";

/**
 * Receive a book into this reality.
 * @param {object} book
 * @param {object} [opts] { at?, as?, moment?, signer?, allowUnsigned? }
 *   at      — the position/space the body plants under (model/history content).
 *   as      — the receiving Name (records the receive on its chain + appends its seal).
 *   moment  — the ambient moment (the receive rides the receiver's act).
 * @returns {Promise<{ root, kind, imports, words, reels, matter, colophon }>}
 */
export async function receive(book, opts = {}) {
  if (!book || typeof book !== "object" || !book.colophon) {
    throw new Error("receive: not a book (missing colophon).");
  }

  // 1. SEAL CHECK — refuse before plant. (tamper-evidence: recompute root over body;
  //    authenticity: every seal in the stack verifies against its signerId.)
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
    colophon: null,
  };

  try {
    // 2. IMPORTS first — transitive, pinned by root (a deep/master book pulls everything).
    for (const imp of bookImports(book)) {
      got.imports.push(await receiveImport(imp, opts, landed));
    }

    // 3. BODY parts — the kind falls out of which are present; each is independent.
    const body = book.body || {};
    if (body.matter) got.matter = await receiveMatter(body.matter, opts, landed); // CAS first (refs resolve)
    if (body.reels) got.reels = await receiveReels(body.reels, opts, landed);
    if (body.words) got.words = await receiveWords(body.words, body, opts, landed);
    if (body.code) await receiveCode(body.code, opts, landed);

    // 4. COUNTERSIGN — append the receiver's seal (you are now a copyist in its lineage) and
    //    record the receive as the receiver's OWN act (a fact on their reel: "I received book R").
    //    TODO(touch-up): stamp the do:receive-book fact on opts.as's reel via the dispatcher.
    got.colophon = opts.signer ? sealColophon(book, opts.signer).colophon : book.colophon;
  } catch (err) {
    // ROLLBACK — undo exactly what landed, newest first; the pre-existing chain is untouched.
    for (let i = landed.length - 1; i >= 0; i--) {
      try { await landed[i].undo(); } catch (e) { /* best-effort; a partial may remain — log + refuse */ }
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
// Each records its undo onto `landed` BEFORE inserting, so rollback removes exactly what landed.

async function receiveImport(imp, opts, landed) {
  // Resolve the dependency by its pinned root (the library / peer graph), then receive it
  // transitively. Sealed-by-hash: imp.root is immutable, so the meaning can't drift.
  // TODO(touch-up): wire the resolver — fetch the book whose colophon.root === imp.root from
  // the local store / peer graph, then `await receive(dep, opts)`; record undo.
  return { name: imp.name, root: imp.root, resolved: false };
}

async function receiveMatter(matter, opts, landed) {
  // Land CAS blobs, hash-verifying each against the manifest (refuse on mismatch). Orphans are
  // owned by the retention sweeper, so "undo" of a content blob is a no-op (it stays under its
  // true hash; nothing references it after rollback).
  // TODO(touch-up): import putContent/hasContent (materials/matter/contentStore.js); for each
  // [hash,b64] in matter.casBlobs verify stored.hash === hash; verify casManifest sizes.
  const blobs = matter?.casBlobs ? Object.keys(matter.casBlobs).length : 0;
  return blobs;
}

async function receiveReels(reels, opts, landed) {
  // Instate each reel's fact-chain VERBATIM (the facts keep their source ids + provenance), then
  // verifyReel (self-contained — recomputes each fact's identity from p+content; needs NO
  // act-chain). This is the applyGraft engine with ALL act-chain machinery removed (no actHeads,
  // no verifyActChain, no act-fork gates) — a being is living matter, only Names have act-chains.
  // Cold gates still apply: reel-divergence (a (story,history,target,seq) the target already
  // holds with different content = a fork → refuse) and branch-collision.
  // TODO(touch-up): port the slimmed applyGraft insert: cold gates → landed[]-tracked insertMany
  // of facts/reelHeads/histories → verifyReel per (story,history,target) → root recompute; each
  // insert pushes { undo: () => Fact.deleteMany({_id:{$in:[…landed ids]}}) } onto `landed`.
  let count = 0;
  for (const r of (Array.isArray(reels) ? reels : [])) count += Array.isArray(r?.facts) ? r.facts.length : 0;
  return count;
}

async function receiveWords(words, body, opts, landed) {
  // Declare each word-def into the vocabulary (a coin fact per word), SCOPED to the book's root
  // (the language). Receiving a language = its words become resolvable within importers' pinned
  // set. Undo = retire (a coin's withdrawal is itself a fact).
  // TODO(touch-up): import declareOpsToFold/registerRoleWord (present/word/wordStore.js +
  // roleWordRegistry.js); for each word bindWord(name, binding, {history}) scoped to the language
  // root; push { undo: () => disableWord(...) } onto `landed`. The host `body.code` refs ground
  // any handler-backed words (receiveCode).
  return Array.isArray(words) ? words.length : 0;
}

async function receiveCode(code, opts, landed) {
  // Register the irreducible host refs a word-bundle's words need (the bottom turtle — emitFact,
  // CAS, fold). Only the genuine floor; everything else is composed words.
  // TODO(touch-up): wire the host-handler table (wordStore registerHostHandler by ref).
}
