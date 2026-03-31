/**
 * Generic App Dashboard
 *
 * One renderer for all tree-as-app extensions. The extension describes
 * what to show. This file renders it. No extension-specific logic here.
 *
 * Usage from an extension's htmlRoutes.js:
 *
 *   import { renderAppDashboard } from "../../html-rendering/html/appDashboard.js";
 *
 *   res.send(renderAppDashboard({
 *     rootId, rootName, token, userId, dateStr,
 *     subtitle: "180g protein, 2400 cal target",
 *     hero: { value: "1,847", label: "of 2,400 calories (77%)", color: "#48bb78" },
 *     stats: [
 *       { label: "avg cal/day", value: "2,100" },
 *       { label: "days tracked", value: "12" },
 *     ],
 *     bars: [
 *       { label: "Protein", current: 120, goal: 180, color: "#667eea", sub: "avg: 135g" },
 *     ],
 *     cards: [
 *       { title: "Recent Log", items: [{ text: "Chicken and rice", sub: "12:30 PM" }] },
 *       { title: "Past 7 Days", items: [{ text: "Mon", sub: "P:150 C:200 F:60" }] },
 *     ],
 *     commands: [
 *       { cmd: "food <message>", desc: "Log what you ate" },
 *     ],
 *     chatBar: { placeholder: "What did you eat?", endpoint: "/api/v1/root/xyz/food" },
 *   }));
 */

import { page } from "./layout.js";
import { esc } from "./utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "./baseStyles.js";
import { chatBarCss, chatBarHtml, chatBarJs, commandsRefHtml } from "./chatBar.js";

function pctColor(pct) {
  if (pct >= 90) return "#48bb78";
  if (pct >= 60) return "#ecc94b";
  return "#718096";
}

export function renderAppDashboard(opts) {
  const {
    rootId, rootName, token, userId, dateStr, inApp,
    subtitle, hero, stats, bars, cards, tags,
    commands, chatBar, emptyState, afterBars, extraCss, extraJs,
  } = opts;

  const today = new Date();
  const date = dateStr || today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .app-layout { max-width: 800px; margin: 0 auto; padding: 1.5rem; }
    .app-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; margin-top: 1.5rem; }
    @media (max-width: 700px) { .app-grid { grid-template-columns: 1fr; } }

    .section-title {
      font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: rgba(255,255,255,0.5); margin-bottom: 0.5rem; margin-top: 1.5rem;
    }

    .app-hero { text-align: center; padding: 28px 0 20px; }
    .app-hero-val { font-size: 2.5rem; font-weight: 700; line-height: 1; }
    .app-hero-label { font-size: 0.85rem; color: rgba(255,255,255,0.4); margin-top: 4px; }
    .app-hero-sub { font-size: 0.9rem; color: rgba(255,255,255,0.5); margin-top: 8px; }

    .stat-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 16px; }
    .stat-chip {
      background: rgba(255,255,255,0.06); border-radius: 16px;
      padding: 4px 12px; font-size: 0.8rem; color: rgba(255,255,255,0.5);
    }
    .stat-chip strong { color: rgba(255,255,255,0.8); }

    .tag-row { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
    .app-tag {
      display: inline-block; padding: 3px 10px; border-radius: 12px;
      font-size: 0.75rem; background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.5);
    }

    .bar-wrap { margin-bottom: 16px; }
    .bar-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
    .bar-label { font-size: 0.9rem; color: rgba(255,255,255,0.8); font-weight: 500; }
    .bar-value { font-size: 0.85rem; color: rgba(255,255,255,0.5); }
    .bar-track { height: 10px; background: rgba(255,255,255,0.08); border-radius: 5px; overflow: hidden; margin-bottom: 4px; }
    .bar-fill { height: 100%; border-radius: 5px; transition: width 0.3s; }
    .bar-footer { display: flex; justify-content: space-between; font-size: 0.75rem; color: rgba(255,255,255,0.3); }

    .card-item { padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.85rem; }
    .card-item:last-child { border-bottom: none; }
    .card-text { color: rgba(255,255,255,0.7); margin-bottom: 2px; }
    .card-sub { color: rgba(255,255,255,0.3); font-size: 0.75rem; }
    .card-detail { display: flex; gap: 12px; font-size: 0.8rem; color: rgba(255,255,255,0.4); margin-top: 2px; }

    .empty-state { color: rgba(255,255,255,0.35); font-size: 0.9rem; padding: 1rem 0; font-style: italic; }

    .card-delete {
      background: none; border: none; color: rgba(255,255,255,0.15); font-size: 1.1rem;
      cursor: pointer; padding: 0 4px; line-height: 1; flex-shrink: 0;
    }
    .card-delete:hover { color: #ef4444; }
  `;

  // Nav
  const navHtml = userId
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <a href="/api/v1/user/${esc(userId)}/apps?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">\u2190 Apps</a>
        <div style="display:flex;gap:16px;">
          <a href="/api/v1/root/${esc(rootId)}?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">Tree</a>
          <a href="/api/v1/user/${esc(userId)}/llm?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">LLM</a>
        </div>
      </div>`
    : "";

  // Hero
  const heroHtml = hero
    ? `<div class="app-hero">
        <div class="app-hero-val" style="color:${hero.color || "#fff"}">${esc(String(hero.value))}</div>
        <div class="app-hero-label">${esc(hero.label || "")}</div>
        ${hero.sub ? `<div class="app-hero-sub">${esc(hero.sub)}</div>` : ""}
      </div>`
    : "";

  // Stats
  const statsHtml = stats?.length > 0
    ? `<div class="stat-row">${stats.map(s =>
        `<span class="stat-chip"><strong>${esc(String(s.value))}</strong> ${esc(s.label)}</span>`
      ).join("")}</div>`
    : "";

  // Tags
  const tagsHtml = tags?.length > 0
    ? `<div class="tag-row">${tags.map(t =>
        typeof t === "string"
          ? `<span class="app-tag">${esc(t)}</span>`
          : `<span class="app-tag" style="${t.color ? `border-color:${t.color}30;color:${t.color}` : ""}">${esc(t.label)}${t.count != null ? ` <span style="opacity:0.5">${t.count}</span>` : ""}</span>`
      ).join("")}</div>`
    : "";

  // Bars
  const barsHtml = bars?.length > 0
    ? `<div class="glass-card" style="padding:20px">${bars.map(b => {
        const pct = b.goal > 0 ? Math.min(Math.round((b.current / b.goal) * 100), 100) : 0;
        const remaining = Math.max(0, (b.goal || 0) - (b.current || 0));
        const delBtn = b.deleteUrl
          ? `<button class="card-delete" onclick="deleteEntry(this,'${esc(b.deleteUrl)}')" title="Remove metric" style="margin-left:8px">\u00d7</button>`
          : "";
        return `
          <div class="bar-wrap">
            <div class="bar-header">
              <span class="bar-label">${esc(b.label)}${delBtn}</span>
              <span class="bar-value">${Math.round(b.current)}/${b.goal}${b.unit || "g"} <span style="color:${pctColor(pct)}">(${pct}%)</span></span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${pct}%;background:${b.color || "#667eea"}"></div>
            </div>
            <div class="bar-footer">
              <span>${remaining > 0 ? Math.round(remaining) + (b.unit || "g") + " remaining" : "Goal reached"}</span>
              <span>${b.sub || ""}</span>
            </div>
          </div>`;
      }).join("")}</div>`
    : "";

  // Cards
  const cardsHtml = cards?.length > 0
    ? `<div class="app-grid">${cards.map(card => {
        const itemsHtml = card.items?.length > 0
          ? card.items.slice(0, card.limit || 10).map(item => {
              if (typeof item === "string") return `<div class="card-item"><div class="card-text">${esc(item)}</div></div>`;
              const deleteBtn = item.deleteUrl
                ? `<button class="card-delete" onclick="deleteEntry(this,'${esc(item.deleteUrl)}')" title="Delete">\u00d7</button>`
                : "";
              return `
                <div class="card-item"${item.bg ? ` style="padding:10px 12px;border-radius:8px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.04)"` : ""}>
                  <div style="display:flex;justify-content:space-between;align-items:start">
                    <div style="flex:1">
                      <div class="card-text">${esc(item.text || "")}</div>
                      ${item.sub ? `<div class="card-sub">${esc(item.sub)}</div>` : ""}
                      ${item.detail ? `<div class="card-detail">${item.detail.map(d => `<span>${esc(d)}</span>`).join("")}</div>` : ""}
                    </div>
                    ${deleteBtn}
                  </div>
                </div>`;
            }).join("")
          : `<div class="empty-state">${esc(card.empty || "Nothing here yet.")}</div>`;

        return `
          <div class="glass-card" style="padding:16px">
            <div class="section-title" style="margin-top:0">${esc(card.title)}</div>
            ${itemsHtml}
          </div>`;
      }).join("")}</div>`
    : "";

  // Empty state (if no content at all)
  const emptyHtml = (!hero && !bars?.length && !cards?.length && emptyState)
    ? `<div class="glass-card" style="padding:32px;text-align:center">
        <div style="font-size:1.1rem;color:rgba(255,255,255,0.6);margin-bottom:12px">${esc(emptyState.title || "Not initialized yet")}</div>
        <div style="color:rgba(255,255,255,0.35);font-size:0.9rem;line-height:1.6">${esc(emptyState.message || "Send a message below to get started.")}</div>
      </div>`
    : "";

  const body = `
    <div class="app-layout">
      ${navHtml}
      <h1 style="font-size:1.5rem;color:#fff;margin-bottom:0">${esc(rootName || "App")}</h1>
      <div style="color:rgba(255,255,255,0.35);font-size:0.85rem;margin-top:4px">${date}</div>
      ${subtitle ? `<div style="color:rgba(255,255,255,0.3);font-size:0.8rem;margin-top:2px">${esc(subtitle)}</div>` : ""}

      ${heroHtml}
      ${statsHtml}
      ${tagsHtml}
      ${barsHtml}
      ${afterBars || ""}
      ${emptyHtml}
      ${cardsHtml}

      ${commands?.length > 0 ? commandsRefHtml(commands) : ""}
    </div>
  `;

  const deleteJs = `
    async function deleteEntry(btn, url) {
      const item = btn.closest('.card-item') || btn.closest('.bar-wrap') || btn.parentElement;
      item.style.opacity = '0.3';
      try {
        const sep = url.includes('?') ? '&' : '?';
        const authUrl = ${token ? `url + sep + 'token=${esc(token)}'` : "url"};
        const res = await fetch(authUrl, { method: 'DELETE', credentials: 'include' });
        if (res.ok) {
          item.style.transition = 'all 0.2s';
          item.style.maxHeight = item.offsetHeight + 'px';
          item.style.overflow = 'hidden';
          requestAnimationFrame(() => {
            item.style.maxHeight = '0';
            item.style.padding = '0';
            item.style.margin = '0';
          });
          setTimeout(() => location.reload(), 300);
        } else {
          item.style.opacity = '1';
        }
      } catch { item.style.opacity = '1'; }
    }
  `;

  return page({
    title: `${rootName || "App"} . ${date}`,
    css: css + (extraCss || "") + (!inApp ? chatBarCss() : ""),
    body: body + (!inApp && chatBar ? chatBarHtml({ placeholder: chatBar.placeholder || "Type a message..." }) : ""),
    js: deleteJs + (extraJs || "") + (!inApp && chatBar ? chatBarJs({ endpoint: chatBar.endpoint, token, rootId }) : ""),
  });
}
