// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// history-manager. The delegate that creates and manages divergent
// histories.
//
// A history is a new world that shares its trail with the parent up
// to a chosen past point, then runs independently. history-manager
// is the operator-facing surface for that: SUMMON me with a
// `create-branch` action and I plant a new history at the next
// available path under the chosen parent. The kernel handles the
// rest. The new history is queryable through SEE on
// `<story>/./histories/<path>` and can accept its own facts via
// moment.actorAct?.history threading (Pass 4 wires that).
//
// Pause / unpause / promote-to-live ship in later passes (6.5 and
// 10 respectively). The role advertises the can entry but the
// kernel doesn't have those ops yet.
//
// I am scripted cognition. The portal renders my can entries as a form;
// no LLM apparatus runs here.

export const historyManagerRole = Object.freeze({
  name: "history-manager",
  description:
    "Creates and manages histories. Divergent worlds forked from a past moment. Click @history-manager at the story root to mint a new history from a chosen parent + anchor.",
  requiredCognition: "scripted",
  permissions: ["do"],
  respondMode: "async",
  triggerOn: [],

  can: [
    {
      verb:        "do",
      word:        "create-branch",
      description: "fork a new history from a past point of an existing history. The new history inherits its trail up to the anchor; future facts diverge.",
    },
  ],

  async call(_message, _ctx) {
    return null;
  },
});
