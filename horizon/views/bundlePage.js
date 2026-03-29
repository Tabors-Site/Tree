import {
  escapeHtml, timeAgo, pageShell, packageCard, ecosystemStats,
  typeBadge, builtForBadge,
} from "./shared.js";

export function renderBundlePage({ pkg, memberDocs, dependentOsDocs, stats }) {
  const includes = pkg.includes || [];

  const memberCards = memberDocs && memberDocs.length > 0
    ? memberDocs.map((m, i) => packageCard(m, i)).join("")
    : includes.length > 0
      ? `<div class="empty-state">Members declared but not yet published: ${includes.map(inc => escapeHtml(inc)).join(", ")}</div>`
      : '<div class="empty-state">No members declared.</div>';

  const osCards = dependentOsDocs && dependentOsDocs.length > 0
    ? dependentOsDocs.map((os, i) => packageCard(os, i)).join("")
    : "";

  // Build member tree
  const memberDocMap = new Map((memberDocs || []).map(m => [m.name, m]));
  const memberTree = includes.map(ref => {
    const cleanName = ref.split("@")[0];
    const doc = memberDocMap.get(cleanName);
    const published = !!doc;
    const realVersion = doc ? doc.version : null;
    const dot = published
      ? '<span style="color:#10b981;margin-right:6px;">&#9679;</span>'
      : '<span style="color:var(--text-muted);margin-right:6px;">&#9675;</span>';
    const link = published
      ? `<a href="/extensions/${encodeURIComponent(cleanName)}/page" style="color:var(--text-primary);text-decoration:none;font-weight:600;">${escapeHtml(cleanName)}</a>`
      : `<span style="color:var(--text-muted);">${escapeHtml(cleanName)}</span>`;
    const ver = realVersion
      ? `<span style="color:var(--text-muted);font-size:11px;margin-left:6px;">v${escapeHtml(realVersion)}</span>`
      : "";
    return `<div style="padding:3px 0;font-size:13px;font-family:'JetBrains Mono',monospace;">${dot}${link}${ver}</div>`;
  }).join("");

  const body = `
    <div style="margin-bottom:24px;animation:fadeInUp 0.5s ease-out both;">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        ${typeBadge("bundle")}
        ${builtForBadge(pkg.builtFor)}
      </div>
      <h1 style="font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:800;color:var(--accent);letter-spacing:-0.5px;margin-bottom:4px;">${escapeHtml(pkg.name)}</h1>
      <p style="font-size:15px;color:var(--text-secondary);margin-bottom:12px;">${escapeHtml(pkg.description || "")}</p>
      <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:13px;color:var(--text-muted);">
        <span>v<strong style="color:var(--text-secondary);">${escapeHtml(pkg.version)}</strong></span>
        <span>by <strong style="color:var(--text-secondary);">${escapeHtml(pkg.authorName || pkg.authorDomain || "unknown")}</strong></span>
        <span><strong style="color:var(--text-secondary);">${includes.length}</strong> extensions</span>
        <span>published ${timeAgo(pkg.publishedAt)}</span>
      </div>
      <div class="install-cmd">treeos bundle install ${escapeHtml(pkg.name)}</div>
    </div>

    <!-- Stats -->
    ${stats ? `
    <div class="glass-card" style="animation-delay: 0.05s;">
      <h2>Bundle Stats</h2>
      ${ecosystemStats(stats)}
    </div>` : ""}

    <!-- Dependency Tree -->
    <div class="glass-card" style="animation-delay: 0.08s;">
      <h2>Member Extensions</h2>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">
        <span style="color:#10b981;">&#9679;</span> published
        <span style="margin-left:12px;color:var(--text-muted);">&#9675;</span> not yet published
      </p>
      <div style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;margin-bottom:8px;color:var(--accent);">
        ${escapeHtml(pkg.name)}
      </div>
      <div style="margin-left:20px;border-left:1px solid rgba(255,255,255,0.08);padding-left:12px;">
        ${memberTree}
      </div>
    </div>

    <!-- Member Cards -->
    <div class="glass-card" style="animation-delay: 0.1s;">
      <h2>Included Extensions</h2>
      <div class="card-grid">
        ${memberCards}
      </div>
    </div>

    <!-- OS Distributions using this bundle -->
    ${osCards ? `
    <div class="glass-card" style="animation-delay: 0.15s;">
      <h2>Used By</h2>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">OS distributions that include this bundle</p>
      <div class="card-grid">
        ${osCards}
      </div>
    </div>` : ""}
  `;

  return pageShell({
    title: `${pkg.name} - Canopy Horizon`,
    activePage: "explore",
    breadcrumb: pkg.name,
  }, body);
}
