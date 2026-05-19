// TreeOS Seed — Being model. AGPL-3.0 — https://treeos.ai
//
// A being is the unified identity type in TreeOS. Replaces the older
// User model. Every entity that holds identity, registers in a land,
// and acts in the system is a being:
//
//   - Humans operate beings through credentials + input devices.
//     operatingMode = "human". Home is the territory Node granted to
//     them at registration (treeos.ai/~tabor is shorthand for the Node
//     they own as their home).
//   - AI agents are beings operated by an LLM through chainsteps.
//     operatingMode = "ai". Home is the Node where they were placed by
//     the extension that created them (plan trio, contracts trio, etc.).
//
// All beings have a home Node. There are no zone exceptions. The "/~"
// notation in the address grammar is shorthand for "the home territory
// of the being with this username on this land" — it resolves through
// `homePositionId` to a real Node id, then the protocol operates on
// the Node like any other position.
//
// The protocol treats all beings uniformly. Authorization, addressing,
// federation, and descriptor surfacing operate on one identity type.
//
// Usernames are unique per land. AI being creation generates them
// programmatically (e.g. "ruler435", "planner872"); human registration
// validates uniqueness and surfaces a hint to the registrant if taken.

import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

const BeingSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },

  // Addressable identifier inside this land. Drives the @qualifier in
  // stance addresses (e.g. treeos.ai/<path>@<username>). Unique per
  // land at the kernel level. Federation crosses lands using
  // <username>@<landDomain> on top of this.
  username: { type: String, required: true, unique: true },

  // How this being is operated.
  //   "human" — a real person, authenticated by credentials.
  //   "ai"    — driven by an LLM each time they're summoned. The
  //             scheduler picks up an inbox entry, invokes the role's
  //             summon function, the function makes one atomic LLM
  //             call via runChat, and the response emits as a
  //             reply-SUMMON.
  operatingMode: {
    type: String,
    enum: ["human", "ai"],
    required: true,
    default: "human",
  },

  // Every being has a password. For humans it's the credential they
  // choose at registration. For AI beings it's auto-generated at
  // creation (random bytes) and hashed before storage — the plaintext
  // is discarded. Storing a password for AI beings preserves the
  // future option of a human "inhabiting" an AI being: an operator
  // could reset the password and then sign in as that being, seeing
  // through it and acting on its behalf. Hard by default; possible
  // when the operator wants to.
  password: { type: String, select: false, required: true },

  // Admin-ness is a ROLE, not a flag. The first being created at
  // first-run gets `"admin"` in roles[]; permission checks consult
  // role membership (see seed/auth.js helpers). isAdmin: Boolean
  // retired 2026-05-18 — two sources of truth (boolean flag + role
  // set) had to disagree somewhere; collapsed to one.

  // ── Roles ──
  //
  // A being carries one or more roles. Each role names a template in
  // roles/registry.js (ruler, planner, contractor, foreman, worker,
  // auth, intent, food-coach, food-log, ...). Identity is the being;
  // role is what they're acting in at any given summon.
  //
  // - `roles`: the set of roles this being is capable of acting in.
  //   Humans typically carry a small set (creator + whatever they take
  //   on); AI beings often carry one (their installed role) but can
  //   acquire more as the architecture admits composite beings.
  // - `defaultRole`: which role runs when a summon doesn't specify an
  //   `activeRole` on the envelope. Must be in `roles` if non-null.
  //
  // Each SUMMON resolves an active role for the summon: the envelope's
  // `activeRole` if present and present in `roles`, else `defaultRole`.
  // The role template runs accordingly; the Summon record stamps the
  // resolved `activeRole` so audit captures (beingOut, activeRole) per
  // summon.
  //
  // The architecture: identity is durable (this Being record), role is
  // composable per summon. A being acting in multiple roles is one
  // being using different capacities, not many beings.
  roles:       { type: [String], default: [] },
  defaultRole: { type: String, default: null },

  // ── Being tree ──
  // Beings form a tree the same way nodes do. Every land has exactly
  // ONE root being . the human who created the land. The first-run
  // setup prompts the operator to create themselves; that being has
  // parentBeingId null. Every other being chains back to that root:
  //
  //   - auth-being and land-manager are spawned as children of the
  //     root being during boot.
  //   - Humans signing in later through the auth-being are spawned as
  //     children of the auth-being.
  //   - When the operator (or any being) promotes a node to Ruler, the
  //     Ruler being is their child (parentBeingId = invoking being).
  //   - The Ruler then spawns Planner / Contractor / Foreman as its
  //     own children. Walking parentBeingId from any of those reaches
  //     the Ruler, then the operator, then null at the root.
  //
  // Result: every being's lineage chains back to the land's root being.
  // null parent is reserved for the root only. All create-being /
  // create-child calls expect a parent.
  //
  // The being tree captures the cognitive hierarchy at a position.
  // Multiple beings can share the same homePositionId (Ruler + Planner +
  // Contractor + Foreman all live at the rulership node); the being-tree
  // parent/child relationship is independent of where they live.
  //
  // See [[project_substrate_as_universal_workspace]] for the framing.
  parentBeingId: { type: String, ref: "Being", default: null, index: true },
  children:      [{ type: String, ref: "Being" }],

  // homePositionId: the Node where this being lives. Required for every
  // being once created. Humans get a home territory Node granted at
  // registration; AI beings have their home set by the extension that
  // creates them (governing places Planners at the plan trio, Rulers
  // at the ruler scope, etc.). Durable across chainsteps. Movement
  // during work is render-state derived from active chainsteps; the
  // home record stays stable.
  //
  // Future (Pass 5 economy): home territories grow, can be granted,
  // transferred, leased. The infrastructure is here; the economy
  // semantics layer on later.
  homePositionId: { type: String, ref: "Node", default: null, index: true },

  // ── Current position ──
  // The being's current position in the world — where they are right
  // now, distinct from their home (homePositionId). Single-context
  // model: a being is at exactly one position at any moment, shared
  // across all their connected sockets.
  //
  // For human beings this updates as they navigate (`cd`, route
  // changes, etc.). For AI beings this usually equals homePositionId
  // (they live at home and operate from there), but it can shift
  // during chainsteps that take an AI being to a child node.
  //
  // Used by the chat layer to compute the asker's stance for new
  // chats — the canonical IBP Address `<land>/<currentPositionId>@<username>`.
  // Position-fork: when this changes, the being's next chat lands at
  // a new IBP Address. Old chats persist with their original
  // address; no thread "ends," it just stops accumulating.
  currentPositionId: { type: String, ref: "Node", default: null, index: true },

  // ── LLM default (both modes) ──
  // For AI beings: the LLM that drives their cognition each summoning.
  // For human beings: the LLM used when they ask for AI assistance.
  // Null falls back through extension slots → tree → land defaults using
  // the existing resolution chain. Same field name and semantics as
  // Node.llmDefault so the resolver treats them uniformly.
  llmDefault: { type: String, ref: "LlmConnection", default: null },

  // ── Federation ──
  // Unchanged semantics from the prior User model.
  isRemote: { type: Boolean, default: false },
  homeLand: { type: String, default: null },

  // ── Extension data ──
  // Same Map-of-Mixed pattern Node uses. Extensions write to their
  // own namespace via getBeingMeta / setBeingMeta (and the existing
  // setExtMeta / mergeExtMeta primitives once they're updated).
  metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
}, {
  timestamps: true,
});

// Compound index: query "every chat ending with this being" and
// "every being at a given home position" cheaply.
BeingSchema.index({ homePositionId: 1, operatingMode: 1 });
// Being-tree walk: find a parent's children quickly.
BeingSchema.index({ parentBeingId: 1, _id: 1 });
// Role indexes: `roles` is multikey (Mongo indexes each array element)
// so `Being.find({ roles: "ruler" })` covers any being carrying ruler.
// `defaultRole` is single-value, indexed for the common "find beings
// whose default role is X" query (descriptor, dashboard, governing).
BeingSchema.index({ roles: 1 });
BeingSchema.index({ defaultRole: 1 });
BeingSchema.index({ homeLand: 1, isRemote: 1 });

// Hash passwords on save. Both human and AI beings carry a password;
// the hook hashes anything that hasn't been hashed yet. Pre-hashed
// passwords (e.g. migration inserts) still need to bypass via $set
// directly so the hook doesn't double-hash.
BeingSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare a candidate password against the stored hash. Works for any
// being. For AI beings the password is auto-generated at creation and
// the plaintext discarded — comparison still succeeds when an operator
// resets the password through admin tooling.
BeingSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// No virtuals. Extension data lives in metadata.
// Callers use getBeingMeta / setBeingMeta from seed/tree/beingMetadata.js
// or getExtMeta / setExtMeta from seed/tree/extensionMetadata.js.

const Being = mongoose.model("Being", BeingSchema, "beings");
export default Being;
