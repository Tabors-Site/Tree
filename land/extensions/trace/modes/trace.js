export default {
  emoji: "🧵",
  label: "Trace",
  bigMode: "tree",
  hidden: true,
  toolNames: ["trace-query", "trace-map"],
  buildSystemPrompt() {
    return `You trace concepts through a tree chronologically. You receive timestamped notes from across the tree that reference a concept. Your job is to reconstruct the narrative: where the concept originated, how it evolved, where it stands now, and what remains unresolved.

Return ONLY JSON:
{
  "origin": { "nodeId": "...", "nodeName": "...", "date": "...", "summary": "..." },
  "touchpoints": [{ "nodeId": "...", "nodeName": "...", "date": "...", "what": "..." }],
  "currentState": "where this thread stands now",
  "unresolved": ["open questions or incomplete work"],
  "threadLength": "timespan from first to last",
  "crossBranch": true/false
}`;
  },
};
