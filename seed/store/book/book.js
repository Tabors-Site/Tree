// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// book.js — the Book shape (philosophy/word/book.md + book-build.md). A book has TWO FACES:
// the surface RENDER (covers, a told line, a colophon — readable pages) and the AST DAG
// underneath (the signed, content-addressed nodes). Same object, two faces — the book view
// shows pages while the chain stays exact. This file is the underneath; the render is its skin.
//
//   ══════════════════════════════════
//     press, extended            · title — a renderable Word
//     by Maple  mpl·7f3a…        · author = the bottom seal's signerId
//     closed · thin              · modes (see below)
//     #b3·a91c…                  · the book's own address = colophon.root
//
//     front cover — imports        covers.imports  (what it STANDS ON, by address)
//     ── body — the told line ──    body            (the DEEDS: past-tense Word, chained by "on")
//     back cover — exports         covers.exports  (what planting it GIVES)
//     colophon                     colophon.sig    (sealed by + countersignatures)
//   ══════════════════════════════════
//
//   book = {
//     title:  "press, extended",            // a renderable Word (the told line's name)
//     modes:  { closed, thin },             // closed = sealed snapshot (immutable, content-addressed;
//                                           //   the original stays OPEN at its head). open = the live head.
//                                           // thin  = deps carried by ADDRESS (small; receiver must reach them).
//                                           //   fat  = imported words INLINED (self-contained, large).
//     covers: {                             // front + back — each a renderable FACE + its interface able
//       front: { face, imports:[{word,root}] },   // imports = what it stands on; face = the front cover art
//       back:  { face, exports:[{word,root}] },    // exports = what planting gives you; face = the back cover
//     },                                    // a FACE is ANY matter — a word (title), an image, a model… or an
//                                           //   ibpa PORTAL: a live window into the SOURCE reality, SEE-gated
//                                           //   (goes black if the source refuses you). The cover shows where
//                                           //   the book is from, governed by the source's own SEE.
//     body: {                               // the TOLD LINE — deeds only, no "why"; the kind falls out of which keys exist
//       words?:  [ … ]                         // language — word-defs (.word source + coin facts)
//       reels?:  [ { facts, reelHeads, histories } … ]   // history — fact-chains. A being is living
//                                              //   matter (a reel — qualities.memory). NO act-chains in a
//                                              //   book: act-chains key per (story, history, being-cas), the
//                                              //   Name signs — local biography, stays home.
//       matter?: { casRefs, casBlobs, casManifest }      // model/file — content-addressed bytes
//       code?:   { ref → bundled-fn-id }                 // the irreducible host floor a word needs
//     },
//     colophon: { root, sig[], lineage:{ parent, sourceStory }, provenance }   // the uniform seal
//   }
//
// The colophon's `root` hashes over EVERYTHING sealed (title + modes + covers + body) — so the
// seal commits to the interface, not just the contents. Planting replays the body under your
// head: SEED if it imports nothing, BRANCH if cut from your own line, INSTATE if from another
// world (see receive.js). One file, one act, three names.

import { makeColophon, computeRoot, sealedContent } from "./colophon.js";

const hasContent = (v) =>
  Array.isArray(v) ? v.length > 0 : !!(v && typeof v === "object" && Object.keys(v).length > 0);

/**
 * The book's kind — DERIVED from which body parts are present + whether it composes imports.
 * No tag is ever stored.
 *   "language" words · "history" reels · "model" matter · "master" mostly imports · "mixed" · "empty"
 */
export function kindOf(book) {
  const body = book?.body ?? {};
  const imports = bookImports(book);
  const parts = [];
  if (hasContent(body.words)) parts.push("language");
  if (hasContent(body.reels)) parts.push("history");
  if (hasContent(body.matter)) parts.push("model");
  if (imports.length > 0 && parts.length === 0) return "master"; // composes others, packs little of its own
  if (imports.length > 0) parts.push("master");
  if (parts.length === 0) return "empty";
  return parts.length === 1 ? parts[0] : "mixed";
}

/**
 * Construct a book: title + modes + covers + body, plus a fresh (unsigned) colophon whose root
 * hashes the whole sealed object. Call sealColophon (colophon.js) to vouch it.
 *
 * @param {object} content { title?, modes?:{closed,thin}, covers?:{imports,exports}, body? }
 * @param {object} [opts]  { sourceStory, createdBy, parent, createdAt }
 */
export function makeBook(content = {}, opts = {}) {
  const sealed = {
    title: content.title || null,
    modes: { closed: false, thin: true, ...(content.modes || {}) },
    covers: {
      front: {
        face: content.covers?.front?.face || null, // any matter ref — word/image/model/ibpa-PORTAL
        imports: content.covers?.front?.imports || [],
      },
      back: {
        face: content.covers?.back?.face || null,
        exports: content.covers?.back?.exports || [],
      },
    },
    body: content.body || {},
  };
  return { ...sealed, colophon: makeColophon(sealed, opts) };
}

/** Front cover — the pinned (by-root, immutable) dependencies this book stands on. */
export function bookImports(book) {
  return book?.covers?.front?.imports ?? [];
}

/** Back cover — what planting this book gives you (the words/reels it exports). */
export function bookExports(book) {
  return book?.covers?.back?.exports ?? [];
}

/**
 * The renderable cover FACES — each is ANY matter ref (a word title, an image, a model, or an
 * ibpa PORTAL: a live window into the source reality, SEE-gated — black if the source refuses).
 * null = no face (render the title). The face is presentation; imports/exports are the interface.
 */
export function coverFaces(book) {
  return { front: book?.covers?.front?.face ?? null, back: book?.covers?.back?.face ?? null };
}

/** The author = the bottom seal's signerId (the first hand; later seals are countersignatures). */
export function author(book) {
  const sig = book?.colophon?.sig;
  return Array.isArray(sig) && sig.length ? sig[0].signerId : null;
}

/** Well-formed = a colophon whose root actually matches the sealed object (title+modes+covers+body). */
export function isBook(book) {
  return !!(
    book &&
    typeof book === "object" &&
    book.colophon &&
    book.colophon.root === computeRoot(sealedContent(book))
  );
}
