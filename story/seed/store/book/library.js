// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// library.js — the Library: this story's catalog of shared Books (5d.md — the 5D catalog, Ours).
//
// The library SPACE's reel IS the library (place-is-folded-from-facts): each `do:share-book` fact
// on it is a catalog entry. The book BODY lives as CAS — the store is symbols (11.md), the fact
// carries only its address. This module is the READ side + the CAS body store; the share-book op
// (share-ops.js) does the laying. `resolveBook` backs receive.js's import resolver — a book imports
// another by `colophon.root`, sealed-by-hash (the lockfile, language.md), so meaning can't drift.
//
// No librarian (5d.md): the catalog is just the reel; provenance is the colophon stamp inside each
// book, not an institution. No scarcity — the body is CAS, infinite perfect copies (the Love economy).

import { HEAVEN_SPACE } from "../../materials/space/heavenSpaces.js";

let _libraryId = null;
const _cache = new Map(); // colophon.root -> book (a projection of the reel; rebuilt on miss)

/** The library space id (a heaven space, always history "0"). Resolved + cached. */
export async function getLibraryId() {
  if (_libraryId) return _libraryId;
  const { findByHeavenSpace } = await import("../../materials/projections.js");
  const lib = await findByHeavenSpace(HEAVEN_SPACE.LIBRARY, "0");
  _libraryId = lib?.id ? String(lib.id) : null;
  return _libraryId;
}

/** Store a book BODY as CAS (the symbols). Returns a cas ref { kind:"cas", hash, size }. */
export async function storeBookBody(book) {
  const { putContent } = await import("../../materials/matter/contentStore.js");
  const stored = await putContent(JSON.stringify(book), { mimeType: "application/json", name: "book.json", encoding: "utf8" });
  return { kind: "cas", hash: stored.hash, size: stored.size };
}

/** Load a book BODY back from its cas hash (null if absent/corrupt). */
export async function loadBookBody(hash) {
  const { getContent } = await import("../../materials/matter/contentStore.js");
  const buf = await getContent(String(hash));
  if (!buf) return null;
  try { return JSON.parse(buf.toString("utf8")); } catch { return null; }
}

/** Every catalog entry on the library reel: [{ root, title, author, sharedBy, bodyRef, kind, seq }]. */
export async function listLibrary() {
  const libraryId = await getLibraryId();
  if (!libraryId) return [];
  const Fact = (await import("../../past/fact/fact.js")).default;
  const facts = await Fact.find({ "of.kind": "space", "of.id": libraryId, verb: "do", act: "share-book" }).sort({ seq: 1 }).lean();
  return facts.map((f) => ({ ...(f.params || {}), seq: f.seq, factId: f._id }));
}

/** Resolve a Book by its colophon.root — read the reel entry, fetch the CAS body. Caches by root. */
export async function resolveBook(root) {
  const r = String(root);
  if (_cache.has(r)) return _cache.get(r);
  const entries = await listLibrary();
  const entry = [...entries].reverse().find((e) => String(e.root) === r); // latest share of this root wins
  if (!entry || !entry.bodyRef?.hash) return null;
  const book = await loadBookBody(entry.bodyRef.hash);
  if (book) _cache.set(r, book);
  return book;
}

/** The catalog-fact params for a book — ONE shape, used by the share-book op + the direct lay. */
export function bookFactParams(book, bodyRef, { sharedBy = null, kind = null } = {}) {
  return {
    root: book?.colophon?.root ?? null,
    title: book?.title ?? null,
    author: book?.colophon?.sig?.[0]?.signerId ?? null, // the first/bottom seal = the author
    sharedBy: sharedBy ?? null,
    kind: kind ?? null,
    bodyRef,
  };
}

/**
 * Lay a book on the library reel DIRECTLY — the genesis / internal path (no dispatch frame). It
 * CAS-stores the body + emitFacts the do:share-book catalog fact within the given moment. The
 * share-book OP uses stampsFact instead (the dispatcher stamps — the keystone); this is the
 * equivalent for the I_AM genesis scaffold, producing the identical fact shape.
 * @param {object} book   a sealed book
 * @param {object} ctx    { moment, through?, kind? }  — the I_AM act frame
 */
export async function layBookOnLibrary(book, { moment, through = "i-am", kind = null } = {}) {
  const libraryId = await getLibraryId();
  if (!libraryId) throw new Error("layBookOnLibrary: the library space is not planted");
  const bodyRef = await storeBookBody(book);
  const { emitFact } = await import("../../past/fact/facts.js");
  const params = bookFactParams(book, bodyRef, { sharedBy: through, kind });
  await emitFact(
    { verb: "do", act: "share-book", through, of: { kind: "space", id: libraryId }, params, history: "0" },
    moment,
  );
  _cache.set(String(book?.colophon?.root), book);
  return { root: book?.colophon?.root, bodyRef };
}

/** Drop the in-memory cache (after a fresh share, or in tests). */
export function clearLibraryCache() { _cache.clear(); _libraryId = null; }
