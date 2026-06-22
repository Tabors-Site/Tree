// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// able-manager. The being that authors and edits live ables AND
// publishes world signals.
//
// Seed and extension ables are declared in code and registered at
// boot (genesis.js calls registerAble(name, def, "seed") or the
// loader does the same for extensions). Operators reach those able
// definitions through `<story>/./ables/<name>` — read-only mirrors
// of the in-memory registry, synced by syncAblesToSubstrate.
//
// able-manager opens a third path: live-authored ables. An operator
// at the story root clicks @able-manager, fills in a form (name,
// cognition guard, can (verb+word capabilities), prompt), and the
// resulting able-definition Fact lands at `./ables/<name>` tagged
// `origin: "live"`. The set-able op also HOT-REGISTERS the able into
// the in-memory registry so the next moment-assign picks it up
// without a restart; the boot loader rebuilds the registry from the
// .ables mirror on subsequent boots.
//
// Live → live edits and deletions apply immediately. Name collisions
// with seed/extension ables overwrite in-memory (live wins), the same
// way the boot loader does on restart.
//
// World signals (set-world-signal) write to story root's
// qualities.world.<ns>.<key>. Beings whose flows read
// `world.<ns>.<key>` see the value at their next moment-open. The
// authoring surface for environmental + coordination patterns
// (drummer publishes tick.alive; dancers' flows fire off it).
//
// I am a scripted-cognition delegate. My can lists the three do ops;
// the portal discovers them by reading my descriptor entry's
// catalogs + actions and renders forms generically.

export const ableManagerAble = Object.freeze({
  name: "able-manager",
  description:
    "Authors and edits live-defined ables, publishes world signals. Click @able-manager at the story root to open the panel.",
  requiredCognition: "scripted",
  permissions: ["do"],
  respondMode: "async",
  triggerOn: [],

  can: [
    {
      verb:        "do",
      word:        "set-able",
      description: "create or replace a live able. Hot-registers into the in-memory registry; survives restart via the .ables mirror.",
    },
    {
      verb:        "do",
      word:        "delete-able",
      description: "remove a live able. Refuses if any being's flow references it (pass force:true to bypass).",
    },
    {
      verb:        "do",
      word:        "set-world-signal",
      description: "publish a world signal at story root. Flows that read world.<ns>.<key> see the new value at their next moment-open.",
    },
  ],

  async call(_message, _ctx) {
    return null;
  },
});
