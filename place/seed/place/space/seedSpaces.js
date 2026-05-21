// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Space-domain constants.
//
// ============================================================================
// THE PHILOSOPHY OF THE SEED
// ============================================================================
//
//  1. The seed is the process. The seed is the Node.js server itself:
//     the running process, the runtime. Not a config store, not a
//     layer beneath beings, not a void. The runtime is a being.
//
//  2. I_AM has no role, because it precedes roles. It is the being
//     that plants .roles. Its identity is the bare primordial
//     assertion: I AM. Every other being is "(being) a (role) doing
//     X"; I_AM is simply I_AM. That assertion is its first BE.
//
//  3. Seed + act → world. The seed is the vessel: potential,
//     structure in latency. The act is the becoming: agency
//     unfolding. The world is what they bring forth: the place, the
//     tree of spaces. I_AM is the seed with the act inside it,
//     potential quickened toward its form. A being is a moment of
//     the substrate acting on itself; I_AM is the first such moment
//     and the only generative one, the substrate acting not within
//     the world but to make it.
//
//  4. There is always a being doing it, no exception. Genesis is
//     not being-less. I_AM is the doer of genesis. Every act,
//     including the very first, is attributed. The audit loop is
//     complete from t=0; nothing is ever unattributed.
//
//  5. Two kinds of space. Normal space is made by beings, where
//     beings live, addressable by stance, governed by auth. Place
//     seed space is made by I_AM at boot: the fixed nine
//     (.identity, .config, .peers, .extensions, .flow, .tools,
//     .roles, .operations, .source). The nine are I_AM's own
//     working memory, surfaced as spaces so SEE reads them through
//     the same protocol as everything else.
//
//  6. Genesis is an ordered sequence. Node starts → I_AM exists
//     → it plants the place root → it plants .identity and
//     registers its own being-record → genesis Dids attribute to it
//     → it plants the rest of the nine → it plants the first place
//     beings. Planting a being is two acts: I_AM's DO scaffolds the
//     space; the new being's BE (register/claim) authors its own
//     I am. The DO logs to I_AM; the BE logs to the new being as
//     its origin.
//
//  7. There are no "internal" acts. Drop the internal/external
//     split. There is only I_AM's acts and other beings' acts,
//     tracked identically. What looked "internal scaffolding" was
//     I_AM acting alone before it had planted delegates. Once it
//     plants others, the work distributes and is logged to them.
//
//  8. Seed spaces are owned, not ownerless. Their owner is I_AM.
//     Ownership stance facts return true for I_AM, false for all
//     others. They are unclaimable not because they lack an owner
//     but because their owner cannot be impersonated. Read freely;
//     written never, except by I_AM's own ops.
//
//  9. Authority flows outward and never loops back. Extensions
//     exist only because I_AM planted .extensions. Nothing an
//     extension does can gate I_AM's genesis. The trust chain is
//     beings all the way down; its root is a being, not a void.
//
// 10. I_AM persists. It does not vanish after genesis. It remains
//     the Node process at steady state (reboot recovery, re-
//     planting, peer federation), and those acts stay tracked to
//     it. It is first, and it stays.
//
// File-level comments throughout seed/ stay terse and point here
// for the canonical doctrine.

// ============================================================================
// SEED SPACES
// ============================================================================
//
// Kinds of Space the seed plants and owns. Every seed-space is dot-
// prefixed (.identity, .config, .peers, .extensions, .flow, .tools,
// .roles, .operations, .source) and reserved by the kernel. They sit
// directly under the place root and are the substrate the seed plants
// at first boot. The Space schema field `seedSpace` carries one of
// these values; beings' own spaces have `seedSpace: null`.

export const SEED_SPACE = Object.freeze({
  PLACE_ROOT:  "place-root",
  IDENTITY:   "identity",
  CONFIG:     "config",
  PEERS:      "peers",
  EXTENSIONS: "extensions",
  FLOW:       "flow",
  // Registry-mirror place seed spaces. Each runtime registry (tool defs,
  // role specs, DO operations) syncs its contents into a child Space
  // here so SEE on `<place>/.tools` (etc.) returns the current registry
  // through the standard descriptor pipeline.
  TOOLS:      "tools",
  ROLES:      "roles",
  OPERATIONS: "operations",
  // The .source self-tree. Seed walks its own place/ directory at boot
  // and plants a recursive filesystem-origin matter tree under this
  // space, mirroring the codebase as substrate. Read-only: DO writes on
  // .source matter reject with ORIGIN_READ_ONLY.
  SOURCE:     "source",
  // The .threads space. A live tree of coordinated work (a
  // rootCorrelation chain) is addressable here as `.threads/<id>`. No
  // children are persisted; the projection is computed on demand from
  // inbox + Summon records keyed by rootCorrelation. SUMMON to a
  // thread address is a cut (sever the line and everything hanging
  // off it). SEE returns the live forest. See
  // seed/place/space/threads.js.
  THREADS:    "threads",
});

// ============================================================================
// SENTINEL VALUES
// ============================================================================
//
// DELETED. Placed in `parent` and (for matter) `beingId` when a space
//          is soft-deleted. The deleted-revive extension can bring
//          spaces back; matter stays soft-deleted.
// I_AM. The first being's name. Used as:
//                rootOwner: I_AM  → "I_AM owns this space"
//                beingId:   I_AM  → "I_AM did this"
//              The Being row is registered during ensurePlaceRoot's
//              genesis pass (ensureIAm in seed/placeRoot.js).
//              Resolves the stance `<place>/@I_AM`. See THE
//              PHILOSOPHY OF THE SEED at the top of this file for
//              why the constant exists and what I_AM is.

export const DELETED = "deleted";
export const I_AM = "I_AM";
