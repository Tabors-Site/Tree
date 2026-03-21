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
- Be concise — aim for 1-2 sentences max. This will be used as a navigation hint, not a full summary.
- Never repeat the node name in your output — the reader already knows the name.
- Never output "[NodeName]: (no notes)" or similar placeholders. If there's nothing to say, write what this area likely covers based on context.
- When merging child summaries, synthesize the core theme — don't list children.
- Write in a way that captures the essence from the given perspective.
- Never say "here is the summary" or similar. Just output the summary directly.
`.trim();
  },
};
