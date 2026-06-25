// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// store/book/ops.js — the receive-book DO op. Taking a Book in is the receiver's OWN act, so
// the dispatcher stamps the fact (the keystone: an act authors its fact, the dispatcher is the
// one scribe). This op self-registers at module load; seed/services.js imports it.
//
//   visit = SEE (read-in-place)   ·   receive-book = plant + countersign (the one commitment)
//
// receive.js owns the engine (seal-check → atomic instate → rollback → colophon seal). This op
// makes it the receiver's act: it returns stampsFact(...) so the dispatcher lays ONE
// do:receive-book fact on the receiver's own being reel, attributed to the acting Name.

import { registerOperation } from "../../ibp/operations.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { stampsFact } from "../../ibp/factResult.js";
import { receive } from "./receive.js";

function receiverBeingIdOf(target, identity) {
  if (target && target.kind === "being" && target.id) return String(target.id);
  if (identity?.beingId) return String(identity.beingId);
  return null;
}

registerOperation("receive-book", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "receive-book",
  // NO skipAudit — the dispatcher stamping the countersign fact is the whole point.
  handler: async ({ target, params, identity, history, moment }) => {
    const receiverBeingId = receiverBeingIdOf(target, identity);
    if (!receiverBeingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "receive-book: an identified receiving being is required");
    }
    const book = params?.book;
    if (!book || typeof book !== "object") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "receive-book: params.book is required (the book to receive)");
    }

    // The engine: seal-check (refuse-before-plant) → atomic plant → rollback → colophon seal.
    // The receiver authors the word coins + records the receive; its Name vouches the colophon.
    const got = await receive(book, {
      at: params?.at ?? null,
      as: identity?.nameId ?? null,
      actorBeingId: receiverBeingId,
      history,
      moment,
      allowUnsigned: !!params?.allowUnsigned,
    });

    // Declare the countersign fact; the dispatcher stamps do:receive-book (attributed to the
    // acting Name, landing on the receiver's own being reel). stripForAudit drops _factParams.
    return stampsFact(
      got,
      {
        root: got.root,
        kind: got.kind,
        counts: { imports: got.imports.length, words: got.words, reels: got.reels, matter: got.matter },
      },
      { kind: "being", id: receiverBeingId },
    );
  },
});
