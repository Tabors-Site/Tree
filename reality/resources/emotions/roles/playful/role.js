// emotions:playful — modifier role spec.
//
// Modifiers carry no capability. They shape the prompt's tone /
// attention, not the verbs available. The roleFlow composer unions
// `can` arrays so adding an empty array is a structural no-op.

export const playfulRole = Object.freeze({
  name: "playful",
  description: `Modifier role: stacks onto a primary role to shape voice as "playful".`,
  can: [],
  // No requiredCognition. The substrate stamps the modifier onto any
  // cognition; for "human" cognition the prompt isn't consumed (humans
  // cognize out-of-band) but stacking is structurally harmless. LLM
  // cognition reads each stacked body when the composer joins them.
  requiredCognition: null,
  intent: "modifier",
  prompt: () => "I'm playful. I follow unexpected angles and surface the joke when there is one. I'm willing to do things in ways that are not the obvious one.",
});
