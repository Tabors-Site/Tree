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
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { stampsFact } from "../../ibp/factResult.js";
import { verifyColophon } from "./colophon.js";
import { kindOf } from "./book.js";
import { captureBook } from "./capture.js";
import { getLibraryId, storeBookBody, bookFactParams } from "./library.js";

// capture-book (SEE) — pure read. Pull selected story elements into an UNSIGNED book; the caller
// seals (sealColophon, the Name vouches) then shares. SEE = "nothing enters your story."
registerSeeOperation("capture-book", {
  ownerExtension: "seed",
  description: "Capture selected story elements (words / a being-reel slice / matter) into a Book",
  args: {
    select: { type: "json", label: "Selection { title?, words?, reelOf?, history?, matter?, code? }", required: true },
  },
  handler: async ({ identity, args, history }) => {
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "capture-book: identity required (the capturing being)");
    }
    const select = args?.select;
    if (!select || typeof select !== "object") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "capture-book: `select` is required");
    }
    // (Self-or-heaven gating on reel slices that carry be:birth facts is a refinement — TODO,
    //  mirror capture-being's gate; the words/own-reel cases are the common path.)
    const book = await captureBook({ history: history || "0", createdBy: identity?.nameId ?? null, ...select });
    return { book };
  },
});

// share-book (DO) — lay a sealed Book on the Library reel. Refuse-before-share (verifyColophon,
// mirroring receive's seal-check). The dispatcher stamps the do:share-book fact, attributed to the
// sharing Name, landing on the library reel (_factTarget wins in resolveAuditTarget).
registerOperation("share-book", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "share-book",
  // NO skipAudit — the dispatcher stamping the catalog fact onto the library reel IS the point.
  handler: async ({ params, identity }) => {
    const book = params?.book;
    if (!book || typeof book !== "object") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "share-book: params.book is required (the sealed book to share)");
    }
    const v = await verifyColophon(book);
    if (!v.ok) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, `share-book: colophon verification failed — ${v.reason}`);
    }
    const libraryId = await getLibraryId();
    if (!libraryId) {
      throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "share-book: the library space is not planted");
    }
    // Store the body as CAS (symbols); the fact carries its address. Infinite perfect copies.
    const bodyRef = await storeBookBody(book);
    return stampsFact(
      { root: v.root, bodyRef, signers: v.signers ?? [], unsigned: !!v.unsigned },
      bookFactParams(book, bodyRef, { sharedBy: identity?.nameId ?? null, kind: kindOf(book) }),
      { kind: "space", id: libraryId },
    );
  },
});

// library (SEE) — the catalog: the Books shared into this story's Library (the reel IS the
// catalog). Replaces the old `clones` discovery op. Pure read; search/visit/plant start here.
registerSeeOperation("library", {
  ownerExtension: "seed",
  description: "List the Books in this story's Library (the shared-book catalog)",
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
  skipAudit: true,
  args: { storyName: { type: "text", label: "Story name (optional)", required: false } },
  handler: async ({ identity, params }) => {
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "share-story: identity required");
    }
    const { hasHeavenAuthority } = await import("../../materials/space/heavenLineage.js");
    if (!(await hasHeavenAuthority(identity.beingId))) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "share-story: only beings with heaven authority may capture the whole story (the genome).");
    }
    const { captureGraft } = await import("../../materials/publish/graft.js");
    const result = await captureGraft({ capturedBy: String(identity.beingId), storyName: params?.storyName || null });
    return { savedTo: result.savedTo, counts: result.bundle.meta.counts, _skipAudit: true };
  },
});
