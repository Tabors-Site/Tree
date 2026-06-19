// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// llm-assigner role. The place's LLM-configuration delegate.
//
// As of the bare-name refactor: the LLM-management ops (add-llm,
// delete-llm, assign-slot, set-being-llm, set-space-llm,
// set-reality-llm) are SEED-OWNED ops with bare names, NOT
// llm-assigner-prefixed. Any being with the appropriate canDo (or
// owner-check on the target space) can call them directly. The
// substrate doesn't route through @llm-assigner.
//
// What stays llm-assigner-prefixed:
//   - llm-assigner:start-tutorial / save-playback / complete-tutorial
//     (the welcome-tutorial flow that's specific to this delegate's UX)
//
// The role here is mostly a stub so the @llm-assigner stance resolves
// and the being row carries the role grant. triggerOn: [] means
// SUMMONs to @llm-assigner never queue — interaction is by direct DO
// dispatch (or the tutorial intent).
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
    "LLM-configuration delegate. The substrate ops (add-llm, delete-llm, assign-slot, set-being-llm, set-space-llm, set-reality-llm) are seed-owned and callable by any being with the right canDo; this delegate also hosts the tutorial flow (llm-assigner:start-tutorial / save-playback / complete-tutorial).",
  requiredCognition: "scripted",
  permissions: ["be"],
  respondMode: "async",
  triggerOn: [],
  async call(_message, _ctx) {
    return null;
  },
});
