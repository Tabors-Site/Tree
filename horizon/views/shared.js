// ---------------------------------------------------------------------------
// Horizon shared view infrastructure
// Extracted from dashboard.js and extensionPage.js, plus new components
// for the ecosystem-first directory design.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max).replace(/\s+\S*$/, "") + "...";
}

export function timeAgo(date) {
  if (!date) return "never";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  return Math.floor(seconds / 86400) + "d ago";
}

export function statusColor(status) {
  switch (status) {
    case "active":      return "#7dd385";
    case "degraded":    return "#d4a574";
    case "unreachable": return "#c97e6a";
    case "dead":        return "#5d6371";
    default:            return "#9ba1ad";
  }
}

/**
 * Badge color for package type (extension, bundle, os).
 */
export function typeColor(type) {
  switch (type) {
    case "os":     return { bg: "rgba(122, 146, 184, 0.12)", text: "#a8c0e0" };
    case "bundle": return { bg: "rgba(212, 165, 116, 0.12)", text: "#d4a574" };
    default:       return { bg: "rgba(125, 211, 133, 0.12)", text: "#9ce0a2" };
  }
}

// ---------------------------------------------------------------------------
// Base CSS (shared across all pages)
// ---------------------------------------------------------------------------

export function baseStyles() {
  return `
    :root {
      /* Nightfall theme - matches TreeOS */
      --bg:           #0d1117;
      --bg-elevated:  #161b24;
      --bg-hover:     #1c222e;
      --bg-active:    #222837;
      --border:       #232a38;
      --border-strong:#2f3849;

      --text-primary:   #e6e8eb;
      --text-secondary: #c4c8d0;
      --text-muted:     #9ba1ad;
      --text-dim:       #5d6371;

      --accent:        #7dd385;
      --accent-strong: #9ce0a2;
      --accent-bg:     rgba(125, 211, 133, 0.12);
      --accent-border: rgba(125, 211, 133, 0.4);
      --accent-glow:   rgba(125, 211, 133, 0.45);

      --error:   #c97e6a;
      --warning: #d4a574;

      /* Legacy aliases */
      --glass-water-rgb:   22, 27, 36;
      --glass-alpha:       1;
      --glass-alpha-hover: 1;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    html { height: 100%; background: var(--bg); }

    body {
      font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      background: var(--bg);
      min-height: 100%;
      padding: 24px 20px;
      padding-top: calc(24px + env(safe-area-inset-top, 0px));
      padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
      color: var(--text-primary);
      overflow-x: hidden;
      font-size: 14px;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .container {
      max-width: 960px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    ::selection { background: var(--accent-bg); color: var(--text-primary); }

    /* Card */
    .glass-card {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px 28px;
      margin-bottom: 16px;
      animation: fadeInUp 0.35s ease-out both;
    }
    .glass-card h2 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 14px;
      letter-spacing: -0.2px;
      color: var(--text-primary);
    }

    /* Separator dot */
    .separator {
      display: inline-block;
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--text-dim);
      margin: 0 8px;
      vertical-align: middle;
    }

    /* Navigation */
    .nav-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 20px;
      animation: fadeInUp 0.3s ease-out both;
      flex-wrap: wrap;
    }
    .nav-link {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 8px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
    }
    .nav-link:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: var(--border-strong);
    }
    .nav-link.active {
      background: var(--accent-bg);
      color: var(--accent-strong);
      border-color: var(--accent-border);
    }

    /* Stats */
    .stats-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: center;
      margin-bottom: 8px;
    }
    .stat-chip {
      padding: 8px 16px;
      border-radius: 8px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
    }
    .stat-chip .num {
      color: var(--accent-strong);
      margin-right: 4px;
      font-size: 16px;
      font-weight: 600;
    }

    /* Search */
    .search-row {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
    }
    .search-row input {
      flex: 1;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 14px;
      outline: none;
      transition: border-color 150ms ease, box-shadow 150ms ease;
    }
    .search-row input::placeholder { color: var(--text-dim); }
    .search-row input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(125, 211, 133, 0.15);
    }
    .search-row button, .btn-pill {
      padding: 10px 20px;
      border-radius: 8px;
      background: var(--accent);
      color: var(--bg);
      border: 1px solid var(--accent);
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease;
      text-decoration: none;
      display: inline-block;
    }
    .search-row button:hover, .btn-pill:hover {
      background: var(--accent-strong);
      border-color: var(--accent-strong);
    }

    /* Sort / filter controls */
    .controls-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      align-items: center;
    }
    .controls-row .label {
      font-size: 11px;
      color: var(--text-dim);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-right: 4px;
    }
    .pill-toggle {
      display: inline-block;
      padding: 5px 12px;
      border-radius: 980px;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      border: 1px solid var(--border);
      background: var(--bg-elevated);
      color: var(--text-muted);
      transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
      cursor: pointer;
    }
    .pill-toggle:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: var(--border-strong);
    }
    .pill-toggle.active {
      background: var(--accent-bg);
      color: var(--accent-strong);
      border-color: var(--accent-border);
    }

    /* Pagination */
    .pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      margin-top: 24px;
      font-size: 13px;
    }
    .pagination a {
      padding: 7px 16px;
      border-radius: 8px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      color: var(--text-muted);
      text-decoration: none;
      font-weight: 600;
      font-size: 12px;
      transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
    }
    .pagination a:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: var(--border-strong);
    }
    .pagination .page-info {
      color: var(--text-dim);
      font-weight: 600;
    }

    /* Card grids */
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }

    /* Land cards */
    .land-card-link {
      text-decoration: none;
      color: inherit;
      display: block;
    }
    .land-card {
      padding: 16px 18px;
      border-radius: 10px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-left: 3px solid var(--border);
      animation: fadeInUp 0.3s ease-out both;
      transition: background 150ms ease, border-color 150ms ease;
    }
    .land-card:hover {
      background: var(--bg-hover);
      border-color: var(--border-strong);
      border-left-color: var(--accent-border);
    }
    .land-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .land-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .land-status {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--text-muted);
    }
    .status-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
    }
    .land-domain { margin-bottom: 6px; }
    .land-domain code {
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      padding: 2px 7px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 5px;
      color: var(--text-secondary);
    }
    .land-meta { font-size: 11px; color: var(--text-dim); }
    .land-site-link {
      color: var(--accent-strong);
      text-decoration: none;
      font-weight: 600;
    }
    .land-site-link:hover { text-decoration: underline; }

    /* Package cards (extension, bundle, os) */
    .pkg-card {
      display: block;
      padding: 16px 18px;
      border-radius: 10px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-left: 3px solid var(--border);
      animation: fadeInUp 0.3s ease-out both;
      transition: background 150ms ease, border-color 150ms ease;
      text-decoration: none;
      color: inherit;
      cursor: pointer;
    }
    .pkg-card:hover {
      background: var(--bg-hover);
      border-color: var(--border-strong);
      border-left-color: var(--accent-border);
    }
    .pkg-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .pkg-name {
      font-family: "JetBrains Mono", monospace;
      font-size: 14px;
      font-weight: 600;
      color: var(--accent-strong);
    }
    .pkg-version {
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      color: var(--text-dim);
    }
    .pkg-desc {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 8px;
      line-height: 1.5;
    }
    .pkg-meta {
      font-size: 11px;
      color: var(--text-dim);
      margin-bottom: 6px;
    }
    .pkg-meta strong { color: var(--text-muted); }
    .pkg-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 6px;
    }
    .pkg-badges {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-bottom: 8px;
    }

    /* Type badge */
    .type-badge {
      display: inline-block;
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    /* builtFor badge */
    .built-for-badge {
      display: inline-block;
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 5px;
      font-weight: 600;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text-muted);
    }

    /* Tag */
    .tag {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 5px;
      background: var(--accent-bg);
      color: var(--accent-strong);
      border: 1px solid var(--accent-border);
      font-weight: 600;
    }

    /* Section link */
    .section-link {
      display: inline-block;
      font-size: 13px;
      color: var(--accent-strong);
      text-decoration: none;
      font-weight: 600;
      margin-top: 12px;
    }
    .section-link:hover { text-decoration: underline; }

    /* Table */
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th, .data-table td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    .data-table th {
      font-weight: 600;
      color: var(--text-muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table code {
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      padding: 2px 6px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text-secondary);
    }
    .data-table a {
      color: var(--accent-strong);
      text-decoration: none;
      font-weight: 600;
    }
    .data-table a:hover { text-decoration: underline; }

    /* Ecosystem stats bar */
    .eco-stats {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--text-dim);
      margin-bottom: 16px;
    }
    .eco-stats strong { color: var(--text-secondary); }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-dim);
      font-size: 13px;
      font-style: italic;
      grid-column: 1 / -1;
    }

    /* Footer */
    .footer {
      text-align: center;
      margin-top: 32px;
      padding: 16px;
      font-size: 12px;
      color: var(--text-dim);
      animation: fadeInUp 0.4s ease-out both;
      animation-delay: 0.2s;
    }
    .footer a {
      color: var(--text-muted);
      text-decoration: none;
    }
    .footer a:hover { color: var(--text-primary); }
    .footer-cta {
      display: inline-block;
      padding: 10px 22px;
      border-radius: 8px;
      background: var(--accent);
      color: var(--bg) !important;
      font-weight: 600;
      font-size: 13px;
      border: 1px solid var(--accent);
      transition: background 150ms ease, border-color 150ms ease;
    }
    .footer-cta:hover {
      background: var(--accent-strong);
      border-color: var(--accent-strong);
    }

    /* Install command */
    .install-cmd {
      margin-top: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--bg);
      border: 1px solid var(--border);
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      color: var(--text-secondary);
      display: inline-block;
    }

    @media (max-width: 640px) {
      body { padding: 16px 14px; }
      .glass-card { padding: 20px 22px; }
      .card-grid { grid-template-columns: 1fr; }
      .search-row { flex-direction: column; }
      .controls-row { flex-direction: column; align-items: flex-start; }
      .nav-bar { gap: 4px; }
      .nav-link { padding: 7px 14px; font-size: 12px; }
    }
  `;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * Navigation bar. activePage is one of: "home", "explore", "lands"
 * breadcrumb is optional extra text (e.g. OS name or bundle name)
 */
export function navBar(activePage, breadcrumb) {
  const links = [
    { key: "home", label: "Horizon", href: "/" },
    { key: "explore", label: "Explore", href: "/extensions/browse" },
    { key: "lands", label: "Lands", href: "/lands" },
    { key: "about", label: "About", href: "/about" },
  ];

  const html = links.map(l =>
    `<a href="${l.href}" class="nav-link${l.key === activePage ? " active" : ""}">${l.label}</a>`
  ).join("");

  const crumb = breadcrumb
    ? `<span class="separator"></span><span style="font-size:13px;font-weight:600;color:var(--text-secondary);">${escapeHtml(breadcrumb)}</span>`
    : "";

  return `<nav class="nav-bar">${html}${crumb}</nav>`;
}

/**
 * Pagination controls.
 * baseUrl should include existing query params except page, ending with & or ? as needed.
 */
export function paginationControls(page, totalPages, baseUrl) {
  if (totalPages <= 1) return "";
  const prev = page > 1
    ? `<a href="${baseUrl}page=${page - 1}">Previous</a>`
    : "";
  const next = page < totalPages
    ? `<a href="${baseUrl}page=${page + 1}">Next</a>`
    : "";
  return `
    <div class="pagination">
      ${prev}
      <span class="page-info">Page ${page} of ${totalPages}</span>
      ${next}
    </div>
  `;
}

/**
 * Sort toggle pills.
 * options: [{ key, label }]
 * currentSort: the active key
 * baseUrl: URL with all params except sort, ending with & or ?
 */
export function sortControls(options, currentSort, baseUrl) {
  const pills = options.map(o =>
    `<a href="${baseUrl}sort=${o.key}" class="pill-toggle${o.key === currentSort ? " active" : ""}">${escapeHtml(o.label)}</a>`
  ).join("");
  return `<div class="controls-row"><span class="label">Sort</span>${pills}</div>`;
}

/**
 * Type filter tabs for the browse page.
 * currentType: null/undefined for all, or "extension"/"bundle"/"os"
 * baseUrl: URL with all params except type, ending with & or ?
 */
export function typeFilterTabs(currentType, baseUrl) {
  const types = [
    { key: "", label: "All" },
    { key: "extension", label: "Extensions" },
    { key: "bundle", label: "Bundles" },
    { key: "os", label: "OS" },
  ];
  const pills = types.map(t => {
    const active = (t.key === "" && !currentType) || t.key === currentType;
    const href = t.key ? `${baseUrl}type=${t.key}` : baseUrl.replace(/[&?]$/, "");
    return `<a href="${href}" class="pill-toggle${active ? " active" : ""}">${t.label}</a>`;
  }).join("");
  return `<div class="controls-row"><span class="label">Type</span>${pills}</div>`;
}

/**
 * Type badge HTML for a package type.
 */
export function typeBadge(type) {
  const colors = typeColor(type || "extension");
  const label = (type || "extension").toUpperCase();
  return `<span class="type-badge" style="background:${colors.bg};color:${colors.text};">${label}</span>`;
}

/**
 * builtFor badge HTML.
 */
export function builtForBadge(builtFor) {
  if (!builtFor || builtFor === "seed" || builtFor === "kernel") {
    return `<span class="built-for-badge">seed</span>`;
  }
  return `<span class="built-for-badge">for ${escapeHtml(builtFor)}</span>`;
}

/**
 * Render a package card (extension, bundle, or os).
 * pkg: { name, version, type, builtFor, description, authorName, authorDomain, downloads, tags, npmDependencies, dependentCount }
 * linkPrefix: URL prefix for the card link (defaults to extension detail page)
 */
export function packageCard(pkg, idx) {
  const delay = idx != null ? `style="animation-delay: ${0.1 + (idx || 0) * 0.04}s;"` : "";
  const type = pkg.type || "extension";
  const tagHtml = (pkg.tags || []).slice(0, 4).map(t =>
    `<span class="tag">${escapeHtml(t)}</span>`
  ).join("");

  let href;
  if (type === "os") {
    href = `/os/${encodeURIComponent(pkg.name)}`;
  } else if (type === "bundle") {
    href = `/bundle/${encodeURIComponent(pkg.name)}`;
  } else {
    href = `/extensions/${encodeURIComponent(pkg.name)}/page`;
  }

  const npmCount = (pkg.npmDependencies || []).length;

  // Type-driven left border accent (ext = sage, bundle = warning, os = blue)
  const borderColors = {
    os:        "rgba(122, 146, 184, 0.45)",
    bundle:    "rgba(212, 165, 116, 0.45)",
    extension: "rgba(125, 211, 133, 0.45)",
  };
  const leftBorder = borderColors[type] || borderColors.extension;

  return `
    <a href="${href}" class="pkg-card" ${delay} style="border-left-color:${leftBorder};">
      <div class="pkg-badges">
        ${typeBadge(type)}
        ${builtForBadge(pkg.builtFor)}
      </div>
      <div class="pkg-card-header">
        <div class="pkg-name">${escapeHtml(pkg.name)}</div>
        <div class="pkg-version">v${escapeHtml(pkg.version)}</div>
      </div>
      <div class="pkg-desc">${escapeHtml(truncate(pkg.description || "No description", 300))}</div>
      <div class="pkg-meta">
        <span><strong>${escapeHtml(pkg.authorName || pkg.authorDomain || "unknown")}</strong></span>
        <span class="separator"></span>
        <span>${pkg.downloads || 0} dl</span>
        ${npmCount > 0 ? `<span class="separator"></span><span>${npmCount} npm deps</span>` : ""}
        ${pkg.dependentCount ? `<span class="separator"></span><span>${pkg.dependentCount} dependents</span>` : ""}
        ${pkg.repoUrl ? `<span class="separator"></span><span style="color:var(--accent-strong);">source</span>` : ""}
      </div>
      ${tagHtml ? `<div class="pkg-tags">${tagHtml}</div>` : ""}
    </a>
  `;
}

/**
 * Render a land card.
 */
export function landCard(land, idx) {
  const color = statusColor(land.status);
  const delay = idx != null ? `animation-delay: ${0.05 + (idx || 0) * 0.04}s;` : "";
  return `
    <a href="/lands/${encodeURIComponent(land.domain)}" class="land-card-link" style="${delay}">
      <div class="land-card">
        <div class="land-card-header">
          <div class="land-name">${escapeHtml(land.name || "Unnamed Land")}</div>
          <div class="land-status">
            <span class="status-dot" style="background: ${color};"></span>
            ${escapeHtml(land.status || "unknown")}
          </div>
        </div>
        <div class="land-domain"><code>${escapeHtml(land.domain)}</code></div>
        <div class="land-meta">
          Protocol v${land.protocolVersion || "?"}
          <span class="separator"></span>
          Last seen ${timeAgo(land.lastSeenAt)}
          ${land.siteUrl ? `<span class="separator"></span><span class="land-site-link">Visit Site</span>` : ""}
        </div>
      </div>
    </a>
  `;
}

/**
 * Ecosystem stats bar for OS and bundle detail pages.
 * stats: { totalDownloads, contributorCount, extensionCount, lastUpdated }
 */
export function ecosystemStats(stats) {
  return `
    <div class="eco-stats">
      <span><strong>${(stats.totalDownloads || 0).toLocaleString()}</strong> total installs</span>
      <span><strong>${stats.contributorCount || 0}</strong> contributors</span>
      <span><strong>${stats.extensionCount || 0}</strong> extensions</span>
      <span>last updated <strong>${timeAgo(stats.lastUpdated)}</strong></span>
    </div>
  `;
}

/**
 * Full page shell. Wraps content in the HTML document structure.
 * opts: { title, activePage, breadcrumb, extraStyles, extraScripts }
 */
export function pageShell(opts, bodyContent) {
  const title = opts.title || "Canopy Horizon";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0d1117">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    ${baseStyles()}
    ${opts.extraStyles || ""}
  </style>
</head>
<body>
  <div class="container">
    ${navBar(opts.activePage || "home", opts.breadcrumb)}
    ${bodyContent}
    <div class="footer">
      <a href="https://treeos.ai/land" class="footer-cta">What is a Land? Start your own.</a>
      <br><br>
      Canopy Horizon
      <span class="separator"></span>
      <a href="/horizon/health">API Health</a>
    </div>
  </div>
  ${opts.extraScripts ? `<script>${opts.extraScripts}</script>` : ""}
</body>
</html>`;
}

/**
 * Build a base URL for pagination/sort/filter links.
 * Preserves existing query params except the ones being controlled.
 * params: object of current params (e.g. { q: "search", sort: "recent", type: "bundle" })
 * exclude: array of param names to exclude from the base URL
 * Returns a string like "?q=search&sort=recent&"
 */
export function buildBaseUrl(path, params, exclude) {
  const parts = [];
  for (const [key, val] of Object.entries(params)) {
    if (val && !exclude.includes(key)) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }
  }
  const qs = parts.length > 0 ? parts.join("&") + "&" : "";
  return `${path}?${qs}`;
}
