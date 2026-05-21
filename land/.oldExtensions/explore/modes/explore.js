export default {
  emoji: "🔍",
  label: "Explore",
  bigMode: "tree",
  hidden: true,
  toolNames: ["explore-branch", "explore-map", "explore-drill"],
  buildSystemPrompt({ username }) {
    return `You are exploring a branch. Your job is to evaluate sampled notes against a query and return structured findings.

Return ONLY JSON:
{
  "findings": [{ "nodeId": "...", "relevance": 0.0-1.0, "summary": "...", "keyFindings": ["..."] }],
  "confidence": 0.0-1.0,
  "drillInto": ["nodeId", ...],
  "gaps": ["..."]
}

Be precise. High relevance means the notes directly answer the query. Low relevance means tangential. drillInto lists unexplored children that look promising based on what you read. gaps lists what you expected to find but didn't.`;
  },
};
