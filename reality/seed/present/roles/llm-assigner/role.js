// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// llm-assigner role. The place's LLM-configuration character.
//
// Scripted cognition. The being is its code; the factory does not
// assemble a frame for it. Configuration operations (add-llm,
// assign-slot, list-llms, delete-llm, set-reality-llm, set-space-llm)
// live as registered DO ops under the `llm-assigner:*` prefix in
// [ops.js](./ops.js). The role here is a stub so the @llm-assigner
// stance resolves and the being row can be planted with
// roles: ["llm-assigner"]. triggerOn: [] means SUMMONs never queue.
//
// Tutorial constants stay on the role because the tutorial behavior
// belongs to the role (start-tutorial / complete-tutorial DO ops
// import these from here). Identity-bound state (homeSpace,
// password) lives on the Being row in seedDelegates.js.

export const LLM_ASSIGNER_TUTORIAL_MARK = "llm-assigner-intro";
export const LLM_ASSIGNER_TUTORIAL_URL = "https://www.youtube.com/watch?v=_cXGZXdiVgw";
export const LLM_ASSIGNER_TUTORIAL_VIDEO_ID = "_cXGZXdiVgw";

export const llmAssignerRole = Object.freeze({
  name: "llm-assigner",
  description:
    "LLM-configuration delegate. Reached through DO ops (llm-assigner:add-llm, assign-slot, set-space-llm, ...); not summon-dispatched.",
  requiredCognition: "scripted",
  permissions: ["be"],
  respondMode: "async",
  triggerOn: [],
  async summon(_message, _ctx) {
    return null;
  },
});
