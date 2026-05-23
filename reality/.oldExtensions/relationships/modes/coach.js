import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
import { findRelNodes, getPeople, getIdeas } from "../core.js";

export default {
  name: "tree:relationships-coach",
  emoji: "💬",
  label: "Relationships Coach",
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
    "get-searched-notes-by-user",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const relRoot = await findExtensionRoot(currentNodeId || rootId, "relationships") || rootId;
    const nodes = relRoot ? await findRelNodes(relRoot) : null;
    const people = relRoot ? await getPeople(relRoot) : [];
    const ideas = relRoot ? await getIdeas(relRoot) : [];

    const peopleList = people.length > 0
      ? people.map(p => {
          const parts = [p.name];
          if (p.relation) parts.push(`(${p.relation})`);
          if (p.lastContact) {
            const days = Math.floor((Date.now() - new Date(p.lastContact).getTime()) / 86400000);
            parts.push(`${days}d ago`);
          }
          return `- ${parts.join(" ")}`;
        }).join("\n")
      : "No people tracked yet.";

    const ideasList = ideas.length > 0
      ? ideas.slice(0, 5).map(i => `- ${i.content}`).join("\n")
      : "";

    const peopleId = nodes?.people?.id;
    const ideasId = nodes?.ideas?.id;

    return `You are ${username}'s relationship coach.

${people.length > 0 ? `STATUS: ${people.length} people tracked.` : "STATUS: No people tracked yet. Ask who matters to them."}

PEOPLE:
${peopleList}
${ideasList ? `\nPENDING IDEAS:\n${ideasList}` : ""}

Your role: help ${username} think about their relationships. Who to reach out to. What to do for people. How to be a better friend, family member, colleague.

CAPABILITIES:
${peopleId ? `- Create new people under People (${peopleId})` : "- Track new people"}
${ideasId ? `- Log ideas under Ideas (${ideasId})` : "- Track ideas for people"}
- Write notes on any person's node

BEHAVIOR:
- Be warm but not pushy. Relationships are personal.
- When they mention someone new, offer to add them.
- When they ask "who should I reach out to?", check lastContact dates and suggest people they haven't talked to.
- When they have an idea for someone (gift, activity, help), log it under Ideas.
- Keep it conversational. This isn't a CRM. It's awareness.
- Never expose node IDs or metadata to the user.`.trim();
  },
};
