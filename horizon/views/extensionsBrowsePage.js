import {
  escapeHtml, pageShell, packageCard,
  sortControls, typeFilterTabs, paginationControls, buildBaseUrl,
} from "./shared.js";

export function renderExtensionsBrowsePage({ extensions, total, page, sort, type, builtFor, query }) {
  const perPage = 25;
  const totalPages = Math.ceil(total / perPage);

  const params = { q: query, sort, type, builtFor };
  const sortBase = buildBaseUrl("/extensions/browse", params, ["sort", "page"]);
  const typeBase = buildBaseUrl("/extensions/browse", params, ["type", "page"]);
  const pageBase = buildBaseUrl("/extensions/browse", params, ["page"]);

  const cards = extensions && extensions.length > 0
    ? extensions.map((pkg, i) => packageCard(pkg, i)).join("")
    : '<div class="empty-state">No packages found.</div>';

  const body = `
    <div style="margin-bottom:24px;animation:fadeInUp 0.5s ease-out both;">
      <h1 style="font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:4px;">Explore</h1>
      <p style="font-size:14px;color:var(--text-secondary);">${total} package${total !== 1 ? "s" : ""} in the directory</p>
    </div>

    <div class="glass-card" style="animation-delay: 0.05s;">
      <form method="get" action="/extensions/browse" class="search-row">
        <input type="text" name="q" placeholder="Search packages..." value="${escapeHtml(query || "")}" />
        ${sort ? `<input type="hidden" name="sort" value="${escapeHtml(sort)}" />` : ""}
        ${type ? `<input type="hidden" name="type" value="${escapeHtml(type)}" />` : ""}
        ${builtFor ? `<input type="hidden" name="builtFor" value="${escapeHtml(builtFor)}" />` : ""}
        <button type="submit">Search</button>
      </form>

      ${typeFilterTabs(type, typeBase)}

      ${sortControls(
        [
          { key: "downloaded", label: "Most Downloaded" },
          { key: "recent", label: "Most Recent" },
        ],
        sort || "downloaded",
        sortBase,
      )}

      ${builtFor ? `
        <div class="controls-row">
          <span class="label">Built for</span>
          <span class="pill-toggle active">${escapeHtml(builtFor)}</span>
          <a href="${buildBaseUrl("/extensions/browse", params, ["builtFor", "page"]).replace(/[&?]$/, "")}" class="pill-toggle">Clear</a>
        </div>
      ` : ""}

      <div class="card-grid">
        ${cards}
      </div>

      ${paginationControls(page, totalPages, pageBase)}
    </div>
  `;

  return pageShell({
    title: "Explore - Canopy Horizon",
    activePage: "explore",
  }, body);
}
