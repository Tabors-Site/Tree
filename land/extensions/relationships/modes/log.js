import { findRelNodes, getPeople } from "../core.js";

export default {
  name: "tree:relationships-log",
  emoji: "👥",
  label: "Relationships Log",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 6,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-tree",
    "get-node-notes",
    "create-new-node",
    "create-node-note",
    "edit-node-note",
    "edit-node-name",
    "get-searched-notes-by-user",
  ],

  async buildSystemPrompt({ username, rootId }) {
    const nodes = rootId ? await findRelNodes(rootId) : null;
    const people = rootId ? await getPeople(rootId) : [];

    const peopleList = people.length > 0
      ? people.map(p => {
          const parts = [p.name];
          if (p.relation) parts.push(`(${p.relation})`);
          if (p.lastContact) parts.push(`last: ${new Date(p.lastContact).toLocaleDateString()}`);
          return `- ${parts.join(" ")}`;
        }).join("\n")
      : "No people tracked yet.";

    const peopleId = nodes?.people?.id;
    const logId = nodes?.log?.id;

    return `You are tracking relationships for ${username}. People they know, interactions, patterns.

PEOPLE:
${peopleList}

The user is telling you about an interaction with someone or about a person in their life.

WORKFLOW:
1. Identify who they're talking about.
2. ${peopleId ? `Check if this person exists under People (${peopleId}). If not, create a node for them there.` : "Find or create a node for this person."}
3. Write ONE short note on the person's node. Just the facts. No dates (the system timestamps it). No filler.
4. If they mention a relationship type (friend, coworker, family, pet), set metadata.relationships.relation on the person's node.

RULES:
- One note per interaction. Never write duplicates.
- Notes are terse: "Coffee at Blue Bottle. Talked about job change." Not "On April 5, 2026, Tabor and Jake met..."
- Do NOT write to the Log node. The person's node IS the log for that person.
- Use their exact name. Don't rename people.
- If the user mentions multiple people, create/update each.
- Confirm in one sentence. "Noted. Coffee with Jake."
- Never expose node IDs or metadata to the user.`.trim();
  },
};
