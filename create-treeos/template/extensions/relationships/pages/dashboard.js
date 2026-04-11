/**
 * Relationships Dashboard
 *
 * Shows people tracked, recent interactions, ideas for others.
 * Highlights who you haven't contacted in a while.
 */

import { renderAppDashboard } from "../../html-rendering/html/appDashboard.js";

export function renderRelationshipsDashboard({ rootId, rootName, people, recentInteractions, ideas, token, userId, inApp }) {
  const allPeople = people || [];
  const recent = recentInteractions || [];
  const allIdeas = ideas || [];

  // Sort people by lastContact (oldest first for overdue detection)
  const sorted = [...allPeople].sort((a, b) => {
    const aTime = a.lastContact ? new Date(a.lastContact).getTime() : 0;
    const bTime = b.lastContact ? new Date(b.lastContact).getTime() : 0;
    return aTime - bTime;
  });

  const overdue = sorted.filter(p => {
    if (!p.lastContact) return true;
    const days = Math.floor((Date.now() - new Date(p.lastContact).getTime()) / 86400000);
    return days > 14;
  });

  // Hero: total people
  const hero = {
    value: String(allPeople.length),
    label: allPeople.length === 1 ? "person tracked" : "people tracked",
    color: "#a78bfa",
    sub: overdue.length > 0 ? `${overdue.length} overdue for contact` : null,
  };

  // Stats
  const stats = [];
  if (recent.length > 0) stats.push({ value: String(recent.length), label: "recent interactions" });
  if (allIdeas.length > 0) stats.push({ value: String(allIdeas.length), label: "ideas pending" });
  const recentCount = allPeople.filter(p => {
    if (!p.lastContact) return false;
    const days = Math.floor((Date.now() - new Date(p.lastContact).getTime()) / 86400000);
    return days <= 7;
  }).length;
  if (recentCount > 0) stats.push({ value: String(recentCount), label: "contacted this week" });

  // Cards
  const cards = [];

  // People card
  if (allPeople.length > 0) {
    cards.push({
      title: "People",
      items: allPeople.map(p => {
        const parts = [];
        if (p.relation) parts.push(p.relation);
        if (p.lastContact) {
          const days = Math.floor((Date.now() - new Date(p.lastContact).getTime()) / 86400000);
          parts.push(days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`);
        } else {
          parts.push("never contacted");
        }
        return {
          text: p.name,
          sub: parts.join(" . "),
        };
      }),
    });
  }

  // Overdue card
  if (overdue.length > 0) {
    cards.push({
      title: "Reach Out To",
      items: overdue.slice(0, 10).map(p => {
        const days = p.lastContact
          ? Math.floor((Date.now() - new Date(p.lastContact).getTime()) / 86400000)
          : null;
        return {
          text: p.name,
          sub: p.relation ? `${p.relation} . ${days != null ? `${days} days` : "never"}` : (days != null ? `${days} days` : "never contacted"),
        };
      }),
    });
  }

  // Recent interactions card
  if (recent.length > 0) {
    cards.push({
      title: "Recent Interactions",
      items: recent.slice(0, 15).map(n => ({
        text: n.content || "Interaction",
        sub: n.createdAt ? new Date(n.createdAt).toLocaleDateString() : null,
      })),
    });
  }

  // Ideas card
  if (allIdeas.length > 0) {
    cards.push({
      title: "Ideas for People",
      items: allIdeas.slice(0, 10).map(n => ({
        text: n.content || "Idea",
        sub: n.createdAt ? new Date(n.createdAt).toLocaleDateString() : null,
      })),
    });
  }

  return renderAppDashboard({
    rootId,
    rootName: rootName || "Relationships",
    token,
    userId,
    inApp: !!inApp,
    subtitle: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    hero,
    stats,
    bars: [],
    cards,
    chatBar: {
      placeholder: "Tell me about someone or ask who to reach out to...",
      endpoint: `/api/v1/root/${rootId}/chat`,
    },
    emptyState: allPeople.length === 0
      ? { title: "No people tracked yet", message: "Tell me about someone in your life. The tree remembers." }
      : null,
  });
}
