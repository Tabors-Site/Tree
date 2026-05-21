import {
  escapeHtml, pageShell, placeCard,
  sortControls, paginationControls, buildBaseUrl,
} from "./shared.js";

export function renderPlacesPage({ places, total, page, sort, query }) {
  const perPage = 25;
  const totalPages = Math.ceil(total / perPage);

  const params = { q: query, sort };
  const sortBase = buildBaseUrl("/places", params, ["sort", "page"]);
  const pageBase = buildBaseUrl("/places", params, ["page"]);

  const placeCards = places && places.length > 0
    ? places.map((place, i) => placeCard(place, i)).join("")
    : '<div class="empty-state">No places found.</div>';

  const body = `
    <div style="margin-bottom:24px;animation:fadeInUp 0.5s ease-out both;">
      <h1 style="font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:4px;">Places</h1>
      <p style="font-size:14px;color:var(--text-secondary);">${total} registered place${total !== 1 ? "s" : ""} on the network</p>
    </div>

    <div class="glass-card" style="animation-delay: 0.05s;">
      <form method="get" action="/places" class="search-row">
        <input type="text" name="q" placeholder="Search places..." value="${escapeHtml(query || "")}" />
        ${sort ? `<input type="hidden" name="sort" value="${escapeHtml(sort)}" />` : ""}
        <button type="submit">Search</button>
      </form>

      ${sortControls(
        [
          { key: "active", label: "Most Active" },
          { key: "recent", label: "Most Recent" },
        ],
        sort || "active",
        sortBase,
      )}

      <div class="card-grid">
        ${placeCards}
      </div>

      ${paginationControls(page, totalPages, pageBase)}
    </div>
  `;

  return pageShell({
    title: "Places - Canopy Horizon",
    activePage: "places",
  }, body);
}
