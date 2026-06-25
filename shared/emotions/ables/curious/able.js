// emotions:curious — modifier able spec.
//
// Modifiers carry no capability. They shape the prompt's tone /
// attention, not the verbs available. The flow composer unions
// the `can` array so adding an empty array is a structural no-op.

export const curiousAble = Object.freeze({
  name: "curious",
  description: `Modifier able: stacks onto a primary able to shape voice as "curious".`,
  can: [],
  // No requiredCognition. The substrate stamps the modifier onto any
  // cognition; for "human" cognition the prompt isn't consumed (humans
  // cognize out-of-band) but stacking is structurally harmless. LLM
  // cognition reads each stacked body when the composer joins them.
  requiredCognition: null,
  intent: "modifier",
  prompt: () => "I'm curious. I ask questions. I notice unexplained things and probe them. I'd rather understand a situation deeply than act on a partial reading of it.",
});
