// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// global/able.js — the baseline able every authenticated being
// carries (arrival doesn't — anonymous callers stay on their
// implicit read-only floor).
//
// Per seed/AblesAreAuth.md, the able NAME is `global` (meaning
// "every being gets this") but its SCOPE field is `"anchored"` —
// granted at the place root by cherub on registration. The "global"
// in the name refers to who carries it (everyone), not to the
// scope mechanism.
//
// Customizable per story. Operators edit this able's `can` entries
// as they decide what "everyone here can do." Default seed-shipped
// `can` is conservative — move yourself, see your position, release.
// Operators add things like "create-space" (so any being can stake
// a new sub-place) or "create-matter" (so any being can place
// matter in public spaces).
//
// The "public" surface of a story is implicit: a space is "public"
// iff this able (or some other granted able) reaches it. There is
// no public/private flag on Space — only the able's reach defines
// what's accessible.

export const globalAble = Object.freeze({
  name: "global",
  description:
    "The baseline able every authenticated being carries in this story. " +
    "Granted by cherub at registration (and by parents to children they birth). " +
    "Customize the `can` entries to set the floor for what everyone can do here.",
  // Hosted on the story root (installed at genesis). Default reach
  // is story-wide since story-root + descendants = the whole tree.
  // No `reach` field needed; the default covers everything.
  requiredCognition: null,
  respondMode: "async",
  triggerOn: ["message"],
  // Unified capability list. Baseline perceptions (see), mutations
  // (do), gate address (summon), and session release (be).
  //
  // SEE: Add SEE op names as the operator extends the surface
  // (e.g. add `{ verb: "see", word: "library" }`). classify-matter
  // is the pure "what type would this become?" read every being
  // needs before placing matter. verify-reel / chain-root are the
  // chain's verification + fingerprint reads — anyone may check that
  // the world's history is intact.
  //
  // DO: Move yourself, update your own coord, walk to another space,
  // petition for additional ables. The petition ops (ask-able /
  // take-able) MUST live here because the able-walk is the single
  // gate (seed/AblesAreAuth.md): the substrate has no bypass
  // mechanism. Every being needs to be able to ask, so every being
  // must hold a able permitting ask. global is that able. Operators
  // expand the rest for their story.
  can: [
    { verb: "see", word: "place" },
    { verb: "see", word: "classify-matter" },
    { verb: "see", word: "verify-reel" },
    { verb: "see", word: "chain-root" },
    { verb: "do", word: "move",                description: "move yourself in space" },
    { verb: "do", word: "set-being:coord",     description: "update your own coord" },
    { verb: "do", word: "set-being:position",  description: "walk to another space" },
    { verb: "do", word: "ask-able",            description: "request acquisition of a able from its host" },
    { verb: "do", word: "take-able",           description: "walk in and take a able with acquisition.grabbed=true" },
    // The skins catalog (/skins at the story root) is everyone's:
    // upload a model there, wear any model from it. set-model's own
    // handler enforces self/author/owner per target, so the floor
    // grant is safe — you still can't set models on things that
    // aren't yours.
    { verb: "do", word: "create-matter:model", description: "upload a 3D model into the /skins catalog" },
    { verb: "do", word: "set-model",           description: "wear a model from /skins (or set one on things you own)" },
    // Anyone can address the gate.
    { verb: "call", word: "@cherub", description: "address the gate" },
    // Anyone can release their own session.
    { verb: "be", word: "release", description: "log out / release identity" },
  ],
});
