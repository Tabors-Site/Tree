/**
 * Investor Dashboard
 *
 * Portfolio overview. Holdings with gains/losses, allocation,
 * watchlist, concentration warnings.
 */

import { renderAppDashboard } from "../../html-rendering/html/appDashboard.js";

const TYPE_COLORS = {
  stock: "#667eea",
  etf: "#48bb78",
  crypto: "#f6ad55",
  bond: "#4fd1c5",
  "real-estate": "#ed64a6",
  other: "#718096",
};

export function renderInvestorDashboard({ rootId, rootName, summary, watchlist, token, userId, inApp }) {
  const s = summary || {};
  const holdings = s.holdings || [];
  const allocation = s.allocation || [];
  const totalValue = s.totalValue || 0;
  const totalGain = s.totalGain || 0;
  const totalGainPercent = s.totalGainPercent || 0;
  const totalCost = s.totalCost || 0;
  const wl = watchlist || [];

  // Hero: total portfolio value
  const gainSign = totalGain >= 0 ? "+" : "";
  const hero = {
    value: `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    label: `${gainSign}$${totalGain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${gainSign}${totalGainPercent.toFixed(1)}%)`,
    color: totalGain >= 0 ? "#48bb78" : "#fc8181",
    sub: `Cost basis: $${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  };

  // Stats
  const stats = [];
  stats.push({ value: String(holdings.length), label: "holdings" });
  if (wl.length > 0) stats.push({ value: String(wl.length), label: "watching" });
  const concentration = allocation.filter(a => a.percent > 30);
  if (concentration.length > 0) {
    stats.push({ value: concentration.map(c => c.ticker).join(", "), label: ">30% concentration" });
  }

  // Bars: allocation by holding
  const bars = allocation
    .sort((a, b) => b.value - a.value)
    .map(a => {
      const h = holdings.find(h => h.ticker === a.ticker);
      const assetType = h?.assetType || "stock";
      return {
        label: `${a.ticker} (${a.percent.toFixed(1)}%)`,
        current: a.value,
        goal: totalValue,
        color: TYPE_COLORS[assetType] || "#a78bfa",
        unit: "$",
      };
    });

  // Cards
  const cards = [];

  // Holdings card with gain/loss detail
  if (holdings.length > 0) {
    cards.push({
      title: "Holdings",
      items: holdings
        .sort((a, b) => b.value - a.value)
        .map(h => {
          const gs = h.gain >= 0 ? "+" : "";
          return {
            text: `${h.ticker} . ${h.shares} ${h.assetType === "crypto" ? "units" : "shares"} @ $${h.entryPrice}`,
            detail: [`$${h.value.toFixed(2)}`, `${gs}$${h.gain.toFixed(2)}`, `${gs}${h.gainPercent.toFixed(1)}%`],
            sub: h.assetType,
          };
        }),
    });
  }

  // Watchlist card
  if (wl.length > 0) {
    cards.push({
      title: "Watchlist",
      items: wl.map(w => {
        const parts = [];
        if (w.targetPrice) parts.push(`target $${w.targetPrice}`);
        if (w.stopLoss) parts.push(`stop $${w.stopLoss}`);
        return {
          text: w.ticker,
          sub: parts.length > 0 ? parts.join(" . ") : null,
        };
      }),
    });
  }

  return renderAppDashboard({
    rootId,
    rootName: rootName || "Investor",
    token,
    userId,
    inApp: !!inApp,
    subtitle: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    hero,
    stats,
    bars,
    cards,
    chatBar: {
      placeholder: "Log a trade or ask about your portfolio...",
      endpoint: `/api/v1/root/${rootId}/chat`,
    },
    emptyState: holdings.length === 0
      ? { title: "No holdings yet", message: "Tell me what you bought. The tree tracks your portfolio." }
      : null,
  });
}
