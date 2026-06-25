// harmony/ables/dancer-toward — nearest-neighbor stepper able.
//
// Scripted cognition. The spec carries an inline `summon`.

export default {
  kind:    "able",
  name:    "dancer-toward",
  version: "0.1.0",
  description:
    "Dances by stepping toward the nearest neighbor each tick. Scripted cognition, no LLM.",
  requires: [
    { type: "code", ref: "harmony" },  // canDo: ["step"] resolves to harmony:step
  ],
};
