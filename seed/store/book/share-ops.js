// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// store/book/share-ops.js — SHARE, the producer verbs: capture-book (SEE) + share-book (DO).
//
//   capture-book = SEE  — pull selected elements into an UNSIGNED book (browse + package).
//   share-book   = DO   — lay a sealed book on the Library reel (the catalog entry). The act.
//
// The mirror of receive: capture reads a slice out, share lays it in the catalog, receive plants it
// home. Each shared book = ONE do:share-book fact on the library reel (the reel IS the library);
// the book BODY is CAS (the store is symbols), the fact carries only its address. The Name acts
// (act-chain); the book lands (Library reel). The colophon is the cross-story provenance.

import { registerOperation } from "../../ibp/operations.js";
import { registerSeeOperation } from "../../ibp/seeOps.js";
import { registerAbleWord } from "../../present/word/ableWordRegistry.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { verifyColophon } from "./colophon.js";
import { kindOf } from "./book.js";
import { captureBook } from "./capture.js";

// capture-book (SEE) — pure read. Pull selected story elements into an UNSIGNED book; the caller
// seals (sealColophon, the Name vouches) then shares. SEE = "nothing enters your story."
registerSeeOperation("capture-book", {
  ownerExtension: "seed",
  description:
    "Capture selected story elements (words / a being-reel slice / matter) into a Book",
  args: {
    select: {
      type: "json",
      label: "Selection { title?, words?, reelOf?, history?, matter?, code? }",
      required: true,
    },
  },
  handler: async ({ identity, args, history }) => {
    if (!identity?.beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "capture-book: identity required (the capturing being)",
      );
    }
    const select = args?.select;
    if (!select || typeof select !== "object") {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "capture-book: `select` is required",
      );
    }
    // (Self-or-heaven gating on reel slices that carry be:birth facts is a refinement — TODO,
    //  mirror capture-being's gate; the words/own-reel cases are the common path.)
    const book = await captureBook({
      history: history || "0",
      createdBy: identity?.nameId ?? null,
      ...select,
    });
    return { book };
  },
});

// share-book (DO) — lay a sealed Book on the Library reel as a 5D NAME-ACT. Sharing a book is a NAME
// acting in the library (5d.md: only names act there; the being stays home) — a bodiless verb:"name"
// fact on the library reel (kind="library"), the catalog entry. NOT a do-fact.
//
// WORD-SOLE (Tabor's no-mirror law): NO JS handler. share-book.word VALIDATES + authors the name-act's
// `factParams` (the catalog entry); do.js's runOpNameAct (word.factVerb:"name") lays the 5D library
// name-act — the EXACT shape layBookOnLibrary laid. The genuine work is the floor read
// resolve-share-book-spec (shareBookHostEnv): verify the colophon + CAS-store the body (idempotent,
// content-addressed → SEE-shaped, like mint-credential) + build factParams. No after-name-act: the CAS
// bytes are stored when the floor READ runs, BEFORE the name-act seals (IDENTICAL ordering to today).

// shareBookHostEnv — the floor read for share-book.word. resolve-share-book-spec verifies the
// colophon (refuse-before-share), CAS-stores the body via storeBookBody (putContent — content-
// addressed, idempotent: the bytes land when this read runs, before the name-act seals, so a reader's
// resolveBook fetches them back), and builds the library name-act factParams (bookFactParams). Throws
// the SAME IbpErrors the JS handler threw. The acting Name (sharedBy / the fact's `by`) is the
// caller's identity, falling back to the I — read from ctx.identity to match the old handler exactly.
export function shareBookHostEnv() {
  return {
    "resolve-share-book-spec": async ({ args: [target, params] }, ctx) => {
      const book = params?.book;
      if (!book || typeof book !== "object") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          "share-book: params.book is required (the sealed book to share)",
        );
      }
      const v = await verifyColophon(book);
      if (!v.ok) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `share-book: colophon verification failed — ${v.reason}`,
        );
      }
      // The acting Name — the sharer's identity (falls back to the I for seed-internal shares),
      // the SAME derivation the old handler used. `sharedBy` here matches the name-act's `by` (which
      // do.js's runOpNameAct derives identically from ctx.identity).
      const nameId =
        ctx?.identity?.nameId ?? ctx?.identity?.beingId ?? "i-am";
      // CAS-store the body (idempotent, content-addressed) → bodyRef, BEFORE the name-act seals —
      // identical ordering to layBookOnLibrary (storeBookBody then emitFact).
      const { storeBookBody, bookFactParams } = await import("./library.js");
      const bodyRef = await storeBookBody(book);
      const factParams = bookFactParams(book, bodyRef, {
        sharedBy: nameId,
        kind: kindOf(book),
      });
      return {
        root: v.root,
        bodyRef,
        signers: v.signers ?? [],
        unsigned: !!v.unsigned,
        factParams,
      };
    },
  };
}

registerAbleWord(
  "book",
  "share-book",
  new URL("./share-book.word", import.meta.url),
);

registerOperation("share-book", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "share-book",
  word: { noun: "library", able: "book", factVerb: "name" },
  hostEnv: shareBookHostEnv,
});

// library (SEE) — the catalog: the Books shared into this story's Library (the reel IS the
// catalog). Replaces the old `clones` discovery op. Pure read; search/visit/plant start here.
registerSeeOperation("library", {
  ownerExtension: "seed",
  description:
    "List the Books in this story's Library (the shared-book catalog)",
  args: {},
  handler: async () => {
    const { listLibrary } = await import("./library.js");
    return { books: await listLibrary() };
  },
});

// share-story (DO) — capture the WHOLE story as a genome/master Book: full facts + acts +
// histories + reelHeads, verbatim. It is the ONE book that DOES carry act-chains, because it is
// YOU moving substrate (your whole reality, your Name's chains), not content shared among Names —
// 5d.md's whole-story migration, the exception to "a book carries reels, not act-chains." Heaven-
// gated. Replaces the old `capture-graft` op; the captureGraft engine is its internal.
registerOperation("share-story", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "share-story",
  // No skipAudit: captureGraft lays the whole-story name-act on the library reel; ranAsMoments
  // (returned below) tells the dispatcher to stamp none of its own.
  args: {
    storyName: {
      type: "text",
      label: "Story name (optional)",
      required: false,
    },
  },
  handler: async ({ identity, params }) => {
    if (!identity?.beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "share-story: identity required",
      );
    }
    const { hasHeavenAuthority } =
      await import("../../materials/space/heavenLineage.js");
    if (!(await hasHeavenAuthority(identity.beingId))) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "share-story: only beings with heaven authority may capture the whole story (the genome).",
      );
    }
    const { captureGraft } = await import("./graft.js");
    const result = await captureGraft({
      capturedBy: String(identity.beingId),
      storyName: params?.storyName || null,
    });
    const { ranAsMoments } = await import("../../ibp/factResult.js");
    return ranAsMoments({
      savedTo: result.savedTo,
      counts: result.bundle.meta.counts,
    });
  },
});
