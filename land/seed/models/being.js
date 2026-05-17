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
  //   "ai"    — driven by an LLM through chainsteps when summoned.
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
  isAdmin:  { type: Boolean, default: false },

  // role: present only for AI beings (operatingMode === "ai"). Names
  // the template in embodiments/registry.js (ruler, planner, contractor,
  // foreman, worker, auth, ...). Behavior comes from the template;
  // identity, history, and current state live here on the being itself.
  role: { type: String, default: null },

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

  // ── LLM slot (both modes) ──
  // For AI beings: the LLM that drives their cognition each summoning.
  // For human beings: the LLM used when they ask for AI assistance.
  // Null falls back through position → tree → land defaults using the
  // existing resolution chain.
  llmSlot: { type: String, ref: "LlmConnection", default: null },

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
BeingSchema.index({ role: 1 });
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
