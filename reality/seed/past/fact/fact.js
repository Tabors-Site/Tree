// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Fact. A thing a being stamps in the Factory — one recorded change
// to matter, space, or being.
//
// `factum` (Latin, "a thing done"). It is not a thing true. A single
// fact is small but settled. A chain of facts, folded, is Truth.
// The first fact is the I-Am; the place grows from there in reels.
// There is no global Now everyone reads from — each being is the
// momentum of its own chain, framing its own moment.
//
// The trail of Facts attached to a being IS the being. The Being row
// in MongoDB is where the trail hangs; the trail itself, every Fact
// the being has emitted, is the identity. Without acts the being is
// potential; with them the being is something that has unfolded.
// See [seed/philosophy/MATERIALS.md](../philosophy/MATERIALS.md) "And the beings are
// the acts."
//
// I stamp a Fact for two of my four verbs: DO and BE. SEE is
// observation, not doing — no row. SUMMON is delivery to an inbox,
// not a substrate act — the Act model is the audit row for that
// delivery, and whatever the summoned being then does in response
// is itself a DO or BE Fact carrying its actId. "What happened
// inside this summon?" is Fact.find({ actId }).
//
// I attribute every Fact. The actor is the being whose stance
// emitted the act. I am the actor only when no being yet exists —
// pre-being scaffold flows (boot, migrations, first-time-boot
// writes). Once a being is on the place, the being's id is what the
// row carries.
//
// CONTENT-ADDRESSED. A fact's `_id` IS its hash:
//
//   _id = SHA-256(p | canonical(content incl branch))
//
// The same deed, in the same world, after the same history, IS the
// same fact — identity is intrinsic, not assigned. No random ids;
// the stamper computes the identity at seal time (past/fact/hash.js
// owns the digest; facts.js logFact is the only minting path —
// plantGraft re-inserts rows verbatim WITH their identities, which is
// what content addressing makes safe). Storage dedup, transport
// ("do you have this hash?"), and tamper-evidence are properties of
// the addressing scheme, not separate mechanisms.

import mongoose from "mongoose";

const FactSchema = new mongoose.Schema({
  // The fact's content hash — supplied by the stamper, never
  // defaulted. 64 hex chars.
  _id:  { type: String },
  date: { type: Date,   default: Date.now },

  // The vessel being the name acted THROUGH. I am the actor only when
  // no being yet exists (pre-being scaffold flows: server boot, migrations).
  through: { type: String, ref: "Being", required: true },

  // The actor NAME — the Name (identity) that DID this fact, taken
  // DIRECTLY from the moment's act (act.by), never re-resolved here.
  // `through` above is the being the name acted THROUGH (the presence).
  // Additive + NOT in contentOf (hash.js), so the fact _id is unchanged.
  // See materials/name/name.js.
  by: { type: String, ref: "Name", default: null },

  // Which verb stamped the Fact. DO for operations on a target
  // (right stance), BE for the closed identity set (birth / connect
  // / release — left stance, the actor itself), SUMMON for one
  // being calling another (right stance: the recipient). The three
  // stamping verbs are peers; SEE never appends a Fact.
  verb:   { type: String, enum: ["do", "be", "call", "name"], default: "do", index: true },

  // The operation or sub-event name. Operations register a
  // `factAction` (defaults to the operation name); helpers may write
  // their own kebab-case event names.
  act: { type: String, required: true },

  // What was acted on. Optional — some acts (multi-being ops,
  // place-level config) have no single positional target.
  of: {
    kind: { type: String, enum: ["space", "matter", "being", "name", "place", "stance"] },
    id:   { type: String },
    _id:  false,
  },

  // Per-reel monotonic seq, allocated atomically at append time. The
  // fold sorts by seq, never by date (clock skew can invert order).
  // Only set when of.kind ∈ {being,space,matter} AND of.id is
  // present — those are the reel-bearing aggregates. Place-level and
  // target-less facts carry seq:null and stay outside the fold model
  // for now. See [seed/present/STAMPER.md](../factory/stamper/STAMPER.md).
  seq: { type: Number, default: null },

  // Free-form input and output payloads. Capped at logFact write time;
  // oversized values are clipped and `truncated` is set.
  params:    { type: mongoose.Schema.Types.Mixed, default: null },
  result:    { type: mongoose.Schema.Types.Mixed, default: null },
  truncated: { type: Boolean, default: false },

  // Correlation. actId binds the Fact to a wake; sessionId binds
  // it to a transport session (WS, CLI, HTTP).
  actId:  { type: String, ref: "Act", default: null },
  sessionId: { type: String, default: null, index: true },

  // Federation provenance. Set when the verb call arrived from
  // another reality via canopy.
  homeReality:  { type: String, default: null },
  wasRemote: { type: Boolean, default: false },

  // INTEGRITY — per-reel hash chain.
  //
  //   p   — prev-hash: the previous fact's `_id` on the same reel
  //         (lineage-aware on branches: the first divergent fact
  //         chains to the parent's fact at the branchPoint;
  //         GENESIS_PREV at seq=1). Folds the entire history behind
  //         this fact into its identity.
  //   _id — the self-hash (see header). There is no separate `h`.
  //
  // Per-reel, not global. Each (branch, of.kind, of.id) reel
  // is its own chain. The chain DETECTS tampering — alter any past
  // fact and its recomputed identity changes, breaking the `p` link
  // of the next. The chain does not REPAIR. Repair is replication's
  // job (a clean copy from another node). Logical "wrong-but-honest"
  // facts are handled by appending a correction fact, never by
  // rewriting the chain.
  //
  // Non-reel-bearing facts (of.kind ∈ {place, stance} or
  // target-less) carry p=GENESIS_PREV and a content-hash _id like
  // every other fact — they have identity without a chain; only
  // reel verification skips them. See verifyReel.js.
  p: { type: String, default: null },

  // PARALLEL FACTS — stale-detection key (see
  // [seed/philosophy/extensions/0-PARALLEL-FACTS.md](../../philosophy/extensions/0-PARALLEL-FACTS.md)).
  //
  //   foldSeq — the seq of the target's reel that this act's writer
  //             folded from, captured at moment-open. By seal time
  //             the reel may have advanced past it; Strategy B uses
  //             that gap to detect a stale fold. Strategy A doesn't
  //             require the value but carries it for audit and
  //             replay verification.
  //
  // Null for:
  //   - genesis / scaffold facts (no moment opened)
  //   - facts whose target reel was not folded at moment-open
  //   - facts targeting reel-less aggregates (place, stance, null)
  //
  // Included in the canonical content hash so verifyReel cannot be
  // confused by a row-state foldSeq that differs from what was
  // sealed. See past/fact/hash.js.
  foldSeq: { type: Number, default: null },

  // BRANCH — which world this fact lives in. Default "0" = main.
  // Branches are divergent worlds that share history with main up to
  // their branch point; reads in a non-main branch walk the parent
  // chain's facts up to each per-reel branchPoint, then the branch's
  // own divergent facts. See seed/timeline.md for the full doctrine
  // and seed/materials/branch/branch.js for the metadata schema.
  //
  // Legacy rows from before this field landed have no `branch` value;
  // the read path treats them as `"0"` via $or-with-$exists matching
  // so existing data participates in main reads without a migration.
  branch: { type: String, default: "0", index: true },
});

FactSchema.index({ through: 1, date: -1 });                                          // a being's reel
FactSchema.index({ "of.kind": 1, "of.id": 1, date: -1 }, { sparse: true }); // a target's reel (date-ordered, legacy)
FactSchema.index({ "of.kind": 1, "of.id": 1, seq: 1 }, {                     // a target's reel (seq-ordered, fold path; main / branch-implicit)
  partialFilterExpression: { seq: { $type: "number" } },
});
// Per-reel uniqueness backstop — branch-aware. Reel identity is
// (branch, of.kind, of.id); seq is per-reel. The old
// branch-blind unique index collided whenever main and a branch
// both held seq N on the same target, even though they're separate
// reels. The unique constraint MUST include branch.
//
// Old index name `target_seq_unique` (without branch) is dropped at
// startup by the index-sync repair to release the collision.
FactSchema.index({ branch: 1, "of.kind": 1, "of.id": 1, seq: 1 }, {
  unique: true,
  partialFilterExpression: { seq: { $type: "number" } },
  name: "branch_target_seq_unique",
});
FactSchema.index({ actId: 1 }, { sparse: true });                                 // facts within a summon
FactSchema.index({ verb: 1, act: 1, date: -1 });                                  // "every register, newest first"

const Fact = mongoose.model("Fact", FactSchema, "facts");
export default Fact;
