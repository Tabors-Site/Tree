import {
  escapeHtml, timeAgo, pageShell, packageCard, landCard,
  ecosystemStats, typeBadge,
} from "./shared.js";

export function renderDashboard({ lands, trees, extensions, stats }) {
  // Separate extensions by type
  const osItems = (extensions || []).filter(e => e.type === "os");
  const seedExts = (extensions || []).filter(e => (e.type || "extension") === "extension" && (!e.builtFor || e.builtFor === "seed" || e.builtFor === "kernel"));
  const otherExts = (extensions || []).filter(e => !osItems.includes(e) && !seedExts.includes(e));

  // OS section: show all OS distributions as primary cards
  const osCards = osItems.length > 0
    ? osItems.map((pkg, i) => packageCard(pkg, i)).join("")
    : '<div class="empty-state">No operating systems published yet. Be the first.</div>';

  // Recent extensions (kernel-only, max 6)
  const recentSeed = seedExts.slice(0, 6);
  const seedCards = recentSeed.length > 0
    ? recentSeed.map((pkg, i) => packageCard(pkg, i)).join("")
    : '<div class="empty-state">No seed extensions published yet.</div>';

  // Recent lands (max 6)
  const recentLands = (lands || []).slice(0, 6);
  const landCards = recentLands.length > 0
    ? recentLands.map((land, i) => landCard(land, i)).join("")
    : '<div class="empty-state">No lands registered yet.</div>';

  // Count types
  const bundleCount = (extensions || []).filter(e => e.type === "bundle").length;

  const body = `
    <div style="text-align:center;margin-bottom:32px;animation:fadeInUp 0.5s ease-out both;">
      <h1 style="font-size:32px;font-weight:800;letter-spacing:-0.5px;margin-bottom:6px;">Canopy Horizon</h1>
      <p style="font-size:15px;color:var(--text-secondary);">The directory for the TreeOS network</p>
    </div>

    <!-- Stats -->
    <div class="glass-card" style="animation-delay: 0.05s;">
      <div class="stats-row">
        <div class="stat-chip"><span class="num">${stats.landCount}</span> lands</div>
        <div class="stat-chip"><span class="num">${stats.activeLands}</span> active</div>
        <div class="stat-chip"><span class="num">${stats.extensionCount || 0}</span> packages</div>
        <div class="stat-chip"><span class="num">${osItems.length}</span> OS</div>
        ${bundleCount > 0 ? `<div class="stat-chip"><span class="num">${bundleCount}</span> bundles</div>` : ""}
        ${stats.totalDownloads > 0 ? `<div class="stat-chip"><span class="num">${stats.totalDownloads}</span> downloads</div>` : ""}
        ${stats.totalStars > 0 ? `<div class="stat-chip"><span class="num">${stats.totalStars}</span> stars</div>` : ""}
      </div>
    </div>

    <!-- Operating Systems -->
    <div class="glass-card" style="animation-delay: 0.1s;">
      <h2>Operating Systems</h2>
      <div class="card-grid">
        ${osCards}
      </div>
    </div>

    <!-- Kernel Extensions -->
    <div class="glass-card" style="animation-delay: 0.15s;">
      <h2>Seed Extensions</h2>
      <div class="card-grid">
        ${seedCards}
      </div>
      ${seedExts.length > 6 ? '<a href="/extensions/browse?builtFor=seed" class="section-link">Browse all seed extensions</a>' : ""}
    </div>

    <!-- Recent Lands -->
    <div class="glass-card" style="animation-delay: 0.2s;">
      <h2>Recent Lands</h2>
      <div class="card-grid">
        ${landCards}
      </div>
      ${(lands || []).length > 6 ? '<a href="/lands" class="section-link">Browse all lands</a>' : ""}
    </div>
  `;

  return pageShell({
    title: "Canopy Horizon",
    activePage: "home",
  }, body);
}
