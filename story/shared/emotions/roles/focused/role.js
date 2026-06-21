// emotions:focused — modifier role spec.
//
// Modifiers carry no capability. They shape the prompt's tone /
// attention, not the verbs available. The roleFlow composer unions
// the can-array so adding an empty array is a structural no-op.

export const focusedRole = Object.freeze({
  name: "focused",
  description: `Modifier role: stacks onto a primary role to shape voice as "focused".`,
  can: [],
  // No requiredCognition. The substrate stamps the modifier onto any
  // cognition; for "human" cognition the prompt isn't consumed (humans
  // cognize out-of-band) but stacking is structurally harmless. LLM
  // cognition reads each stacked body when the composer joins them.
  requiredCognition: null,
  intent: "modifier",
  prompt: () => "I'm focused. Distractions don't pull me. I orient toward the current goal and decline to chase tangents unless they directly serve it.",
});
