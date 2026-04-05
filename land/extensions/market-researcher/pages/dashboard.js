/**
 * Market Researcher Dashboard
 *
 * Shows sectors being tracked, recent findings, watchlist.
 * Research summaries organized by sector.
 */

import { renderAppDashboard } from "../../html-rendering/html/appDashboard.js";

export function renderResearchDashboard({ rootId, rootName, sectors, findings, watchlist, token, userId, inApp }) {
  const allSectors = sectors || [];
  const allFindings = findings || [];
  const wl = watchlist || [];

  // Hero: research activity
  const hero = {
    value: String(allFindings.length),
    label: allFindings.length === 1 ? "finding" : "findings",
    color: "#667eea",
    sub: allSectors.length > 0 ? `${allSectors.length} sectors tracked` : null,
  };

  // Stats
  const stats = [];
  if (allSectors.length > 0) stats.push({ value: String(allSectors.length), label: "sectors" });
  if (wl.length > 0) stats.push({ value: String(wl.length), label: "watching" });
  const recentCount = allFindings.filter(f => {
    if (!f.createdAt) return false;
    const hours = (Date.now() - new Date(f.createdAt).getTime()) / 3600000;
    return hours < 24;
  }).length;
  if (recentCount > 0) stats.push({ value: String(recentCount), label: "last 24h" });

  // Cards
  const cards = [];

  // Sectors card
  if (allSectors.length > 0) {
    cards.push({
      title: "Sectors",
      items: allSectors.map(s => ({ text: s.name })),
    });
  }

  // Recent findings card
  if (allFindings.length > 0) {
    cards.push({
      title: "Recent Findings",
      items: allFindings.slice(0, 20).map(f => ({
        text: f.content || "Finding",
        sub: f.createdAt ? new Date(f.createdAt).toLocaleDateString() : null,
      })),
    });
  }

  // Watchlist card
  if (wl.length > 0) {
    cards.push({
      title: "Watchlist",
      items: wl.map(w => ({
        text: w.name,
        sub: w.notes || null,
      })),
    });
  }

  return renderAppDashboard({
    rootId,
    rootName: rootName || "Market Research",
    token,
    userId,
    inApp: !!inApp,
    subtitle: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    hero,
    stats,
    bars: [],
    cards,
    chatBar: {
      placeholder: "Research a market, check a price, or review findings...",
      endpoint: `/api/v1/root/${rootId}/chat`,
    },
    emptyState: allFindings.length === 0 && allSectors.length === 0
      ? { title: "No research yet", message: "Tell me what to research. I'll use the browser to find data." }
      : null,
  });
}
