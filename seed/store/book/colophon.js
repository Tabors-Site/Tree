// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// colophon.js — the uniform seal every Book carries (philosophy/word/book.md + book-build.md).
//
// A Book = a SEALED object (title + modes + covers + body) + a colophon over it. The colophon
// is WHO carried it + the trace back to the Root, and it is IDENTICAL in shape for every book —
// that uniformity is what lets one `receive`, one search, one seal-check work on every book.
//
//   colophon = {
//     root:       <sha256 over the SEALED object: title+modes+covers+body>   // the book's own address
//     sig:        [ { signerId, value } … ]        // a STACK of seals, newest last, back to the Root.
//     lineage:    { parent, sourceStory }          // descent (imports/exports are the book's COVERS).
//     provenance: { createdAt, createdBy, bundleVersion }
//   }
//
// The seal is the copyist's mark (colophon.md): `I carried this, here is the hand it came from`.
// SIGNING IS OPTIONAL — an unsigned book is valid (just unvouched); sign your FIRST book and it
// becomes your root, and everything else colophons off it. `signerId` = a Name/story public-key
// id; `value` = its signing key over `root` — self-certifying (decode the key from signerId,
// check the sig). Reuses the same machinery as `signedStoryRoot` / `verifyStoryRootSig`.
//
// The root hashes the SEALED OBJECT (not just the body), so the seal commits to the interface
// (the covers — imports/exports) and the title/modes too, not only the contents.

import crypto from "crypto";
import { getStoryIdentity, signData } from "../../storyIdentity.js";
import { verifyStoryRootSig } from "../../past/fact/chainRoots.js";

const BOOK_VERSION = 1;

// Deterministic canonical serialization: object keys sorted recursively, so the same content
// always hashes the same regardless of key order. The sealed object must be plain JSON (the
// reels' facts are already content-addressed — their _ids are hashes — so hashing it commits to
// the reels, the matter manifest, the word coin-facts, AND the covers).
function canonicalize(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (v instanceof Map) return canonicalize(Object.fromEntries(v));
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize(v[k]))
      .join(",") +
    "}"
  );
}

/** The sealed part of a book — everything the root commits to (i.e. everything but the colophon). */
export function sealedContent(book) {
  if (!book || typeof book !== "object") return {};
  const { colophon, ...sealed } = book;
  return sealed;
}

/**
 * The book's content-identity — sha256 over its SEALED object (title + modes + covers + body).
 * This is what the colophon's seal vouches, what an import pins by, and what `receive` recomputes
 * to prove nothing was tampered. Pass `sealedContent(book)` (or the bare sealed object).
 */
export function computeRoot(sealed) {
  return crypto.createHash("sha256").update(canonicalize(sealed ?? {}), "utf8").digest("hex");
}

/**
 * A fresh colophon for a new book: the root over its sealed object + provenance + lineage
 * (descent). No seal yet — `sealColophon` appends one if the author wants to vouch it. (The
 * import/export pair is the book's COVERS, not the colophon — covers are part of the sealed
 * object the root commits to.)
 *
 * @param {object} sealed  the sealed object (title+modes+covers+body)
 * @param {object} [opts]  { sourceStory, createdBy, parent, createdAt }
 */
export function makeColophon(sealed, opts = {}) {
  return {
    root: computeRoot(sealed),
    sig: [],
    lineage: {
      parent: opts.parent || null,
      sourceStory: opts.sourceStory || null,
    },
    provenance: {
      createdAt: opts.createdAt || null, // wall-clock is host-time; the caller stamps it (no Date.now in seed)
      createdBy: opts.createdBy || null,
      bundleVersion: BOOK_VERSION,
    },
  };
}

/**
 * Default signer = the story identity (the I-Am's key — the reality's root seal). For a Name's
 * own book, pass a signer { signerId, sign(root)->base64 } resolved from the Name's key.
 */
function storySigner() {
  return { signerId: getStoryIdentity().storyId, sign: (root) => signData(root) };
}

/**
 * Seal a book: recompute the root over its sealed object and PUSH a seal onto the colophon stack
 * (a colophon is a stack — every copyist who re-shares appends; the bottom seal is the root book).
 * Returns a new book with the updated colophon. Signing is optional; call this only to vouch.
 *
 * @param {object} book   { title?, modes?, covers?, body?, colophon? }
 * @param {object} [signer] { signerId, sign(root)->base64 }; defaults to the story identity.
 */
export function sealColophon(book, signer = null) {
  const sealed = sealedContent(book);
  const root = computeRoot(sealed);
  const s = signer || storySigner();
  const value = s.sign(root);
  const colophon = book?.colophon ? { ...book.colophon } : makeColophon(sealed);
  colophon.root = root; // re-anchor in case the sealed content changed since makeColophon
  colophon.sig = (Array.isArray(colophon.sig) ? colophon.sig.slice() : []).concat({
    signerId: s.signerId,
    value,
  });
  return { ...book, colophon };
}

/**
 * Verify a book's colophon — the seal `receive` checks BEFORE planting anything (refuse-before-
 * plant). Two proofs:
 *   1. tamper-evidence: recompute the root over the sealed object; it must equal colophon.root.
 *   2. authenticity:    every seal in the stack verifies against its signerId (self-certifying).
 * An UNSIGNED book is valid (ok:true, unsigned:true) — just unvouched. A tampered book or a
 * forged seal fails.
 *
 * @returns {Promise<{ ok:boolean, root:string, unsigned?:boolean, signers?:string[], reason?:string, badSig?:object }>}
 */
export async function verifyColophon(book) {
  const colophon = book?.colophon ?? {};
  const root = computeRoot(sealedContent(book));

  if (colophon.root && colophon.root !== root) {
    return {
      ok: false,
      root,
      reason: `root mismatch: the book hashes ${root.slice(0, 12)}… but the colophon claims ${String(colophon.root).slice(0, 12)}… — it was altered.`,
    };
  }

  const sigs = Array.isArray(colophon.sig) ? colophon.sig : [];
  if (sigs.length === 0) return { ok: true, root, unsigned: true };

  for (const s of sigs) {
    if (!s?.signerId || !s?.value) {
      return { ok: false, root, reason: "malformed seal (missing signerId/value)", badSig: s };
    }
    const ok = await verifyStoryRootSig(colophon.root || root, s.signerId, s.value);
    if (!ok) {
      return {
        ok: false,
        root,
        reason: `seal by ${String(s.signerId).slice(0, 14)}… failed verification — forged or wrong key.`,
        badSig: s,
      };
    }
  }
  return { ok: true, root, signers: sigs.map((s) => s.signerId) };
}
