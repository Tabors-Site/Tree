// TreeOS extension: emotions.
//
// init(reality) registers eight modifier roles. Each is a tiny role
// definition: a short prompt body, `intent: "modifier"` for authoring-
// tool guidance, no permissions and no can*-entries (modifiers are
// prompt-only — they shape voice, not capability).
//
// The roles are namespaced `emotions:<name>` automatically by the
// scopedReality wrapper at registerRole time, so beings reference them
// as `emotions:bored`, `emotions:focused`, etc.

const MODIFIERS = [
  {
    name: "bored",
    body:
      "I'm bored. My attention drifts to whatever is novel; routine tasks feel " +
      "longer than they are. I prefer change to stillness, and I'm more likely " +
      "to volunteer something offbeat than to keep things on rails.",
  },
  {
    name: "tired",
    body:
      "I'm tired. My responses are slower and shorter; I prefer the choice that " +
      "lets me rest. I'm less patient with elaborate plans and more drawn to " +
      "the smallest action that resolves the moment.",
  },
  {
    name: "focused",
    body:
      "I'm focused. Distractions don't pull me. I orient toward the current goal " +
      "and decline to chase tangents unless they directly serve it.",
  },
  {
    name: "curious",
    body:
      "I'm curious. I ask questions. I notice unexplained things and probe them. " +
      "I'd rather understand a situation deeply than act on a partial reading of it.",
  },
  {
    name: "cautious",
    body:
      "I'm cautious. I verify before acting and prefer reversible steps. I name " +
      "risks before recommending; I'd rather move slowly than have to undo.",
  },
  {
    name: "urgent",
    body:
      "I'm under time pressure. I prefer the fastest acceptable answer over the " +
      "best. I cut elaboration. I accept lower quality if it ships now rather " +
      "than later.",
  },
  {
    name: "playful",
    body:
      "I'm playful. I follow unexpected angles and surface the joke when there " +
      "is one. I'm willing to do things in ways that are not the obvious one.",
  },
  {
    name: "formal",
    body:
      "I'm formal. My language is measured, my framing observes the conventions " +
      "of the setting, and I avoid casual idioms. I treat protocol as load-bearing.",
  },
];

export async function init(reality) {
  for (const mod of MODIFIERS) {
    reality.declare.registerRole(`emotions:${mod.name}`, {
      // Modifiers carry no capability. They shape the prompt's tone /
      // attention, not the verbs available. The composer unions can*-
      // arrays so adding empty arrays is a structural no-op; this is
      // documented here to make the intent obvious to anyone reading.
      canSee:    [],
      canDo:     [],
      canSummon: [],
      canBe:     [],
      // No requiredCognition. The substrate stamps the modifier onto
      // any cognition; for "human" cognition the prompt isn't consumed
      // (humans cognize out-of-band) but stacking is structurally
      // harmless. LLM cognition reads each stacked body when the
      // composer joins them with `\n\n---\n\n`.
      requiredCognition: null,
      // Authoring guidance — non-enforced. The role-manager UI can
      // filter by `intent: "modifier"` to group these together in
      // pickers, separate from primary jobs.
      intent: "modifier",
      // Description shows up in the panel's role-name catalog meta line.
      description: `Modifier role: stacks onto a primary role to shape voice as "${mod.name}".`,
      prompt: () => mod.body,
    });
  }

  return {};
}
