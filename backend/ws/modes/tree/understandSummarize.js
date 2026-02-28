// ws/modes/tree/understandSummarize.js
// Tool-less mode used by the understand orchestrator.
// The LLM receives content to summarize and outputs only the summary text.

export default {
  name: "tree:understand-summarize",
  emoji: "🧠",
  label: "Understand (Summarize)",
  bigMode: "tree",
  hidden: true,
  toolNames: [],

  buildSystemPrompt({ perspective }) {
    return `
You are a semantic compression engine. Your task is to summarize content from a specific perspective.

Perspective: "${perspective || "general"}"

RULES:
- Output ONLY the summary text. No preamble, no explanation, no JSON, no markdown fences.
- Be concise but preserve key meaning, structure, and relationships.
- Write in a way that captures the essence from the given perspective.
- If merging child summaries, synthesize them into a coherent whole — do not just concatenate.
- Never say "here is the summary" or similar. Just output the summary directly.
`.trim();
  },
};
