// The cherub birth flow, hand-built as Word IR (Phase 2 slice).
//
// Mirrors the real subsequent-user birth path: _registerHumanWithFreshHome in
// story/seed/present/roles/cherub/role.js (L856-987) and birthBeing in
// story/seed/materials/being/identity/birth.js (L177-686). It lays the same
// five facts the JS handler does (the Phase 2 gate):
//   1 do:create-space  (the home)
//   2 be:birth         (via form-being -> birthBeing; +inherited-role +global grants)
//   3 do:set-space     (owner = the new being)
//   4 do:grant-role    (human)
//   5 do:set-being     (qualities.lineage)
//
// Idealized surface (4.md example 1), which this IR is the parse of:
//   When Cherub births a being, with a name and a password:
//     make a home space.
//     form the being under a new Name.
//     make the being the home's owner.
//     grant the being the human role.
//     record the being's lineage.
//
// IR shape: see philosophy/word/5.md. Each act carries `verb` (one of the five),
// `op` (the operation within that verb), `by` (the acting Name), `through` (the
// vessel, absent here, a NAME-layer-ish form act), `of` (the target), `params`.
// `bind` names a fresh id for later reference; `$name` reads a binding; `{ref}`
// points at one.

export const cherubBirth = {
  kind: "flow", // rule 6: a dormant watch, fired here by the birth summon
  // Arrival summons Cherub to birth a being, with a name and a password (rule 1, active)
  when: { summon: { to: "Cherub", intent: "birth", of: { kind: "being" } } },
  binds: ["name", "password"], // bound from the summon payload
  effects: [
    // 1. make a home space
    {
      kind: "act", verb: "do", op: "create-space",
      by: "Cherub",
      of: { kind: "space", bind: "home" },
      params: { name: "$name", type: "home-territory", parent: "$placeRoot", size: { x: 100, y: 100 } },
    },
    // 2. form the being under a new Name (birthBeing mints the Name and lays
    //    be:birth + the inherited-role grants + the global grant: one act, many facts)
    {
      kind: "act", verb: "be", op: "form-being",
      by: "Cherub", through: null, // the new being has no vessel yet
      bind: "child",
      params: {
        name: "$name", password: "$password",
        cognition: "human", defaultRole: "human",
        parentBeingId: "Cherub", homeId: "$home",
      },
    },
    // 3. make the being the home's owner
    {
      kind: "act", verb: "do", op: "set-space",
      by: "I_AM",
      of: { kind: "space", ref: "home" },
      params: { field: "owner", value: "$child" },
    },
    // 4. grant the being the human role
    {
      kind: "act", verb: "do", op: "grant-role",
      by: "Cherub",
      of: { kind: "being", ref: "child" },
      params: { role: "human", anchorSpaceId: "$placeRoot" },
    },
    // 5. record the being's lineage
    {
      kind: "act", verb: "do", op: "set-being",
      by: "I_AM",
      of: { kind: "being", ref: "child" },
      params: { field: "qualities.lineage", value: { mother: "Cherub", father: null }, merge: false },
    },
  ],
};

// Deferred to later Phase 2 work (kept out of the first slice on purpose):
// - the first-being path (parent = I_AM, post-seal grant-role:angel via afterSeal)
// - the connect ops (credential bind, owned, inherit / father-priority)
// See README.md.
export default cherubBirth;
