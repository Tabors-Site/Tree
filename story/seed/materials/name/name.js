// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Name. The identity I sign with.
//
// A Name is the cryptographic identity that the substrate's signatures
// bind to. It holds the keypair, signs every act, owns the act-chain,
// and descends from the story's I_AM through lineage. What used to be
// "the being's keypair / the being's chain" is the NAME's keypair and
// the NAME's chain: the identity layer, lifted up off the Being.
//
// A Name is NOT in the world. The world contains Beings (presence); a
// Name acts THROUGH beings (beings). One Name owns many Beings. The
// Being is the formed body; the Name is who signed it into being.
// `Being.name` is a display label, never the identity; the identity is
// this row's `_id` (the ed25519 public key, did:key "z..." form).
//
// Names are flat facets of I_AM: every Name's `parentNameId` resolves
// toward the story's I_AM one layer down. There is no Name hierarchy
// (that hierarchy lives in the being tree, as containment, not as
// sovereignty). I_AM is itself a Name, with `_id = "i-am"` and its key
// the story key (storyIdentity.js) — a Name whose biography is the
// story's own chain.
//
// The name reel is the MOST PRIMITIVE reel: the identity layer beneath
// space, matter, and being. A Name's reel carries only identity-layer
// facts (declare, close, soul transition); everything else in the
// world is folded from facts that a Name signed. Nothing is more
// foundational than the thread of who acted.
//
// IDENTITY IS ABOVE THE HISTORY TIMELINE. A key is the same key on every
// history. Branching forks the WORLD (the timeline of world facts); an
// identity is not a world-event, so a Name is NOT history-seated. Two
// things must not be conflated:
//   - The name REEL (this Name's identity facts: the NAME-verb acts
//     declare / heir / federate / close) is OUTSIDE the world, so it does
//     NOT fork. A Name is declared once, story-wide; the reel lives on
//     the root timeline and every history inherits it unchanged. There is
//     nothing world-shaped on it to fork.
//   - The Name's WORLD act-chain (the SEE/DO/SUMMON/BE moments it opens
//     acting THROUGH beings) DOES fork per history — it lands on whatever
//     history's world it acted in, keyed <history>:<nameId>. The BEINGS it
//     acts through fork too.
// Identity above (no fork); world activity and presence below, in the
// histories. So this row carries no history-seating field and no rich
// per-history state — those are the Being's.
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
  // signing key is the story key (special-cased in actSig.js).
  _id: { type: String, required: true },

  // Lineage. The Name this Name descends from, recorded in the
  // name:declare fact. Flat: every Name is a facet of I_AM one layer
  // down, so parentNameId resolves toward I_AM. Null only for the I_AM
  // Name itself (the root of the story's identity layer).
  parentNameId: { type: String, ref: "Name", default: null },

  // The REAL NAME — the human-readable label for this Name (trueName.name),
  // OPTIONAL. A trueName has THREE parts: `.pub` = `_id` (the public key),
  // `.priv` = `privateKeyEnc` (the private key), `.name` = this label. It is
  // the easier-server-access handle: people sign in with real-name + password
  // instead of handling the raw private key, but it is ALWAYS optional — you
  // can act with the private key directly. Story-scoped (resolved via
  // findByName("name", <realName>, "0")); distinct from being.name (a being's
  // world label). Folded from the name:declare spec.
  name: { type: String, default: null },

  // The encrypted private key (PKCS8 PEM, AES-256-GCM via
  // credentials.encryptCredential). Custodial: the home story holds
  // it so the Name can sign while unlocked. Folded from the name:mint
  // fact's params. `select: false` so it never rides a default query.
  // Null for the I_AM Name (its key is the story key, on disk).
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

  // SESSION LIFECYCLE — folded from the name:connect / name:release facts on
  // this reel (the identity-layer be:connect / be:release). The reel IS the
  // truth of whether the Name is connected (a live session holds its key);
  // the op handlers gate the transitions off this (can't connect twice, can't
  // release when not connected). `connected` defaults false (a fresh Name has
  // never connected). No timestamp field — WHEN it connected/released is the
  // fact's own position on the reel (the fact-reel is the time).
  connected: { type: Boolean, default: false },

  // No `homeHistory`, `isRemote`, or `homeStory`. A Name's identity is
  // above the history timeline (no history seating) and its row only ever
  // exists on its home story (the story is implicit — a story's
  // data is that story's). A Name acting on a foreign story is
  // recorded there as the actor id on the FACTS it lays through a being,
  // with `crossOrigin` pointing home — never as a mirrored Name row.

  // Open characterizing layer, story-wide and LEAN. A Name is identity,
  // not presence: its keypair, lineage, and soul are fields above; the
  // rich stateful layer (position, matter, roles, the being's open
  // qualities) belongs to the BEING. This holds only name-level metadata
  // an extension might attach (a display profile, peering prefs). Default
  // empty Map.
  qualities: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map(),
  },

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
