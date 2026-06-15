// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Name. The identity I sign with.
//
// A Name is the cryptographic identity that the substrate's signatures
// bind to. It holds the keypair, signs every act, owns the act-chain,
// and descends from the reality's I_AM through lineage. What used to be
// "the being's keypair / the being's chain" is the NAME's keypair and
// the NAME's chain: the identity layer, lifted up off the Being.
//
// A Name is NOT in the world. The world contains Beings (presence); a
// Name acts THROUGH beings (vessels). One Name owns many Beings. The
// Being is the formed body; the Name is who signed it into being.
// `Being.name` is a display label, never the identity; the identity is
// this row's `_id` (the ed25519 public key, did:key "z..." form).
//
// Names are flat facets of I_AM: every Name's `parentNameId` resolves
// toward the reality's I_AM one layer down. There is no Name hierarchy
// (that hierarchy lives in the being tree, as containment, not as
// sovereignty). I_AM is itself a Name, with `_id = "i-am"` and its key
// the reality key (realityIdentity.js) — a Name whose biography is the
// reality's own chain.
//
// The name reel is the MOST PRIMITIVE reel: the identity layer beneath
// space, matter, and being. A Name's reel carries only identity-layer
// facts (declare, close, soul transition); everything else in the
// world is folded from facts that a Name signed. Nothing is more
// foundational than the thread of who acted.
//
// IDENTITY IS ABOVE THE BRANCH TIMELINE. A key is the same key on every
// branch. Branching forks the WORLD (the timeline of world facts); an
// identity is not a world-event, so a Name is NOT branch-seated. Two
// things must not be conflated:
//   - The name REEL (this Name's identity facts: the NAME-verb acts
//     declare / heir / federate / close) is OUTSIDE the world, so it does
//     NOT fork. A Name is declared once, reality-wide; the reel lives on
//     the root timeline and every branch inherits it unchanged. There is
//     nothing world-shaped on it to fork.
//   - The Name's WORLD act-chain (the SEE/DO/SUMMON/BE moments it opens
//     acting THROUGH beings) DOES fork per branch — it lands on whatever
//     branch's world it acted in, keyed <branch>:<nameId>. The BEINGS it
//     acts through fork too.
// Identity above (no fork); world activity and presence below, in the
// branches. So this row carries no branch-seating field and no rich
// per-branch state — those are the Being's.
//
// THREE SLOTS, no fourth (same doctrine as Being).
//   1. IDENTITY — `_id`. The ed25519 public key. Minted once at
//      declare-name, never folded, never rebuilt. Authoritative.
//   2. FIGURE — everything else folded from the Name's reel/chain
//      (privateKeyEnc, parentNameId, soulType, federation markers).
//      The reducer produces these; rebuild reproduces them.
//   3. CACHE-CONTROL — `foldedSeq`. The projection watermark.
//
// The private key is custodied here (encrypted, never in a fact or a
// descriptor — redact.js carries the `qualities.auth` / `privateKeyEnc`
// carve-outs). It moved UP from `Being.qualities.auth.privateKeyEnc`:
// keys belong to identities, and the identity is the Name.

import mongoose from "mongoose";

const NameSchema = new mongoose.Schema({
  // A Name's id IS its ed25519 public key (the did:key "z..." form;
  // beingKeys.js encodeKeyId), minted at declare-name and supplied
  // explicitly by every creation path. NO uuid default: an id-less
  // insert must fail loudly rather than fabricate a non-pubkey identity
  // that can never sign or be self-certifyingly verified. The one
  // exception is the I_AM Name, whose id is the literal "i-am" and whose
  // signing key is the reality key (special-cased in actSig.js).
  _id: { type: String, required: true },

  // Lineage. The Name this Name descends from, recorded in the
  // name:declare fact. Flat: every Name is a facet of I_AM one layer
  // down, so parentNameId resolves toward I_AM. Null only for the I_AM
  // Name itself (the root of the reality's identity layer).
  parentNameId: { type: String, ref: "Name", default: null },

  // The encrypted private key (PKCS8 PEM, AES-256-GCM via
  // credentials.encryptCredential). Custodial: the home reality holds
  // it so the Name can sign while unlocked. Folded from the name:mint
  // fact's params. `select: false` so it never rides a default query.
  // Null for the I_AM Name (its key is the reality key, on disk).
  privateKeyEnc: { type: String, select: false, default: null },

  // The key-scheme descriptor (alg/encoding/version), so a foreign
  // reader knows how to decode the id. Same shape birth.js stamped on
  // the being's params.identity before the split.
  identity: { type: mongoose.Schema.Types.Mixed, default: null },

  // The Soul (cognition type) this Name defaults to: "human" | "llm" |
  // "scripted" | future. A routing label the stamper uses to decide HOW
  // a decision is made; orthogonal to authority. Recorded here for the
  // Soul layer to read; the Soul implementation is a separate effort.
  soulType: { type: String, default: null },

  // No `homeBranch`, `isRemote`, or `homeReality`. A Name's identity is
  // above the branch timeline (no branch seating) and its row only ever
  // exists on its home reality (the reality is implicit — a reality's
  // data is that reality's). A Name acting on a foreign reality is
  // recorded there as the actor id on the FACTS it lays through a vessel,
  // with `crossOrigin` pointing home — never as a mirrored Name row.

  // Open characterizing layer, reality-wide and LEAN. A Name is identity,
  // not presence: its keypair, lineage, and soul are fields above; the
  // rich stateful layer (position, matter, roles, the being's open
  // qualities) belongs to the BEING. This holds only name-level metadata
  // an extension might attach (a display profile, peering prefs). Default
  // empty Map.
  qualities: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },

  // Projection cache markers (same as Being). `foldedSeq` is the highest
  // fact-seq the fold has applied here. Reducer-owned timestamps so the
  // row is deterministic from the chain alone.
  foldedSeq: { type: Number, default: null },
  createdAt: { type: Date, default: null },
  updatedAt: { type: Date, default: null },
});

NameSchema.index({ parentNameId: 1, _id: 1 });

const Name = mongoose.model("Name", NameSchema, "names");
export default Name;
