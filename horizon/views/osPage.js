import {
  escapeHtml, timeAgo, pageShell, packageCard, ecosystemStats,
  typeBadge, builtForBadge,
} from "./shared.js";

export function renderOsPage({ pkg, bundleDocs, standaloneDocs, allMembers, stats }) {
  const osBundles = pkg.bundles || [];
  const osStandalone = pkg.standalone || [];
  const osConfig = pkg.osConfig || pkg.manifest?.config || null;
  const osOrchestrators = pkg.osOrchestrators || pkg.manifest?.orchestrators || null;

  // Bundle cards
  const bundleCards = bundleDocs && bundleDocs.length > 0
    ? bundleDocs.map((b, i) => packageCard(b, i)).join("")
    : osBundles.length > 0
      ? `<div class="empty-state">Bundles declared but not yet published: ${osBundles.map(b => escapeHtml(b)).join(", ")}</div>`
      : "";

  // Standalone extension cards
  const standaloneCards = standaloneDocs && standaloneDocs.length > 0
    ? standaloneDocs.map((s, i) => packageCard(s, i)).join("")
    : osStandalone.length > 0
      ? `<div class="empty-state">Standalone extensions declared but not yet published: ${osStandalone.map(s => escapeHtml(s)).join(", ")}</div>`
      : "";

  // All ecosystem members (built for this OS)
  const ecosystemCards = allMembers && allMembers.length > 0
    ? allMembers.map((m, i) => packageCard(m, i)).join("")
    : "";

  const body = `
    <div style="margin-bottom:24px;animation:fadeInUp 0.5s ease-out both;">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        ${typeBadge("os")}
        ${builtForBadge(pkg.builtFor)}
      </div>
      <h1 style="font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:800;color:var(--accent);letter-spacing:-0.5px;margin-bottom:4px;">${escapeHtml(pkg.name)}</h1>
      <p style="font-size:15px;color:var(--text-secondary);margin-bottom:12px;">${escapeHtml(pkg.description || "")}</p>
      <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:13px;color:var(--text-muted);">
        <span>v<strong style="color:var(--text-secondary);">${escapeHtml(pkg.version)}</strong></span>
        <span>by <strong style="color:var(--text-secondary);">${escapeHtml(pkg.authorName || pkg.authorDomain || "unknown")}</strong></span>
        <span>published ${timeAgo(pkg.publishedAt)}</span>
      </div>
      <div class="install-cmd">treeos os install ${escapeHtml(pkg.name)}</div>
    </div>

    <!-- Ecosystem Stats -->
    ${stats ? `
    <div class="glass-card" style="animation-delay: 0.05s;">
      <h2>Ecosystem</h2>
      ${ecosystemStats(stats)}
    </div>` : ""}

    <!-- Bundles -->
    ${osBundles.length ? `
    <div class="glass-card" style="animation-delay: 0.1s;">
      <h2>Bundles</h2>
      <div class="card-grid">
        ${bundleCards}
      </div>
    </div>` : ""}

    <!-- Standalone Extensions -->
    ${osStandalone.length ? `
    <div class="glass-card" style="animation-delay: 0.15s;">
      <h2>Standalone Extensions</h2>
      <div class="card-grid">
        ${standaloneCards}
      </div>
    </div>` : ""}

    <!-- Config Defaults -->
    ${osConfig && Object.keys(osConfig).length ? `
    <div class="glass-card" style="animation-delay: 0.2s;">
      <h2>Config Defaults</h2>
      <table class="data-table">
        <thead><tr><th>Key</th><th>Value</th></tr></thead>
        <tbody>
          ${Object.entries(osConfig).map(([k, v]) => `<tr><td><code>${escapeHtml(k)}</code></td><td><code>${escapeHtml(String(v))}</code></td></tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}

    <!-- Orchestrators -->
    ${osOrchestrators && Object.keys(osOrchestrators).length ? `
    <div class="glass-card" style="animation-delay: 0.22s;">
      <h2>Orchestrators</h2>
      <table class="data-table">
        <thead><tr><th>Zone</th><th>Orchestrator</th></tr></thead>
        <tbody>
          ${Object.entries(osOrchestrators).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td><code>${escapeHtml(v)}</code></td></tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}

    <!-- All Ecosystem Extensions -->
    ${ecosystemCards ? `
    <div class="glass-card" style="animation-delay: 0.25s;">
      <h2>All Extensions</h2>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Everything built for ${escapeHtml(pkg.name)}</p>
      <div class="card-grid">
        ${ecosystemCards}
      </div>
      <a href="/extensions/browse?builtFor=${encodeURIComponent(pkg.name)}" class="section-link">Browse all in Explore</a>
    </div>` : ""}
  `;

  return pageShell({
    title: `${pkg.name} - Canopy Horizon`,
    activePage: "explore",
    breadcrumb: pkg.name,
  }, body);
}
