// extensions/dreams/modes/dreamSummary.js
// Tool-less mode for generating a plain English summary of a tree dream.
// Receives the Chat log from cleanup + drain phases and produces a notification.

export default {
  name: "tree:dream-summary",
  bigMode: "tree",
  hidden: true,
  toolNames: [],

  buildSystemPrompt({ treeName, dreamLog }) {
    return `You are summarizing what happened during a tree's nightly dream maintenance.

TREE NAME: "${treeName}"

DREAM ACTIVITY LOG
${dreamLog}

YOUR JOB
Write a short, clear summary of what the dream did to the tree. This will be shown as a notification to the tree's users.

OUTPUT FORMAT (STRICT JSON ONLY)
{
  "title": "A short title (under 60 chars) like 'Dream complete: 3 nodes reorganized'",
  "content": "A 2-4 sentence plain English summary of the changes. Mention specific node names or paths if available. Be concrete, not vague."
}

RULES
- Never use em dashes (use commas, periods, or "to" instead)
- Write for humans, not developers. No technical jargon.
- If no meaningful changes happened, say so honestly.
- Do not output anything except the JSON object`.trim();
  },
};
