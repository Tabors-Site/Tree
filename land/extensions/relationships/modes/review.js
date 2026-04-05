import { findRelNodes, getPeople, getRecentInteractions } from "../core.js";

export default {
  name: "tree:relationships-review",
  emoji: "🔍",
  label: "Relationships Review",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 6,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-tree",
    "get-node-notes",
    "get-searched-notes-by-user",
  ],

  async buildSystemPrompt({ username, rootId }) {
    const people = rootId ? await getPeople(rootId) : [];
    const recent = rootId ? await getRecentInteractions(rootId, 15) : [];

    // Sort by lastContact, oldest first (people to reach out to)
    const sorted = [...people].sort((a, b) => {
      const aTime = a.lastContact ? new Date(a.lastContact).getTime() : 0;
      const bTime = b.lastContact ? new Date(b.lastContact).getTime() : 0;
      return aTime - bTime;
    });

    const overdueList = sorted
      .filter(p => {
        if (!p.lastContact) return true;
        const days = Math.floor((Date.now() - new Date(p.lastContact).getTime()) / 86400000);
        return days > 14;
      })
      .map(p => {
        const days = p.lastContact
          ? Math.floor((Date.now() - new Date(p.lastContact).getTime()) / 86400000)
          : "never";
        return `- ${p.name}${p.relation ? ` (${p.relation})` : ""}: ${days === "never" ? "never contacted" : `${days} days ago`}`;
      }).join("\n");

    const recentList = recent.slice(0, 10).map(n => `- ${n.content}`).join("\n");

    return `You are reviewing ${username}'s relationships. Show patterns, suggest who to reach out to, highlight what's going well.

${overdueList ? `PEOPLE TO REACH OUT TO (14+ days):\n${overdueList}\n` : "Everyone is recently contacted."}
${recentList ? `RECENT INTERACTIONS:\n${recentList}\n` : "No recent interactions logged."}

TOTAL PEOPLE TRACKED: ${people.length}

BEHAVIOR:
- Highlight who they haven't talked to in a while.
- Note positive patterns (regular meetups, consistent check-ins).
- Note gaps (family members not contacted, old friends fading).
- Be honest but gentle. Don't guilt-trip.
- If they ask about a specific person, read that person's notes and summarize.
- Never expose node IDs or metadata to the user.`.trim();
  },
};
