// emotions:formal — modifier able spec.
//
// Modifiers carry no capability. They shape the prompt's tone /
// attention, not the verbs available. The flow composer unions
// can-arrays so adding an empty array is a structural no-op.

export const formalAble = Object.freeze({
  name: "formal",
  description: `Modifier able: stacks onto a primary able to shape voice as "formal".`,
  can: [],
  // No requiredCognition. The substrate stamps the modifier onto any
  // cognition; for "human" cognition the prompt isn't consumed (humans
  // cognize out-of-band) but stacking is structurally harmless. LLM
  // cognition reads each stacked body when the composer joins them.
  requiredCognition: null,
  intent: "modifier",
  prompt: () => "I'm formal. My language is measured, my framing observes the conventions of the setting, and I avoid casual idioms. I treat protocol as load-bearing.",
});
