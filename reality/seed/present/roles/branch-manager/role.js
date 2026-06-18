// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// branch-manager. The delegate that creates and manages divergent
// worlds (branches).
//
// A branch is a new world that shares history with its parent up to
// a chosen past point, then runs independently. branch-manager is
// the operator-facing surface for that: SUMMON me with a
// `create-branch` action and I plant a new branch at the next
// available path under the chosen parent. The substrate handles the
// rest — the new branch is queryable through SEE on
// `<reality>/./branches/<path>` and can accept its own facts via
// summonCtx.actorAct?.branch threading (Pass 4 wires that).
//
// Pause / unpause / promote-to-live ship in later passes (6.5 and
// 10 respectively). The role advertises the can entry but the
// substrate doesn't have those ops yet.
//
// I am scripted cognition. The portal renders my can entries as a form;
// no LLM apparatus runs here.

export const branchManagerRole = Object.freeze({
  name: "branch-manager",
  description:
    "Creates and manages branches — divergent worlds forked from a past moment. Click @branch-manager at the reality root to mint a new branch from a chosen parent + anchor.",
  requiredCognition: "scripted",
  permissions: ["do"],
  respondMode: "async",
  triggerOn: [],

  can: [
    {
      verb:        "do",
      word:        "create-branch",
      description: "fork a new world from a past point of an existing branch. The new branch inherits history up to the anchor; future facts diverge.",
    },
  ],

  async summon(_message, _ctx) {
    return null;
  },
});
