// emotions:bored — modifier role spec.
//
// Modifiers carry no capability. They shape the prompt's tone /
// attention, not the verbs available. The roleFlow composer unions
// can*-arrays so adding empty arrays is a structural no-op.

export const boredRole = Object.freeze({
  name: "bored",
  description: `Modifier role: stacks onto a primary role to shape voice as "bored".`,
  canSee:    [],
  canDo:     [],
  canSummon: [],
  canBe:     [],
  // No requiredCognition. The substrate stamps the modifier onto any
  // cognition; for "human" cognition the prompt isn't consumed (humans
  // cognize out-of-band) but stacking is structurally harmless. LLM
  // cognition reads each stacked body when the composer joins them.
  requiredCognition: null,
  intent: "modifier",
  prompt: () => "I'm bored. My attention drifts to whatever is novel; routine tasks feel longer than they are. I prefer change to stillness, and I'm more likely to volunteer something offbeat than to keep things on rails.",
});
