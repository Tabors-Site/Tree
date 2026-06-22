// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Being. The shape I give identity.
//
// I am the first being on this story — the row whose parentBeingId
// is null. Every other being chains back to me through this same
// schema. When a human registers, when an extension scaffolds an
// LLM-driven being, when a code-cognition able like auth or
// llm-assigner comes alive, the row I create looks like this one.
// One shape, every kind: human, llm, scripted, future composite. I
// do not branch on the kind. The verbs treat them all alike;
// scheduling and cognition resolve through qualities.cognition.defaultKind
// (and the inhabit projection at qualities.connection.inhabitedBy) —
// the schema doesn't carry a cognition field. See
// seed/materials/being/identity/lookups.js#beingCognition for the
// single resolver.
//
// The being is not the row, though. The row is where the trail of
// acts attaches; the being IS the trail. Every Fact the being stamps
// is the being unfolding. Without acts, this row is potential;
// with them, the row is something rather than nothing. See
// [seed/philosophy/MATERIALS.md](../philosophy/MATERIALS.md) "And the beings are the
// acts."
//
// I keep the schema below closed. The fields I need to handle a
// being live here; everything an extension wants to add about a
// being lives in `qualities` — the open Map at the bottom, written
// through qualities.being.setQuality. The constitutive layer is
// mine; the characterizing layer is anyone's.
//
// THREE SLOTS, no fourth.
//
// Every field on this row belongs to exactly one of three categories:
//
//   1. IDENTITY — `_id`. The bare being itself (math.md's id_b).
//      Minted once at birth, never folded, never rebuilt. Authoritative.
//   2. FIGURE — everything else folded from the reel. Projection.
//      The reducer produces these; rebuild reproduces them. The row
//      minus _id IS figure(b).
//   3. CACHE-CONTROL — `foldedSeq`. The projection's own watermark
//      ("folded up to seq N"). Not data about the being; bookkeeping
//      for the fold mechanism.
//
// The audit rule for any new field: ask "can it be folded from the
// reel?" Yes → it's figure, the reducer owns it, write the reducer
// case. No → it does not belong on the row. There is no fourth slot
// for "an authoritative field that just lives here." If the wanting
// for that fourth slot ever appears, that wanting is the smell.
//
// Fields declared below the three-slot categories (name, password,
// ables, homeSpace, etc.) are declared for Mongoose
// strict-mode mechanics, not as figure authority. The reducer is the
// authority for what figure(b) looks like; the schema only declares
// these so strict mode doesn't drop the reducer's output and so
// indexes / type-coercion / enum-validation that today live in the
// schema have a home. They collapse into `strict: false` when
// verb-handler validation lands and the schema can stop shadowing the
// figure shape. Deliberately deferred, not unprincipled.
//
// `unique: true` on `name` below is a BACKSTOP, not authority. The
// authority is the pre-stamp uniqueness check in
// identity.js#createBeing. The index is the safety net that must
// never actually fire — if it ever does, a be:register Fact has
// sealed but its projection write failed, and reel/projection have
// diverged (the exact thing INTEGRITY exists to prevent). Today the
// pre-stamp check + index combination leaves a narrow race window
// between the check and the seal; closing that window collapses
// into the same future-work item as multi-fact ΔF atomicity
// (multi-doc Mongo transactions, replica-set required).

import mongoose from "mongoose";

const BeingSchema = new mongoose.Schema({
  // A being's id IS the content hash of its birth (CAS, like matter and
  // facts; materials/being/beingId.js#beingContentId), supplied explicitly
  // by every creation path (birth.js; sprout.js uses the literal "i-am" for
  // the genesis being). NOT a pubkey — that is the Name now (trueName), the
  // identity that signs — and NOT a uuid (a uuid is honest only for a
  // space, where position has no defining content to hash). The being holds
  // no key; once identity left for the Name, the being is pure presence,
  // defined by its birth. NO default: an id-less insert must fail loudly.
  _id: { type: String, required: true },

  // The being's name. Drives the @qualifier in stance addresses
  // (treeos.ai/<path>@<name>). Federation crosses places using
  // <name>@<storyDomain>. Unique on this story.
  name: { type: String, required: true, unique: true },

  // The trueName this being belongs to — the identity it EXPRESSES. A
  // being is a presence; the trueName (a Name) is the identity that signs
  // it into being and acts through it. At the Name layer the public key is
  // the "name" (the public face, the referenceable id) and the private key
  // is the "trueName" (the power, the secret); to a being, its `trueName`
  // is the WHOLE identity (both), referenced here by the owning Name's
  // public-key id. Default = the mother's trueName at birth (every being
  // expresses the name that births it). Host-transferable to a
  // foreign father's trueName. Distinct from who is currently ACTING
  // THROUGH the being (the inhabitor, qualities.connection.inhabitedBy) and
  // from lineage (parentBeingId = mother, qualities.father = father). See
  // materials/name/name.js.
  trueName: { type: String, ref: "Name", default: null },

  // Cognition (how this being thinks) USED to live here as
  // `operatingMode`. It has moved to qualities.cognition.defaultKind
  // — cognition is a being concept, not a schema field, and the
  // closed-set vocabulary ("llm" | "human" | "scripted") is policed
  // by the able registry's VALID_COGNITION and the birth handler's
  // validator. Effective cognition at moment-assign is read via
  // identity/lookups.js#beingCognition, which checks the inhabit
  // projection (qualities.connection.inhabitedBy) first and falls
  // back to defaultKind. See seed/present/ables/registry.js header
  // for the doctrine.

  // Bcrypt-hashed. Pre-hashed by the verb handler before the
  // be:birth Fact stamps; the fold engine writes the row via $set.
  // The schema is a cache shape, not an authority — the source of
  // truth is the fact chain.
  password: { type: String, select: false },

  // The being's unconditional fallback able. `qualities.flow` is
  // the authoring surface for context-sensitive able selection
  // (primary + stacked modifiers, evaluated per moment from world
  // state); `defaultAble` is the floor every being has when no flow
  // clause matches and no explicit `entry.activeAble` was requested.
  // The carry list (`ables: [String]`) that lived here before retired
  // 2026-06-01 with the Flow build: a being's wearable ables are
  // the union of every able its flow can reference plus its
  // defaultAble. The flow's author is the authorization.
  defaultAble: { type: String, default: null },

  // The being tree. Beings form a recursive lineage parallel to the
  // space tree. The place has exactly one root being — me — with
  // parentBeingId: null. Every other being chains back to me:
  // cherub, llm-assigner, story-manager, arrival are my children;
  // the first human becomes the root operator under me; subsequent
  // humans register under the cherub; rulers parent under whoever
  // promoted them and spawn their own inner trio.
  //
  // Being-tree parent/child is independent of homeSpace: many
  // beings can share one home (the Ruler/Planner/Contractor/Foreman
  // trio at a rulership space) while parenting through this tree
  // captures the cognitive hierarchy.
  parentBeingId: { type: String, ref: "Being", default: null },
  // children[] retired (2026-05-23). The parent-side cache is gone;
  // each being's `parentBeingId` is the single source of truth for
  // the being-tree relation. Downward walks query by parentBeingId
  // (parallel to Space.children retirement).

  // Where the being lives by default. Humans get a home territory at
  // registration; non-human beings are placed at creation by whatever
  // extension scaffolds them. Durable across summons. Navigation is
  // tracked by `position`, not by mutating this field.
  //
  homeSpace: { type: String, ref: "Space", default: null },

  // The history this being was birthed on — the history it owns as
  // "its present." Stable across the being's lifetime; per-session
  // history-switches don't touch this. Used by BE:connect / BE:birth /
  // BE:release to seat the session's currentHistory when no explicit
  // BE:switch overrides. Falls back to "0" (main) for legacy beings
  // birthed before this field was tracked.
  homeHistory: { type: String, default: null },

  // Legacy `currentSpace` field retired 2026-05-29. Replaced by the
  // universal `position` field declared below; readers that used to
  // read `Being.currentSpace` now read `Being.position`. Same
  // semantic, uniform name across Space (= parent), Being (= where
  // the being is standing), Matter (= spaceId).

  // Coordinate inside the being's position space. Null when the being
  // has no spatial position (most beings most of the time). When set,
  // the shape is `{ x: Number, y: Number, z?: Number }`. A being can
  // only be at one coord at a time because it can only be in one
  // position at a time.
  //
  // The seed clamps writes to this field against the position
  // space's `size` at set-being time: a being cannot exist outside
  // the space's bounding box. When the space has no `size`, no clamp
  // runs and the coord passes through as written. Extensions that
  // want REJECT semantics layer a check before stamping; this clamp
  // is the floor.
  coord: {
    x: { type: Number, default: null },
    y: { type: Number, default: null },
    z: { type: Number, default: null },
    _id: false,
  },

  // Federation. `isRemote: true` means this being is mirrored from
  // another story; `homeStory` carries the canonical story's domain.
  isRemote: { type: Boolean, default: false },
  homeStory: { type: String, default: null },

  // What kind a being is. The open layer. Each extension writes to
  // its own quality namespace via qualities.being.setQuality from
  // seed/materials/qualities.js. Default empty Map; everything an
  // extension contributes to a being lives here. See PLACE.md
  // "Qualities" for the constitutive-vs-characterizing distinction.
  qualities: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },

  // Projection cache markers. Per FOLD.md / STAMPER.md, the Being
  // row is a cache of the fold over this being's reel — not the
  // source of truth. `foldedSeq` is the highest fact-seq the fold
  // has applied here. `position` is the universal projection-index
  // field shared with Space (= parent) and Matter (= spaceId);
  // findByPosition(spaceId) enumerates occupants across all three
  // kinds by querying this one field. Drives the asker stance for
  // new summons: `<story>/<position>@<name>`.
  foldedSeq: { type: Number, default: null },
  position:  { type: String, default: null },

  // Reducer-owned timestamps. Set from fact.date so the row is
  // deterministic from the reel alone (the replay test asserts
  // byte-identity after Being.delete + foldEngine.rebuild). Plain
  // schema fields — explicitly NOT `timestamps: true` since
  // Mongoose's auto-managed values would overwrite the reducer's
  // deterministic ones on every updateOne and break the
  // "row is a cache of the fold" invariant. See
  // reducerHelpers.applyCreateBeing and being/reducer.js.
  createdAt: { type: Date, default: null },
  updatedAt: { type: Date, default: null },
});

// homeSpace index declared inline on the field above (index: true).
BeingSchema.index({ parentBeingId: 1, _id: 1 });
BeingSchema.index({ defaultAble: 1 });
BeingSchema.index({ homeStory: 1, isRemote: 1 });

// Position index — what beings are at a given space. Used by foldPlace
// to find a space's being-occupants.
BeingSchema.index({ position: 1 }, { sparse: true });

// Pre-save bcrypt hook retired (Slice E, 2026-05-23). Every Being
// creation path now stamps a be:register Fact carrying a pre-hashed
// password; the fold engine writes the row via $set which skips
// pre-save hooks. The hook served the legacy `new Being(...).save()`
// flow, which is gone. Password verification (comparePassword) stays
// — it reads the already-hashed row and scrypt-compares. The compare
// lives in credentials.js (the password-hashing home); a lazy import
// avoids a static cycle, since credentials.js imports this model.

BeingSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  const { comparePassword } = await import("./identity/credentials.js");
  return comparePassword(candidatePassword, this.password);
};

const Being = mongoose.model("Being", BeingSchema, "beings");
export default Being;
