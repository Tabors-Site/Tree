/**
 * Apps Page
 *
 * Launchpad for the proficiency stack. Four app cards.
 * Active apps link to their dashboard. Inactive apps show an input to start.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";

const APPS = [
  {
    key: "fitness",
    emoji: "💪",
    name: "Fitness",
    treeName: "Fitness",
    description: "Three languages: gym (weight x reps x sets), running (distance x time x pace), bodyweight (reps x sets or duration). One LLM call detects modality and parses. Progressive overload tracked per modality. Type be and the coach walks you through today's program set by set.",
    placeholder: "What do you train? (e.g. hypertrophy 4 days, running, bodyweight, or mix)",
    dashboardPath: "fitness",
  },
  {
    key: "food",
    emoji: "🍎",
    name: "Food",
    treeName: "Food",
    description: "Say what you ate. One LLM call parses macros. Cascade routes to Protein, Carbs, Fats nodes. Meals subtree tracks patterns by slot. History archives daily summaries. The food AI sees your workouts through channels.",
    placeholder: "What did you eat? (or just say hi to set up your goals)",
    dashboardPath: "food",
  },
  {
    key: "recovery",
    emoji: "🌿",
    name: "Recovery",
    treeName: "Recovery",
    description: "Track substances, feelings, cravings, and patterns. Taper schedules that bend around you. Pattern detection that finds correlations you can't see. A journal that holds without analyzing. The tree is a mirror, not a judge.",
    placeholder: "What are you working on? (e.g. caffeine reduction, alcohol, any substance)",
    dashboardPath: "recovery",
  },
  {
    key: "study",
    emoji: "📚",
    name: "Study",
    treeName: "Study",
    description: "Queue what you want to learn. The AI breaks it into a curriculum, teaches through conversation, tracks mastery per concept, and detects gaps you can't see. Paste a URL and it reads the content. Type be and it picks the next lesson.",
    placeholder: "What do you want to learn? (e.g. React hooks, Rust, Kubernetes)",
    dashboardPath: "study",
  },
];

export { APPS };

export function renderAppsPage({ userId, username, rootMap, qs }) {
  const tokenParam = qs?.token ? `&token=${esc(qs.token)}` : "";
  const tokenField = qs?.token ? `<input type="hidden" name="token" value="${esc(qs.token)}" />` : "";

  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .apps-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.5rem;
      max-width: 900px;
      margin: 2rem auto;
    }
    @media (max-width: 700px) { .apps-grid { grid-template-columns: 1fr; } }

    .app-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 24px;
      transition: border-color 0.2s;
    }
    .app-card:hover { border-color: rgba(255,255,255,0.15); }

    .app-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .app-emoji { font-size: 2rem; }
    .app-name { font-size: 1.2rem; font-weight: 600; color: #fff; }

    .app-desc {
      font-size: 0.85rem;
      color: rgba(255,255,255,0.5);
      line-height: 1.7;
      margin-bottom: 16px;
    }

    .app-active {
      display: inline-block;
      padding: 8px 20px;
      background: rgba(72, 187, 120, 0.15);
      border: 1px solid rgba(72, 187, 120, 0.3);
      border-radius: 8px;
      color: #48bb78;
      font-size: 0.9rem;
      text-decoration: none;
      font-weight: 500;
    }
    .app-active:hover { background: rgba(72, 187, 120, 0.25); }

    .app-form { display: flex; flex-direction: column; gap: 10px; }
    .app-input {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 10px 14px;
      color: #fff;
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
    }
    .app-input:focus { border-color: rgba(102, 126, 234, 0.4); }
    .app-input::placeholder { color: rgba(255,255,255,0.25); }

    .app-start {
      padding: 10px 20px;
      background: rgba(102, 126, 234, 0.2);
      border: 1px solid rgba(102, 126, 234, 0.3);
      border-radius: 8px;
      color: rgba(255,255,255,0.8);
      font-size: 0.9rem;
      cursor: pointer;
      font-family: inherit;
      align-self: flex-start;
    }
    .app-start:hover { background: rgba(102, 126, 234, 0.3); }

    .page-header {
      text-align: center;
      padding: 48px 20px 0;
    }
    .page-title { font-size: 1.6rem; color: #fff; margin-bottom: 8px; }
    .page-subtitle { color: rgba(255,255,255,0.45); font-size: 0.95rem; }
  `;

  const cards = APPS.map(app => {
    const entry = rootMap.get(app.treeName);
    const rootId = entry?.id;
    const ready = entry?.ready;

    // Fully set up: show Open button
    if (rootId && ready) {
      return `
        <div class="app-card">
          <div class="app-header">
            <span class="app-emoji">${app.emoji}</span>
            <span class="app-name">${app.name}</span>
          </div>
          <div class="app-desc">${app.description}</div>
          <a class="app-active" href="/api/v1/root/${rootId}/${app.dashboardPath}?html${tokenParam}">Open</a>
        </div>
      `;
    }

    // Tree exists but setup incomplete: show input to continue, link to dashboard
    if (rootId && !ready) {
      return `
        <div class="app-card">
          <div class="app-header">
            <span class="app-emoji">${app.emoji}</span>
            <span class="app-name">${app.name}</span>
            <span style="font-size:0.75rem;color:rgba(236,201,75,0.7);margin-left:auto;">setting up</span>
          </div>
          <div class="app-desc">${app.description}</div>
          <a class="app-active" style="background:rgba(236,201,75,0.12);border-color:rgba(236,201,75,0.3);color:#ecc94b;" href="/api/v1/root/${rootId}/${app.dashboardPath}?html${tokenParam}">Continue Setup</a>
        </div>
      `;
    }

    // No tree: show input to create
    return `
      <div class="app-card">
        <div class="app-header">
          <span class="app-emoji">${app.emoji}</span>
          <span class="app-name">${app.name}</span>
        </div>
        <div class="app-desc">${app.description}</div>
        <form class="app-form" method="POST" action="/api/v1/user/${userId}/apps/create">
          ${tokenField}
          <input type="hidden" name="app" value="${app.key}" />
          <input class="app-input" name="message" placeholder="${app.placeholder}" required />
          <button class="app-start" type="submit">Start ${app.name}</button>
        </form>
      </div>
    `;
  }).join("");

  const body = `
    <div class="page-header">
      <div class="page-title">Apps</div>
      <div class="page-subtitle">${esc(username || "")}'s proficiency stack</div>
    </div>
    <div style="max-width: 960px; margin: 0 auto; padding: 0 20px 60px;">
      <div class="apps-grid">
        ${cards}
      </div>
    </div>
  `;

  return page({ title: "Apps", css, body });
}
