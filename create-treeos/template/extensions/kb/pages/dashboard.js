/**
 * KB Dashboard
 *
 * Topics, stale notes, unplaced items, recent updates.
 * Renders via the generic app dashboard.
 */

import { renderAppDashboard } from "../../html-rendering/html/appDashboard.js";
import { timeAgo } from "../../html-rendering/html/utils.js";

export function renderKbDashboard({ rootId, rootName, status, stale, unplaced, token, userId, hasEmbed, hasScout, inApp }) {
  if (!status) {
    return renderAppDashboard({
      rootId, rootName, token, userId, inApp,
      emptyState: { title: "Not initialized yet", message: "Tell it something to get started. The AI will create the topic structure from what you say." },
      commands: [
        { cmd: "kb <statement>", desc: "Tell the kb something new" },
        { cmd: "kb <question>", desc: "Ask the kb something" },
      ],
      chatBar: { placeholder: "Tell me something to get started...", endpoint: `/api/v1/root/${rootId}/kb` },
    });
  }

  const profile = status.profile || {};

  // Subtitle
  const subParts = [];
  const maintainers = (profile.maintainers || []).slice(0, 5);
  if (maintainers.length > 0) subParts.push(`Maintained by ${maintainers.join(", ")}`);
  if (profile.description) subParts.push(profile.description);

  // Stats
  const stats = [
    { value: String(status.topicCount || 0), label: "topics" },
    { value: String(status.noteCount || 0), label: "notes" },
  ];
  if (status.staleNotes > 0) stats.push({ value: String(status.staleNotes), label: "stale" });
  if (status.unplacedCount > 0) stats.push({ value: String(status.unplacedCount), label: "unplaced" });

  // Tags for topics + capabilities
  const tags = [];
  const topicNoteCounts = status.topicNoteCounts || {};
  if (status.coverage?.length > 0) {
    for (const t of status.coverage) {
      tags.push({ label: t, count: topicNoteCounts[t] || null });
    }
  }
  // Capability badges
  if (hasScout) tags.push({ label: "scout", color: "#48bb78" });
  if (hasEmbed) tags.push({ label: "semantic", color: "#48bb78" });

  // Cards
  const cards = [];

  // Stale notes
  cards.push({
    title: "Stale Notes",
    items: (stale || []).slice(0, 10).map(s => ({
      text: s.nodeName,
      sub: `${s.daysStale}d old . ${s.preview || ""}`,
    })),
    empty: "No stale notes. Everything is fresh.",
  });

  // Unplaced
  cards.push({
    title: "Unplaced",
    items: (unplaced || []).slice(0, 10).map(u => ({
      text: u.content,
      sub: timeAgo(u.date),
    })),
    empty: "Nothing unplaced. Everything has a home.",
  });

  // Recent updates
  if (status.recentUpdates?.length > 0) {
    cards.push({
      title: "Recent Updates",
      items: status.recentUpdates.map(u => ({
        text: u.name,
        sub: timeAgo(u.date),
      })),
    });
  }

  return renderAppDashboard({
    rootId, rootName: status.name || rootName, token, userId, inApp,
    subtitle: subParts.join(" . ") || null,
    stats,
    tags: tags.length > 0 ? tags : null,
    cards,
    commands: [
      { cmd: "kb <statement>", desc: "Tell the kb something new" },
      { cmd: "kb <question>", desc: "Ask the kb something" },
      { cmd: "kb status", desc: "Coverage and freshness" },
      { cmd: "kb stale", desc: "Notes needing review" },
      { cmd: "kb unplaced", desc: "Uncategorized items" },
      { cmd: "kb review", desc: "Guided review of stale notes" },
      { cmd: "be", desc: "Start guided review mode" },
    ],
    chatBar: { placeholder: "Tell me something or ask a question...", endpoint: `/api/v1/root/${rootId}/kb` },
  });
}
