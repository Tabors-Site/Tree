// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ActHead. The per-being, per-history act-chain head.
//
// Every being's act-chain (math.md A_b) is hash-linked: each act's
// identity folds in the previous act's identity via `p`. This
// collection holds the chain's live tip — `headHash`, the being's
// last SEALED act on that history. assign reads it to mint the next
// act's `p`; sealAct (and crossWorld's direct open — the documented
// exception) advance it where the row actually lands. A crashed
// moment never advances the head, so the chain only ever points at
// acts that exist ("a crashed moment leaves zero trace").
//
// Same furniture class as ReelHead: a write-side pointer, not a
// projection of the fold, and not part of any root hash today (the
// story root covers chain state; see PORT-NOTES #6 for extending
// it over act chains now that they are verifiable).
//
// `_id` shape: `<history>:<beingId>`.

import mongoose from "mongoose";

const ActHeadSchema = new mongoose.Schema({
  _id:      { type: String },          // "<history>:<beingId>"
  history:  { type: String, required: true, default: "0", index: true },
  beingId:  { type: String, required: true },
  headHash: { type: String, default: null },
});

ActHeadSchema.index({ history: 1, beingId: 1 }, { unique: true });

const ActHead = mongoose.model("ActHead", ActHeadSchema, "actHeads");
export default ActHead;
