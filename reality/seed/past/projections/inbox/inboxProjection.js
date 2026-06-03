// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// InboxProjection. The cross-cutting fold of open summons per being.
//
// A SUMMON is the summoner's act and deposits a `be:summon` fact on
// the summoner's reel, with `target = { kind: "being", id: recipient }`.
// Single-writer holds — no one writes another being's reel — so the
// summon-fact never lands on the recipient's reel.
//
// The inbox (per recipient) is therefore a cross-cutting projection,
// the same kind as the position index: it follows summon-edges by
// recipient, reading across reels. This collection is its
// materialization — a row per open summon, indexed by recipient.
//
// Lifecycle:
//   `be:summon` fact appears on any reel → upsert row keyed by
//      correlation, with recipient = target.id, plus the summon's
//      params for the scheduler to read.
//   `be:sever` fact appears on any reel → delete rows whose
//      rootCorrelation matches the fact's params.rootCorrelation. The
//      severer stamps one fact on its own reel (single-writer); the
//      projection drops N rows in one fold cycle.
//   Act seals with non-null `answers` → delete row where
//      _id === answers. The closure event is the answering moment
//      sealing, not a reply-message (a being can answer a summon
//      by doing the asked thing, with no reply text at all).
//
// All three handlers live in the fold engine's cross-cutting dispatch
// (see present/fold/foldEngine.js crossCuttingHandlers). The
// projection is a cache: rebuildable by walking all be:summon facts
// since genesis, applying the same three rules. Self-healing — a
// missed fold means the next round catches up.
//
// Per MOMENT.md, "currently in a moment" is not past; the scheduler's
// in-memory Map tracks running claims. This collection only knows
// "open" (a summon-fact exists with no closure event) — it never
// stores `status: "running"`. A picked summon stays in the projection
// until its moment seals; a crashed moment leaves it open and it gets
// re-picked. Self-healing.
//
// Cross-cutting projection schema. The fold handler in
// inboxProjectionFold.js is the authority for what each row looks
// like; the schema is Mongoose mechanics. Three-slot rule applies
// in adapted form: Identity (`_id` = correlation), Figure (everything
// the handler upserts from be:summon facts), Cache-control (no
// foldedSeq here — cross-cutting projections don't carry one). See
// seed/materials/being/being.js header for the canonical projection
// doctrine. Fields declared below collapse into `strict: false` when
// verb-handler validation lands. Deliberately deferred.

import mongoose from "mongoose";

const InboxProjectionSchema = new mongoose.Schema({
  // Same uuid as the summon-fact's params.correlation — one open
  // summon per row, keyed by correlation. Stable across re-folds.
  _id: { type: String, required: true },

  recipient:       { type: String, ref: "Being", required: true, index: true },
  summoner:        { type: String, ref: "Being", default: null, index: true },

  // Summon envelope captured from be:summon fact params. The
  // scheduler reads these to decide pick order + build the moment.
  sender:          { type: String, default: null },
  content:         { type: mongoose.Schema.Types.Mixed, default: null },
  activeRole:      { type: String, default: null },
  attachments:     { type: [mongoose.Schema.Types.Mixed], default: undefined },

  priority: {
    type: String,
    enum: ["HUMAN", "GATEWAY", "INTERACTIVE", "BACKGROUND"],
    default: "INTERACTIVE",
  },

  // Orientation (INNER-FOLD §1): which way the recipient's moment
  // folds when this summon is picked. External summons carry forward;
  // self-summons may carry half or inward. Read by assign and put on
  // summonCtx so the moment's fold knows where to look.
  orientation: {
    type: String,
    enum: ["forward", "half", "inward"],
    default: "forward",
  },

  // Conversation threading (orthogonal to closure). rootCorrelation
  // gets its sparse index declared below at the sever-sweep target;
  // no duplicate `index: true` here.
  rootCorrelation: { type: String, default: null },
  inReplyTo:       { type: String, default: null, index: true },

  // The space where the summon was addressed (the recipient's stance).
  // The scheduler uses this as the moment's inboxSpaceId.
  inboxSpaceId:    { type: String, default: null, index: true },

  sentAt: { type: Date, required: true },

  // Branch this summon belongs to. Summons can never cross branches
  // (the IBP parse-time bridge gate rejects mixed-branch addresses),
  // so every row is single-branch. The scheduler keys its pick on
  // (recipient, branch) so a being summoned on #1 doesn't see their
  // #2 inbox in their #1 fold. Default "0" so pre-branch rows are
  // legible after migration.
  branch:          { type: String, default: "0", index: true },
});

// The scheduler's pick query — per being + branch, by priority and arrival.
// HUMAN < GATEWAY < INTERACTIVE < BACKGROUND lexically, which matches
// the desired priority order (HUMAN first). Sort by sentAt to break
// ties oldest-first (FIFO within priority class).
InboxProjectionSchema.index({ recipient: 1, branch: 1, priority: 1, sentAt: 1 });

// Sever sweep target.
InboxProjectionSchema.index({ rootCorrelation: 1 }, { sparse: true });

const InboxProjection = mongoose.model(
  "InboxProjection",
  InboxProjectionSchema,
  "inbox_projection",
);

export default InboxProjection;
