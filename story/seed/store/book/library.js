// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// library.js — the Library: this story's ONE 5D fact reel (5d.md — Ours, the catalog of worlds).
//
// The library is the 5th reel KIND (`of:{kind:"library", id:<story>}`), one reel per story, OUT of
// any history (it never forks — separated by kind, not by a history marker; the facts ride
// history "0", the reel's main short-circuit). It holds the name-level / cross-history facts —
// shared books, federation peers, story config — all **signed by the Name** acting there (a 5D
// NAME-ACT: through=null, the being stays home; verb:"name"). NOT a heaven *space*; a story-level
// reel. The book BODY is CAS (the store is symbols); the fact carries only its address.
//
// `resolveBook` backs receive.js's import resolver (import-by-colophon.root, the lockfile). No
// librarian: the reel IS the catalog; provenance is the colophon stamp; infinite perfect copies (Love).

let _cache = new Map(); // colophon.root -> book (a projection of the reel; rebuilt on miss)

/** The library reel id = this story's domain (one library per story). */
export async function getLibraryId() {
  const { getStoryDomain } = await import("../../ibp/address.js");
  return getStoryDomain();
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
  // CURATED: the library is the 5th reel KIND (of:{kind:"library", id:<story>}),
  // out of any history — its facts ride history "0" (the reel's main
  // short-circuit). getFactsOnReelWhere reads that ONE reel and keeps the
  // share-book facts, seq-ascending (the file-native peer of Mongo's
  // Fact.find({"of.kind":"library","of.id":libraryId, act:"share-book"}).sort(seq)).
  const { getFactsOnReelWhere } = await import("../../past/fact/facts.js");
  const facts = getFactsOnReelWhere(
    "0",
    "library",
    libraryId,
    (f) => f.act === "share-book",
  );
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
 * Lay a book on the library reel as a 5D NAME-ACT fact — verb:"name", bodiless (through=null),
 * signed by `by` (the Name). CAS-stores the body, emitFacts the catalog fact within the given
 * withNameAct moment (history "0" — the reel's main short-circuit). The act-chain advances on the
 * name's 5D chain (<story>:5d:<name>); the fact lands on the library reel.
 * @param {object} book   a sealed book
 * @param {object} ctx    { moment, by, kind? }  — the name-act frame + the signing Name
 */
export async function layBookOnLibrary(book, { moment, by = "i-am", kind = null } = {}) {
  const libraryId = await getLibraryId();
  const bodyRef = await storeBookBody(book);
  const { emitFact } = await import("../../past/fact/facts.js");
  await emitFact(
    {
      verb: "name", // 5D / identity layer — a bodiless name-act, not a do/be world-fact
      act: "share-book",
      through: null, // the being stays home
      by,
      of: { kind: "library", id: libraryId },
      params: bookFactParams(book, bodyRef, { sharedBy: by, kind }),
      actId: moment?.actId,
      history: "0", // the library reel never forks
    },
    moment,
  );
  _cache.set(String(book?.colophon?.root), book);
  return { root: book?.colophon?.root, bodyRef };
}

/** Drop the in-memory cache (after a fresh share, or in tests). */
export function clearLibraryCache() { _cache = new Map(); }
