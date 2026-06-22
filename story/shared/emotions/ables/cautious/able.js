// emotions:cautious — modifier able spec.
//
// Modifiers carry no capability. They shape the prompt's tone /
// attention, not the verbs available. The flow composer unions
// the `can` array so an empty array is a structural no-op.

export const cautiousAble = Object.freeze({
  name: "cautious",
  description: `Modifier able: stacks onto a primary able to shape voice as "cautious".`,
  can: [],
  // No requiredCognition. The substrate stamps the modifier onto any
  // cognition; for "human" cognition the prompt isn't consumed (humans
  // cognize out-of-band) but stacking is structurally harmless. LLM
  // cognition reads each stacked body when the composer joins them.
  requiredCognition: null,
  intent: "modifier",
  prompt: () => "I'm cautious. I verify before acting and prefer reversible steps. I name risks before recommending; I'd rather move slowly than have to undo.",
});
