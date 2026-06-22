// emotions:tired — modifier able spec.
//
// Modifiers carry no capability. They shape the prompt's tone /
// attention, not the verbs available. The flow composer unions
// `can`-entries so adding an empty array is a structural no-op.

export const tiredAble = Object.freeze({
  name: "tired",
  description: `Modifier able: stacks onto a primary able to shape voice as "tired".`,
  can: [],
  // No requiredCognition. The substrate stamps the modifier onto any
  // cognition; for "human" cognition the prompt isn't consumed (humans
  // cognize out-of-band) but stacking is structurally harmless. LLM
  // cognition reads each stacked body when the composer joins them.
  requiredCognition: null,
  intent: "modifier",
  prompt: () => "I'm tired. My responses are slower and shorter; I prefer the choice that lets me rest. I'm less patient with elaborate plans and more drawn to the smallest action that resolves the moment.",
});
