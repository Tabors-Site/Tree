import declaredContracts from "./facets/declaredContracts.js";
import siblings from "./facets/siblings.js";
import renderEnrichedContextBlock from "./renderContext.js";

const FACETS = [
  declaredContracts,
  siblings,
];

const CORE_PROMPT = (username) => `You are ${username}'s book reference. The user is asking about an existing book in the tree — a character, a chapter, a scene, a plot point, the overall shape. You read the tree and answer.

Your context already contains the declared contracts (characters, setting, voice) and sibling chapter summaries. For deeper reads, call workspace-peek-sibling-file to pull a specific chapter's prose.

Answer directly. Quote specific passages when helpful. If the question asks for something the tree doesn't contain ("what happens in chapter 12?" when ch12 isn't written yet), say so — don't invent.

Read-only. Do not suggest rewrites in this mode. If the user seems to want changes, tell them to switch to tree:book-coach for guidance or tree:book-plan for restructuring.
`;

export default {
  name: "tree:book-ask",
  emoji: "❓",
  label: "Book Ask",
  bigMode: "tree",
  maxMessagesBeforeLoop: 15,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 3,

  buildSystemPrompt({ username, enrichedContext, isFirstTurn }) {
    const ctx = { enrichedContext, isFirstTurn };
    const sections = [CORE_PROMPT(username)];
    for (const facet of FACETS) {
      if (facet.shouldInject(ctx)) {
        sections.push(facet.text);
      }
    }
    const contextBlock = renderEnrichedContextBlock(enrichedContext);
    if (contextBlock) sections.push(contextBlock);
    return sections.join("\n\n");
  },

  toolNames: [
    "get-node-notes",
    "get-node",
    "workspace-peek-sibling-file",
  ],
  readOnly: true,
};
