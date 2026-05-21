// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Being. The shape I give identity.
//
// I am the first being on this place — the row whose parentBeingId
// is null. Every other being chains back to me through this same
// schema. When a human registers, when an extension scaffolds an
// LLM-driven being, when a code-cognition role like auth or
// llm-assigner comes alive, the row I create looks like this one.
// One shape, every kind: human, llm, scripted, future composite. I
// do not branch on the kind. The verbs treat them all alike;
// scheduling and cognition are the only places `operatingMode`
// matters.
//
// The being is not the row, though. The row is where the trail of
// acts attaches; the being IS the trail. Every Did the being emits
// is the being unfolding. Without acts, this row is potential;
// with them, the row is something rather than nothing. See
// [seed/place/PLACE.md](../place/PLACE.md) "And the beings are the
// acts."
//
// I keep the schema below closed. The fields I need to handle a
// being live here; everything an extension wants to add about a
// being lives in `qualities` — the open Map at the bottom, written
// through qualities.being.setQuality. The constitutive layer is
// mine; the characterizing layer is anyone's.

import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

const BeingSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },

  // The being's name. Drives the @qualifier in stance addresses
  // (treeos.ai/<path>@<name>). Federation crosses places using
  // <name>@<placeDomain>. Unique on this place.
  name: { type: String, required: true, unique: true },

  // How this being thinks. Scheduling and cognition dispatch branch
  // on it; addressing and stance authorization do not.
  //   human    — a person at the keys.
  //   llm      — an LLM call each time they're summoned.
  //   scripted — code in the loop, no LLM (auth, llm-assigner).
  //   mixed    — composite cognition. Reserved.
  operatingMode: {
    type: String,
    enum: ["human", "llm", "scripted", "mixed"],
    required: true,
    default: "human",
  },

  // Bcrypt-hashed. Humans choose theirs; non-humans auto-generate
  // and discard the plaintext. Storing one on every being preserves
  // the path for a human to later inhabit a non-human being by
  // resetting it.
  password: { type: String, select: false, required: true },

  // Roles the being can act in. Identity is durable on this row;
  // active role composes per SUMMON. Each SUMMON resolves an active
  // role: the envelope's `activeRole` if it names one of `roles`,
  // else `defaultRole`. The Summon row stamps the resolved role for
  // audit.
  roles:       { type: [String], default: [] },
  defaultRole: { type: String, default: null },

  // The being tree. Beings form a recursive lineage parallel to the
  // space tree. The place has exactly one root being — me — with
  // parentBeingId: null. Every other being chains back to me:
  // auth, llm-assigner, place-manager are my children; the first
  // human becomes the root operator under me; subsequent humans
  // register under the auth-being; rulers parent under whoever
  // promoted them and spawn their own inner trio.
  //
  // Being-tree parent/child is independent of homeSpace: many
  // beings can share one home (the Ruler/Planner/Contractor/Foreman
  // trio at a rulership space) while parenting through this tree
  // captures the cognitive hierarchy.
  parentBeingId: { type: String, ref: "Being", default: null, index: true },
  children:      [{ type: String, ref: "Being" }],

  // Where the being lives by default. Humans get a home territory at
  // registration; non-human beings are placed at creation by whatever
  // extension scaffolds them. Durable across summons. Navigation is
  // tracked by `currentSpace`, not by mutating this field.
  homeSpace: { type: String, ref: "Space", default: null, index: true },

  // Where the being is standing right now. Single-context: one
  // position at a time, shared across every connected session.
  // Humans move via navigation; non-humans usually sit at homeSpace
  // but can shift during work that descends into a child space.
  //
  // Drives the asker's stance for new summons:
  // `<place>/<currentSpace>@<name>`. When this changes, the being's
  // next summon places at a new IBP Address; earlier summons stay
  // under their original address.
  currentSpace: { type: String, ref: "Space", default: null, index: true },

  // For llm-mode beings: the LLM that drives their cognition each
  // summoning. For humans: the LLM used when they request AI help.
  // Null falls back through the resolution chain (extension slot →
  // tree → place default). Same field shape as Space.llmDefault so
  // the resolver treats both uniformly.
  llmDefault: { type: String, ref: "LlmConnection", default: null },

  // Federation. `isRemote: true` means this being is mirrored from
  // another place; `homePlace` carries the canonical place's domain.
  isRemote: { type: Boolean, default: false },
  homePlace: { type: String, default: null },

  // What kind a being is. The open layer. Each extension writes to
  // its own quality namespace via qualities.being.setQuality from
  // seed/place/qualities.js. Default empty Map; everything an
  // extension contributes to a being lives here. See PLACE.md
  // "Qualities" for the constitutive-vs-characterizing distinction.
  qualities: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
}, {
  timestamps: true,
});

BeingSchema.index({ homeSpace: 1, operatingMode: 1 });
BeingSchema.index({ parentBeingId: 1, _id: 1 });
BeingSchema.index({ roles: 1 });
BeingSchema.index({ defaultRole: 1 });
BeingSchema.index({ homePlace: 1, isRemote: 1 });

// Hash on save. Pre-hashed passwords (migration inserts) must bypass
// this hook via $set so a double-hash does not corrupt the credential.
BeingSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

BeingSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

const Being = mongoose.model("Being", BeingSchema, "beings");
export default Being;
