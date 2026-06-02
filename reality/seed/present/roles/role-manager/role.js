// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// role-manager. The being that authors and edits live roles.
//
// Seed and extension roles are declared in code and registered at
// boot (genesis.js calls registerRole(name, def, "seed") or the
// loader does the same for extensions). Operators reach those role
// definitions through `<reality>/./roles/<name>` — read-only mirrors
// of the in-memory registry, synced by syncRolesToSubstrate.
//
// role-manager opens a third path: live-authored roles. An operator
// at the reality root clicks @role-manager, fills in a form (name,
// cognition guard, canSee/canDo/canSummon/canBe, prompt), and the
// resulting role-definition Fact lands at `./roles/<name>` tagged
// `origin: "live"`. A boot-time loader walks `./roles` for live
// entries and registerRole's them into the in-memory registry so
// they're addressable like any other role.
//
// Two precedence questions and their answers:
//
//   1. What happens when a live role's name collides with a seed/
//      extension one? The boot loader runs AFTER seed + extension
//      registration; it registerRole's the live entry, overwriting
//      the in-memory map for that name. Operators authoring a "human"
//      override get exactly that — their human definition replaces
//      the seed's. Reverting is "delete the live entry, restart."
//
//   2. Are live roles editable live, or restart-required? v1 = restart.
//      The boot loader runs once. Editing a live role writes a new
//      ./roles/<name> entry, but the in-memory registry only picks it
//      up on next boot. A future slice can hot-reload via an
//      afterMatter hook on ./roles changes. The cost of restart is
//      low; the cost of stale-cache bugs from hot-reload is high.
//
// I am a scripted-cognition delegate. My only canDo is the "set-role"
// DO op (defined in materials/being/roleOps.js); the actual form
// rendering happens in the portal, which discovers what fields exist
// by reading my canDo schema off the descriptor.

export const roleManagerRole = Object.freeze({
  name: "role-manager",
  description:
    "Authors and edits live-defined roles. Click @role-manager at the reality root to add a new role (live origin) or replace an existing one. Restart picks up live changes.",
  requiredCognition: "scripted",
  permissions: ["do"],
  respondMode: "async",
  triggerOn: [],

  canDo: [
    {
      action:      "set-role",
      description: "create or replace a live role. The role is registered at next boot (or now via the runtime registry refresh if the operator triggers it).",
    },
  ],

  async summon(_message, _ctx) {
    return null;
  },
});
