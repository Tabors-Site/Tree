// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Being — the unified identity type. Every entity that holds identity,
// registers in a Land, and acts is a Being. The protocol treats them
// uniformly across authorization, addressing, federation, and SEE
// descriptors; only the operatingMode varies. See seed/philosophy/ for
// the framing of beings as substrate acting on itself.
//
// Cognition modes (operatingMode):
//   human    — a real person, authenticated by credentials.
//   llm      — driven by an LLM each time they're summoned.
//   scripted — driven by deterministic code, no LLM in the loop
//              (auth-being, llm-assigner).
//   mixed    — composite cognition. Reserved; not used yet.
//
// Every Being has a homeSpace. The `<land>/~<name>` address shorthand
// resolves through homeSpace to a real Space; the protocol operates
// on that Space like any other position. There are no zone exceptions.
//
// Usernames are unique per land. LLM-driven creation generates them
// programmatically (e.g. "ruler435", "planner872"); human registration
// validates uniqueness and surfaces a hint to the registrant on collision.

import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

const BeingSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },

  // Addressable identifier on this land. Drives the @qualifier in
  // stance addresses (treeos.ai/<path>@<name>). Federation crosses
  // lands using <name>@<landDomain> on top of this. Matches Space.name
  // and Matter.name — every primitive uses `name`.
  name: { type: String, required: true, unique: true },

  // How this Being is operated. Affects scheduling and the dispatch
  // path inside the scheduler; addressing and stance authorization
  // treat all modes uniformly.
  //   human    — credentials + input devices.
  //   llm      — scheduler picks an inbox entry, invokes the role's
  //              summon function, one runChat call produces a reply.
  //   scripted — same scheduler path; the role's summon function
  //              returns a programmatic answer without an LLM.
  //   mixed    — composite cognition (future).
  operatingMode: {
    type: String,
    enum: ["human", "llm", "scripted", "mixed"],
    required: true,
    default: "human",
  },

  // Every Being has a password (hashed). Humans choose it at
  // registration; non-human beings auto-generate at creation and
  // discard the plaintext. Storing a password for non-human beings
  // preserves a future "human inhabits a non-human being" flow: reset
  // the password through admin tooling and sign in as that Being.
  // Hard by default; possible when the operator wants to.
  password: { type: String, select: false, required: true },

  // Admin-ness is a role, not a flag. Permission checks consult
  // role membership; the boolean shape retired 2026-05-18 because two
  // sources of truth (flag + role set) had to disagree somewhere.

  // ── Roles ──
  // A Being carries one or more role names referencing templates in
  // seed/cognition/roles/registry.js. Identity is durable on this record;
  // role composes per summon. A Being acting in multiple roles is one
  // Being using different capacities, not many Beings.
  //
  // Each SUMMON resolves an active role: the envelope's `activeRole`
  // if present and a member of `roles`, else `defaultRole`. The Summon
  // record stamps the resolved role so audit captures
  // (beingOut, activeRole) per summon.
  roles:       { type: [String], default: [] },
  defaultRole: { type: String, default: null },

  // ── Being tree ──
  // Beings form a recursive tree parallel to the Space tree. Every
  // land has exactly one root: the I_AM, created by
  // ensureLandRoot() at boot, identified by parentBeingId: null.
  //
  // Every other Being chains back to it:
  //   - System beings (auth, llm-assigner, land-manager) are children
  //     of the I_AM.
  //   - The first human registers under the I_AM and becomes
  //     the root operator. Subsequent humans register under the
  //     auth-being.
  //   - When any being promotes a Space to Ruler, the new Ruler is a
  //     child of the invoking being. The Ruler then spawns
  //     Planner / Contractor / Foreman as its own children.
  //
  // null parent is reserved for the I_AM. All create-being /
  // create-child calls require a parent.
  //
  // Being-tree parent/child is independent of homeSpace: multiple
  // beings can share the same homeSpace (Ruler + Planner + Contractor
  // + Foreman all live at the rulership Space) while parenting through
  // the being tree captures the cognitive hierarchy.
  parentBeingId: { type: String, ref: "Being", default: null, index: true },
  children:      [{ type: String, ref: "Being" }],

  // homeSpace — the Space this Being treats as home. Humans get a home
  // territory at registration; non-human beings are placed by the
  // extension that creates them (governing places Planners at the plan
  // space, Rulers at the rulership Space). Durable across summons; the
  // current-position field tracks navigation separately. Home grants,
  // transfers, and leases are a future direction not built yet.
  homeSpace: { type: String, ref: "Space", default: null, index: true },

  // currentSpace — where the Being is right now, distinct from home.
  // Single-context: a Being is at exactly one position at any moment,
  // shared across all their connected sessions. Humans update via
  // navigation; non-human beings usually equal homeSpace but can shift
  // during work that takes them to a child Space.
  //
  // Used by the chat layer to compute the asker's stance for new
  // summons: the canonical IBP Address `<land>/<currentSpace>@<name>`.
  // Position-fork: when this changes, the Being's next summon lands at
  // a new IBP Address. Earlier summons persist under their original
  // address; no thread "ends," it just stops accumulating.
  currentSpace: { type: String, ref: "Space", default: null, index: true },

  // ── LLM default ──
  // For llm-mode Beings: the LLM that drives their cognition each
  // summoning. For human-mode Beings: the LLM used when they request
  // AI assistance. Null falls back through extension slots → tree →
  // land defaults via the resolution chain. Same field name and
  // semantics as Space.llmDefault so the resolver treats them uniformly.
  llmDefault: { type: String, ref: "LlmConnection", default: null },

  // ── Federation ──
  // isRemote = true when this Being is mirrored from another land.
  // homeLand carries the canonical land's domain in that case.
  isRemote: { type: Boolean, default: false },
  homeLand: { type: String, default: null },

  // ── Qualities ──
  // What kind a being is. Plato's ποιότης / qualitas: the answer to
  // "of what sort is this?" Each extension writes to its own quality
  // namespace via `qualities.being.setQuality(being, "<extName>", ...)`
  // from seed/land/qualities.js. Same Map-of-Mixed pattern Space and
  // Matter use.
  qualities: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
}, {
  timestamps: true,
});

BeingSchema.index({ homeSpace: 1, operatingMode: 1 });
BeingSchema.index({ parentBeingId: 1, _id: 1 });
BeingSchema.index({ roles: 1 });
BeingSchema.index({ defaultRole: 1 });
BeingSchema.index({ homeLand: 1, isRemote: 1 });

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

// Extension data lives in `qualities`. Callers use
// `qualities.being.setQuality` (etc.) from seed/land/qualities.js.

const Being = mongoose.model("Being", BeingSchema, "beings");
export default Being;
