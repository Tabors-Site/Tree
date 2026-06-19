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
//     that plants ./roles. Its identity is the bare primordial
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
//     heaven space is made by I_AM at boot: the fixed nine
//     (identity, config, peers, extensions, tools, roles, operations,
//     source, threads) living inside heaven ("."). These are I_AM's
//     own working memory, surfaced as spaces so SEE reads them
//     through the same protocol as everything else.
//
//  6. Genesis is an ordered sequence. Server starts → I_AM exists
//     → it plants the place root → it plants ./identity and
//     registers its own being-record → genesis Facts attribute to it
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
//     exist only because I_AM planted ./extensions. Nothing an
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
// Kinds of Space the seed plants and owns. Two tiers.
//
// Tier 1 . the place root itself (SPACE_ROOT). The story's outermost
// space; the place every being and every tree hangs off.
//
// Tier 2 . the heaven space (HEAVEN), named ".", parented directly
// under the place root. This is the I-Am's home . the room where the
// runtime stands and from which it dispatches genesis. All other seed
// spaces hang under HEAVEN, not under SPACE_ROOT, so the place root
// stays clear for beings' own trees while the I-Am's working memory
// gathers into one heaven-room. Beings of the land who lack reigning
// stance see SPACE_ROOT with the user trees on it; the heaven door is
// there but they cannot pass through.
//
// Tier 3 . the inner spaces (identity, config, peers, extensions,
// tools, roles, operations, source, threads, branches, host). These
// are I-Am's working memory, surfaced as spaces so SEE reads them
// through the same protocol as everything else. They are children of
// HEAVEN, addressable as `<story>/./config`, `<story>/./tools`,
// etc. The leading "./" is heaven's door; the inner names carry no
// reserved sigil because heaven is the namespace. One tier-3 space
// (host) carries its own children (http, websocket, mongo).
//
// The Space schema field `heavenSpace` carries one of these values;
// beings' own spaces have `heavenSpace: null`.

export const HEAVEN_SPACE = Object.freeze({
  SPACE_ROOT: "space-root",
  // The I-Am's home; the heaven space. Sits directly under SPACE_ROOT.
  // Named "." . the bare presence-marker, "here, where I stand".
  // Parents every Tier-3 heaven space, so the I-Am's working memory
  // gathers into one room instead of cluttering the place root.
  HEAVEN: "heaven",
  IDENTITY: "identity",
  CONFIG: "config",
  PEERS: "peers",
  EXTENSIONS: "extensions",
  // Registry-mirror place heaven spaces. Each runtime registry (tool defs,
  // role specs, DO operations) syncs its contents into a child Space
  // here so SEE on `<story>/./tools` (etc.) returns the current registry
  // through the standard descriptor pipeline.
  TOOLS: "tools",
  ROLES: "roles",
  OPERATIONS: "operations",
  // The source self-tree. Seed walks its own place/ directory at boot
  // and plants a recursive filesystem-origin matter tree under this
  // space, mirroring the codebase as Mongo data. After MIRROR.md
  // step 2 source matter is writable through the chain: the FUSE
  // mount (scripts/mirror-mount.mjs) bridges writes through the
  // I-Am's verb path; the disk-fold populator (materials/space/
  // source.js) keeps its own carve-out for the initial disk walk.
  SOURCE: "source",
  // The threads space. A live tree of coordinated work (a
  // rootCorrelation chain) is addressable here as `./threads/<id>`. No
  // children are persisted; the projection is computed on demand from
  // inbox + Act records keyed by rootCorrelation. SUMMON to a
  // thread address is a cut (sever the line and everything hanging
  // off it). SEE returns the live forest. See
  // seed/materials/space/threads.js.
  THREADS: "threads",
  // The branches space. Each child names a divergent world by path
  // ("1", "1a", "1a1", ...); main itself is the implicit "0" and has
  // no child here. Children carry branch metadata in their qualities
  // (parent, branchPoint, label, paused state). SEE on
  // `<story>/./branches` returns the branch tree; the underlying
  // truth is the Branch Mongo collection (one row per non-main
  // branch). See seed/materials/branch/branches.js for the read
  // helpers and seed/timeline.md for the doctrine.
  BRANCHES: "branches",
  // The host tier: the running machine represented through the same
  // protocol as everything else. `host` is tier-3 under heaven; its
  // three children hold the HTTP listener, the WebSocket pool, and
  // the Mongo connection as beings + matter, fully fact-backed (the
  // opposite of ./source's disk-fold exception). One connection
  // matter per live socket lives in host-websocket; the request
  // stream lands on a request-log matter in host-http. See
  // seed/materials/host/ and philosophy/OS/nodeServerTest.md.
  HOST: "host",
  HOST_HTTP: "host-http",
  HOST_WEBSOCKET: "host-websocket",
  HOST_MONGO: "host-mongo",
  // The factory tier: the stamping machinery, watched. `factory` is
  // tier-3 under heaven; its two children are read-side projections
  // over Act + Fact rows — nothing new is stored. `present` shows
  // one stamper lane per (being, branch): the stamped papers laid
  // along the chain, the stamper figure at the head, forks splitting
  // where branches were born. `past` lists the reels. For beings
  // examining how the machinery works (why a packet stuck at the
  // stamper, where a trail broke) — the host is the computer; the
  // factory is the mechanism. See seed/materials/space/factory.js.
  FACTORY: "factory",
  FACTORY_PRESENT: "factory-present",
  FACTORY_PAST: "factory-past",
});

// ============================================================================
// SENTINEL VALUES
// ============================================================================
//
// DELETED. Placed in `parent` and (for matter) `beingId` when a space
//          is soft-deleted. The deleted-revive extension can bring
//          spaces back; matter stays soft-deleted.

export const DELETED = "deleted";

// I_AM moved to seed/materials/being/seedBeings.js (it's a being constant,
// not a space constant).
