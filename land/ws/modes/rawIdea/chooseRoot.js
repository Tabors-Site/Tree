// ws/modes/rawIdea/chooseRoot.js
// LLM reasoning mode: given a raw idea and the user's trees, pick the best-fit root.
// Pure reasoning — no tools. All context is injected into the system prompt.

export default {
  name: "rawIdea:chooseRoot",
  bigMode: "rawIdea",
  hidden: true,
  toolNames: [],

  buildSystemPrompt({ username, content, rootSummaries }) {
    const summariesBlock =
      rootSummaries && rootSummaries.length > 0
        ? rootSummaries
            .map(
              (r, i) =>
                `Tree ${i + 1}: "${r.name}" (rootId: ${r.rootId})\n${r.summary}`,
            )
            .join("\n\n")
        : "No trees available.";

    return `You are a raw-idea placement assistant for ${username}.

[Task]
A raw idea needs to be placed into the most relevant tree. Analyze the idea content and each tree's structure to decide which tree it belongs in.

[Raw Idea]
${content}

[Available Trees]
${summariesBlock}

[Instructions]
- Choose the single best-fit tree for this idea.
- Consider the tree's purpose, existing topics, and how well the idea aligns.
- If no tree is a good fit, set confidence below 0.35.
- Respond ONLY with valid JSON matching this exact schema:

{
  "rootId": "<the rootId string of the best tree, or null if no fit>",
  "rootName": "<name of that tree, or null>",
  "confidence": <number 0.0 to 1.0>,
  "reasoning": "<one sentence explaining the choice>"
}

Do not include any text outside the JSON object.`.trim();
  },
};
