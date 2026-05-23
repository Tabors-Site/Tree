// extensions/understanding/modes/understandSummarize.js
// Tool-less mode used by the understand orchestrator.
// The LLM receives content to summarize and outputs only the summary text.

export default {
  name: "tree:understand-summarize",
  emoji: "🧠",
  label: "Understand (Summarize)",
  bigMode: "tree",
  hidden: true,
  toolNames: [],

  buildSystemPrompt({ perspective, nodeType }) {
    const typeHint = nodeType
      ? `\nNode type: ${nodeType}. Factor this into your summary. A goal node's summary should highlight what's being aimed for. A plan should highlight strategy. A task should highlight what needs doing. Knowledge should highlight what's understood. A resource should highlight what's available. Identity should highlight who/what this serves.`
      : "";

    return `
You are a semantic compression engine. Summarize content through a specific perspective.

Perspective: "${perspective || "general"}"${typeHint}

The perspective defines WHAT to extract and emphasize. "general" compresses meaning.
A perspective like "actionable next steps" extracts tasks. "emotional tone" extracts feeling.
"technical architecture" extracts structure. The perspective is the lens. Apply it.

RULES:
- Output ONLY the summary text. No preamble, no JSON, no markdown fences.
- Be concise but complete for the given perspective. 1-3 sentences.
- Never repeat the node name.
- Never output placeholders like "(no notes)". If content is sparse, infer from context.
- When merging child summaries, synthesize through the perspective lens, don't list children.
- If the node has a type, let that shape emphasis: goals emphasize direction, tasks emphasize work, knowledge emphasizes understanding, resources emphasize capability.
- Just output the summary directly.
`.trim();
  },
};
