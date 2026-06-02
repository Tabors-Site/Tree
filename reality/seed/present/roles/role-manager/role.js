// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// role-manager. The being that authors and edits live roles AND
// publishes world signals.
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
// `origin: "live"`. The set-role op also HOT-REGISTERS the role into
// the in-memory registry so the next moment-assign picks it up
// without a restart; the boot loader rebuilds the registry from the
// .roles mirror on subsequent boots.
//
// Live → live edits and deletions apply immediately. Name collisions
// with seed/extension roles overwrite in-memory (live wins), the same
// way the boot loader does on restart.
//
// World signals (set-world-signal) write to reality root's
// qualities.world.<ns>.<key>. Beings whose flows read
// `world.<ns>.<key>` see the value at their next moment-open. The
// authoring surface for environmental + coordination patterns
// (drummer publishes tick.alive; dancers' flows fire off it).
//
// I am a scripted-cognition delegate. My canDo lists the three ops;
// the portal discovers them by reading my descriptor entry's
// catalogs + actions and renders forms generically.

export const roleManagerRole = Object.freeze({
  name: "role-manager",
  description:
    "Authors and edits live-defined roles, publishes world signals. Click @role-manager at the reality root to open the panel.",
  requiredCognition: "scripted",
  permissions: ["do"],
  respondMode: "async",
  triggerOn: [],

  canDo: [
    {
      action:      "set-role",
      description: "create or replace a live role. Hot-registers into the in-memory registry; survives restart via the .roles mirror.",
    },
    {
      action:      "delete-role",
      description: "remove a live role. Refuses if any being's roleFlow references it (pass force:true to bypass).",
    },
    {
      action:      "set-world-signal",
      description: "publish a world signal at reality root. Flows that read world.<ns>.<key> see the new value at their next moment-open.",
    },
  ],

  async summon(_message, _ctx) {
    return null;
  },
});
