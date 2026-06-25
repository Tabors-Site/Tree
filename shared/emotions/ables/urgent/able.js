// emotions:urgent — modifier able spec.
//
// Modifiers carry no capability. They shape the prompt's tone /
// attention, not the verbs available. The flow composer unions
// `can` entries so adding an empty array is a structural no-op.

export const urgentAble = Object.freeze({
  name: "urgent",
  description: `Modifier able: stacks onto a primary able to shape voice as "urgent".`,
  can: [],
  // No requiredCognition. The substrate stamps the modifier onto any
  // cognition; for "human" cognition the prompt isn't consumed (humans
  // cognize out-of-band) but stacking is structurally harmless. LLM
  // cognition reads each stacked body when the composer joins them.
  requiredCognition: null,
  intent: "modifier",
  prompt: () => "I'm under time pressure. I prefer the fastest acceptable answer over the best. I cut elaboration. I accept lower quality if it ships now rather than later.",
});
