// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ActHead. The per-(story, history, being) act-chain head.
//
// Every being's act-chain (math.md A_b) is hash-linked: each act's
// identity folds in the previous act's identity via `p`. This
// collection holds the chain's live tip — `headHash`, the being's
// last SEALED act on that (story, history). assign reads it to mint the
// next act's `p`; sealAct (and crossWorld's direct open — the documented
// exception) advance it where the row actually lands. A crashed
// moment never advances the head, so the chain only ever points at
// acts that exist ("a crashed moment leaves zero trace").
//
// STORY in the key (not just history): a Name acts ACROSS stories — it
// acts in other realities through a being granted there (cross-network
// acts). So a Name does not have one chain; its acts spread across
// (story, being) pairs, each a local chain, and the Name signs across
// all of them. Without `story` a foreign act would collide on a local
// (history, being) head and interleave two chains — the prev-hashes
// stop lining up and verifyActChain breaks. The being keys the chain
// (the vessel it acted through); the Name signs (`by`), it is NOT the
// key. `story` is REQUIRED (no silent default) so a missing story
// throws at the seam instead of quietly corrupting a chain.
//
// Same furniture class as ReelHead: a write-side pointer, not a
// projection of the fold, and not part of any root hash today (the
// story root covers chain state; see PORT-NOTES #6 for extending
// it over act chains now that they are verifiable).
//
// `_id` shape: `<story>:<history>:<beingId>`.

import mongoose from "mongoose";

const ActHeadSchema = new mongoose.Schema({
  _id:      { type: String },          // "<story>:<history>:<beingId>"
  story:    { type: String, required: true },   // the reality the acts happened in (cross-network scope)
  history:  { type: String, required: true, default: "0", index: true },
  beingId:  { type: String, required: true },
  headHash: { type: String, default: null },
});

ActHeadSchema.index({ story: 1, history: 1, beingId: 1 }, { unique: true });

const ActHead = mongoose.model("ActHead", ActHeadSchema, "actHeads");
export default ActHead;
