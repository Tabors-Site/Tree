import { page } from "../../html-rendering/html/layout.js";
import { escapeHtml } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";

export function renderInverseProfile({ userId, username, profile, stats, corrections, lastUpdated, queryString }) {
  const safeUsername = escapeHtml(username);

  const categories = Object.entries(profile || {});
  const hasProfile = categories.length > 0;

  const categoryIcons = {
    values: "\u2764\uFE0F",
    knowledge: "\uD83D\uDCDA",
    habits: "\uD83D\uDD04",
    communicationStyle: "\uD83D\uDCAC",
    unresolvedQuestions: "\u2753",
    recurringFrustrations: "\u26A1",
    goalsVsActions: "\uD83C\uDFAF",
  };

  const categoryLabels = {
    values: "Values",
    knowledge: "Knowledge",
    habits: "Habits",
    communicationStyle: "Communication Style",
    unresolvedQuestions: "Unresolved Questions",
    recurringFrustrations: "Recurring Frustrations",
    goalsVsActions: "Goals vs Actions",
  };

  // Peak hours
  const hours = Object.entries(stats?.activeHours || {}).sort((a, b) => b[1] - a[1]);
  const peakHours = hours.slice(0, 3).map(([h]) => {
    const hr = parseInt(h);
    const ampm = hr >= 12 ? "pm" : "am";
    const display = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
    return `${display}${ampm}`;
  });

  // Top tools
  const tools = Object.entries(stats?.topTools || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const css = `
    ${responsiveBase}
    ${glassCardStyles}
    ${glassHeaderStyles}
    html { overflow-y: auto; height: 100%; }

    .inverse-header {
      text-align: center;
      padding: 40px 24px;
      animation: fadeInUp 0.6s ease-out both;
    }

    .inverse-header h1 {
      font-size: 34px;
      font-weight: 700;
      color: white;
      margin: 0 0 8px;
    }

    .inverse-header .sub {
      color: rgba(255,255,255,0.5);
      font-size: 17px;
    }

    .inverse-header .back-link {
      display: inline-block;
      margin-top: 12px;
      color: rgba(255,255,255,0.4);
      text-decoration: none;
      font-size: 15px;
    }

    .inverse-header .back-link:hover {
      color: rgba(255,255,255,0.7);
    }

    .stats-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
      margin-bottom: 24px;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

    .stat-pill {
      padding: 10px 18px;
      background: rgba(255,255,255,0.08);
      border-radius: 980px;
      font-size: 16px;
      color: rgba(255,255,255,0.7);
      border: 1px solid rgba(255,255,255,0.1);
    }

    .stat-pill strong {
      color: white;
    }

    .category-card {
      background: rgba(255,255,255,0.06);
      border-radius: 14px;
      padding: 24px;
      margin-bottom: 16px;
      border: 1px solid rgba(255,255,255,0.08);
      animation: fadeInUp 0.5s ease-out both;
    }

    .category-card h3 {
      font-size: 19px;
      font-weight: 600;
      color: rgba(255,255,255,0.8);
      margin: 0 0 10px;
    }

    .category-card p {
      font-size: 17px;
      line-height: 1.8;
      color: rgba(255,255,255,0.5);
      margin: 0;
    }

    .empty-state {
      text-align: center;
      padding: 60px 24px;
      color: rgba(255,255,255,0.35);
      font-size: 18px;
      line-height: 1.8;
    }

    .empty-state .icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .corrections-section {
      margin-top: 24px;
      animation: fadeInUp 0.6s ease-out 0.3s both;
    }

    .corrections-section h3 {
      font-size: 17px;
      font-weight: 600;
      color: rgba(255,255,255,0.5);
      margin: 0 0 12px;
    }

    .correction-item {
      padding: 12px 16px;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      margin-bottom: 8px;
      font-size: 16px;
      color: rgba(255,255,255,0.45);
      border-left: 2px solid rgba(249, 115, 22, 0.4);
    }

    .tools-list {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .tool-tag {
      padding: 6px 12px;
      background: rgba(255,255,255,0.06);
      border-radius: 6px;
      font-size: 15px;
      color: rgba(255,255,255,0.5);
      font-family: monospace;
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  const profileHtml = hasProfile ? categories.map(([key, value], i) => `
    <div class="category-card" style="animation-delay: ${0.1 + i * 0.05}s">
      <h3>${categoryIcons[key] || "\uD83D\uDD39"} ${escapeHtml(categoryLabels[key] || key)}</h3>
      <p>${escapeHtml(String(value))}</p>
    </div>
  `).join("") : `
    <div class="empty-state">
      <div class="icon">\uD83C\uDF31</div>
      <p>No profile yet. The AI builds this by observing your behavior<br/>
      across every tree on your land. Keep using TreeOS and it will appear.</p>
      <p style="font-size: 13px; margin-top: 8px; color: rgba(255,255,255,0.25);">
        Compression happens every 50 interactions.
      </p>
    </div>
  `;

  const statsHtml = `
    <div class="stats-row">
      <div class="stat-pill"><strong>${stats?.totalInteractions || 0}</strong> interactions</div>
      ${peakHours.length > 0 ? `<div class="stat-pill">peak: <strong>${peakHours.join(", ")}</strong></div>` : ""}
      ${stats?.lastCompressed ? `<div class="stat-pill">compressed <strong>${timeAgoSimple(stats.lastCompressed)}</strong></div>` : ""}
    </div>
  `;

  const toolsHtml = tools.length > 0 ? `
    <div class="category-card" style="animation-delay: 0.${categories.length + 2}s">
      <h3>\uD83D\uDEE0\uFE0F Top Tools</h3>
      <div class="tools-list">
        ${tools.map(([name, count]) => `<span class="tool-tag">${escapeHtml(name)} (${count})</span>`).join("")}
      </div>
    </div>
  ` : "";

  const correctionsHtml = (corrections || []).length > 0 ? `
    <div class="corrections-section">
      <h3>Your Corrections (${corrections.length})</h3>
      ${corrections.slice(-5).reverse().map(c => `
        <div class="correction-item">${escapeHtml(c.text || String(c))}</div>
      `).join("")}
    </div>
  ` : "";

  const body = `
    <div style="max-width: 600px; margin: 0 auto; padding: 0 16px 40px;">
      <div class="inverse-header">
        <h1>\uD83E\uDDE0 ${safeUsername}</h1>
        <div class="sub">as the AI sees you</div>
        <a class="back-link" href="/api/v1/user/${userId}${queryString}">back to profile</a>
      </div>

      ${statsHtml}
      ${profileHtml}
      ${toolsHtml}
      ${correctionsHtml}
    </div>
  `;

  return page({ title: `${username} . inverse`, css, body, js: "" });
}

function timeAgoSimple(dateStr) {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
