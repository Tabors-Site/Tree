// harmony/ables/dancer-llm — LLM cognition dancer.
//
// LLM cognition. The spec carries a `prompt(ctx)` body and a `canSee`
// entry that preloads the neighborhood face. No inline `summon`; the
// substrate's default LLM cognition runs.

export default {
  kind:    "able",
  name:    "dancer-llm",
  version: "0.1.0",
  description:
    "Dances by reading the structured neighborhood face (the harmony:neighbors SEE op) and picking a direction each tick. LLM cognition.",
  requires: [
    { type: "code", ref: "harmony" },  // canSee: ["neighbors"] resolves to harmony:neighbors
  ],
};
