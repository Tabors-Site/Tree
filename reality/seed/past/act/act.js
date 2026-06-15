// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Act. One moment a being committed, recorded on the being's
// act-chain.
//
// SUMMON is the verb — one being calling another into a moment.
// The Act is the noun the moment leaves behind. An Act opens at
// beat 1 (assign), gets pressed at beat 3 (momentum), and seals
// at beat 4 (stamped). The row is the record of that one moment,
// end to end.
//
// "The sealed act is the act" — there is no separate Stamp noun.
// Stamp survives only as the machine (the press), the verb (to
// stamp / beat 4 / stamped.js), and the act of sealing. The thing
// on the reel is an Act.
//
// Reply chains form the graph these Acts make. `inReplyTo` points
// at the Act whose moment requested this one — parent in the
// reply tree. `rootCorrelation` propagates through a whole chain
// (Ruler → Planner → Contractor → Worker) so I can walk it for
// cancellation and group it for conversation views. A thread
// between two beings at one position is the set of Acts sharing
// one `ibpAddress`, the canonical sorted stance pair.
//
// I do not store tool calls or substrate writes inside this row.
// Whatever the being did during the moment — every DO, every BE
// — deposits a Fact carrying this Act's id. "What happened inside
// this moment?" is Fact.find({ actId }).
//
// CONTENT-ADDRESSED. An Act's `_id` IS the hash of its OPENING:
//
//   _id = SHA-256(p | canonical(opening))     (past/act/actHash.js)
//
// chained per (branch, being) — `p` is the being's previous sealed
// act's identity (ActHead). The identity is minted at assign so the
// moment's Facts can carry actId; the closure fields below (status,
// endMessage, innerFace, answers) are bookkeeping OUTSIDE the
// digest — they mutate by design, and the truth of what happened is
// the hash-chained Facts. Wall-clock fields (receivedAt, stampedAt)
// are human-time display helpers, never identity (see hash.js).

import mongoose from "mongoose";

const ActSchema = new mongoose.Schema({
  // The act's content hash — supplied by planActRow / crossWorld,
  // never defaulted. 64 hex chars.
  _id: { type: String },

  // The act-chain link: the being's previous sealed act's identity
  // on this branch (GENESIS_PREV for the first).
  p: { type: String, default: null },

  // The ACTOR — the Name (identity) that authored this act and whose key
  // signs it. The acting being expresses this trueName; the name's key
  // (i-am → the reality key, else the Name's privateKeyEnc) produces
  // act.sig. The act-chain itself stays keyed per (branch, beingIn): a
  // name owns many beings' PARALLEL chains (name → branch → being → acts),
  // so the name is the owner + signer, NOT the chain key. NOT part of
  // contentOfAct (the digest), so it never changes act._id. `beingIn`
  // below is the being the name acted THROUGH. See materials/name/name.js.
  nameId: { type: String, ref: "Name", default: null, index: true },

  beingIn:  { type: String, ref: "Being", required: true, index: true },
  beingOut: { type: String, ref: "Being", default: null, index: true },

  ibpAddress: { type: String, default: null, index: true },
  activeRole: { type: String, default: null, index: true },

  inboxMessageId: { type: String, default: null, index: true },

  inReplyTo:       { type: String, default: null, index: true },
  rootCorrelation: { type: String, default: null, index: true },

  // Back-reference to the summon fact's correlation that this
  // moment answered. SUMMON stamps a `summon` Fact on the
  // RECIPIENT's reel (right stance, like DO; doer = summoner —
  // 2026-06-03 retarget), and the cross-cutting fold maintains
  // InboxProjection from those facts. The scheduler picks an open InboxProjection row, hands
  // the correlation to the moment via this `answers` field, and
  // the seal commits the Act with it set. On seal, the cross-
  // cutting fold sees Act-with-answers and evicts the matching
  // InboxProjection row — that is the closure event. Not a reply-
  // message; just the moment that took the summon, sealing. A being
  // who summons B to "clean room 3" gets closure when B's moment
  // seals, regardless of whether B sends any reply text.
  // (Bucket 3 Option D, 2026-05-23.)
  answers: { type: String, default: null, index: true },

  // When a being acting under thread A emits a fresh top-level SUMMON
  // (one with no `inReplyTo`), the new SUMMON starts thread B. This
  // field records that B was spawned from A. The seed stamps it at
  // emit time from the asker's current rootCorrelation (scheduler
  // knows it via getCurrentRootCorrelation). Walks: B → A → ... give
  // the cross-thread lineage SEE on `./threads/<id>` surfaces as
  // `parentThread`. The ancestor-severance check on intake pickup
  // walks this same chain to decide whether a spawned thread should
  // still run when its parent's been cut.
  parentThread: { type: String, default: null, index: true },

  receivedAt: { type: Date, default: null },
  stampedAt:  { type: Date, default: null },

  startMessage: {
    // Mixed because SUMMON content is whatever the receiving role
    // expects. Humans send text strings. Scripted beings receive
    // structured payloads (e.g. drummer tick: `{ event, drumMatterId,
    // gridSpaceId }`). The Act records what was said in whichever
    // shape the protocol carried.
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    source:  { type: String, default: "user" },
    _id: false,
  },

  endMessage: {
    content: { type: String, default: null },
    stopped: { type: Boolean, default: false },
    time:    { type: Date, default: null },
    _id: false,
  },

  // Set by the cut handler when a thread (this Act's rootCorrelation)
  // is severed via SUMMON to ./threads/<id>. Distinct from
  // endMessage.stopped (which means the role halted its loop):
  // severedAt records that the line was cut from outside. The
  // scheduler skips intake entries whose rootCorrelation appears
  // severed and the run loop drops out.
  severedAt: { type: Date, default: null, index: true },

  // Queue ordering hint. The scheduler picks by priority (HUMAN
  // first, then GATEWAY, INTERACTIVE, BACKGROUND). The cut handler
  // also reads it: HUMAN-priority cuts go out-of-band and fire
  // AbortSignal; lower priorities queue.
  priority: {
    type: String,
    enum: ["HUMAN", "GATEWAY", "INTERACTIVE", "BACKGROUND"],
    default: "INTERACTIVE",
  },

  // The canonical inner face the act was committed under: orientation,
  // role, position (id/name), capabilities, the role.canSee-resolved
  // blocks, and weave (the reels the fold actually read). Captured
  // uniformly across LLM, scripted, and human-inhabited cognitions so
  // the act-chain never carries half-records. Origin is "local" for
  // fold-built faces; cross-world overrides supersede the local face
  // post-seal with origin: "foreign". Read by turned folds
  // (half/inward), the portal act-chain display, and any consumer of
  // the moment's perception record. Stored at defensive caps (10KB
  // per field, 1000-entry lists); render-time clamps (1000 chars, 64
  // entries) are applied separately by prompt builders. The chain is
  // the truth; this is a bounded record of the face; full face
  // reconstruction goes through the chain, not here.
  //
  // Shape:
  //   { orientation, role, position, capabilities, blocks, weave, origin }
  //
  // weave: [{reelKind, reelId, branch}] . the reels the fold actually
  // read (residue of canSee + foldPlace gating), captured at fold
  // build time and immutable at seal. Subscription dispatch, audit,
  // and replay all key off this same object. See
  // present/beats/2-fold/weave.js for the canonical shape and
  // helpers. Mixed type already accepts the new field on new acts; no
  // schema migration.
  innerFace: { type: mongoose.Schema.Types.Mixed, default: null },

  // Reality the actor was acting from when this Act was stamped.
  // For local Acts on this substrate, this is the substrate's own
  // domain (process.env.REALITY_DOMAIN). For cross-reality Acts, this
  // is the foreign actor's home reality. Required — every Act knows
  // its actor's home reality, no silent assumption that "this is the
  // only reality." See seed/CROSS-WORLD.md.
  reality: { type: String, required: true, index: true },

  // Branch the actor was acting from when this Act was stamped.
  // Required — no schema default, no silent main-bias. Every Act
  // emitter (planActRow, withIAmAct, withBeingAct, test fixtures)
  // must thread the branch explicitly. See seed/CROSS-WORLD.md for
  // why act-chain lineage matters.
  branch: { type: String, required: true, index: true },

  // Cross-world act lifecycle status. Starts at "attempted" when the
  // Act seals locally on the actor's home reel; transitions exactly
  // ONCE to a terminal state as feedback arrives from the target's
  // world. Same-world acts (target.world === actor.world) transition
  // to "landed" inline at seal time since the foreign side IS the
  // local Stamper. Cross-world acts wait for the foreign Stamper
  // (cross-branch: in-process; cross-reality: over canopy) and
  // update later.
  //
  // Terminal states:
  //   landed       — foreign side confirmed the fact stamped
  //   denied       — foreign side refused (auth / permissions / policy)
  //   timeout      — no response within the configured window
  //   unreachable  — canopy could not deliver (DNS / network down)
  //   malformed    — foreign side received but couldn't parse
  //
  // This is the SINGLE exception to fact immutability — see
  // seed/CROSS-WORLD.md "Status is the one exception to fact
  // immutability." The Act itself is sealed and immutable; the status
  // field is a derived correlation of "what happened to this attempt"
  // that the substrate updates exactly once after seal. No other
  // field on an Act ever mutates after seal.
  status: {
    type: String,
    required: true,
    enum: ["attempted", "landed", "denied", "timeout", "unreachable", "malformed"],
    index: true,
  },

  // The actor's signature over this act and exactly its facts (actSig.js
  // buildActSigPayload: actId, opening fields, p, sorted factIds, time).
  // A CLOSURE field — NOT part of contentOfAct, so it does not change
  // act._id and replay/dedup is unaffected. Custodially produced at seal
  // by the reality holding the being's key. `by` is the signer id (a
  // being key id, or "i-am" for the reality key); null on the row when
  // the actor has no local key (a foreign cross-reality actor). The
  // value is a public signature, safe on the chain.
  sig: {
    alg:   { type: String, default: null },   // "ed25519"
    by:    { type: String, default: null },   // signer id (key id or "i-am")
    value: { type: String, default: null },   // base64 signature
    _id: false,
  },
});

// All Acts under one chain (rootCorrelation walk).
ActSchema.index({ rootCorrelation: 1, stampedAt: 1 }, { sparse: true });
// Per-Being newest-first activity, scoped by branch.
ActSchema.index({ beingIn: 1, branch: 1, stampedAt: -1 });
// Per-Name activity — the "name → branch → acts" folder view; a name's
// whole biography across every being it acts through.
ActSchema.index({ nameId: 1, branch: 1, stampedAt: -1 }, { sparse: true });
ActSchema.index({ beingOut: 1, branch: 1, stampedAt: -1 });
// Conversation between two Beings.
ActSchema.index({ beingIn: 1, beingOut: 1, stampedAt: -1 }, { sparse: true });
// "Every time beingOut acted in activeRole" — audit query.
ActSchema.index({ beingOut: 1, activeRole: 1, stampedAt: -1 }, { sparse: true });
// All Acts at one IBPA (the thread).
ActSchema.index({ ibpAddress: 1, stampedAt: -1 }, { sparse: true });
// Retention sweep cursor.
ActSchema.index({ stampedAt: 1 });

const Act = mongoose.model("Act", ActSchema, "acts");
export default Act;
