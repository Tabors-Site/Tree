import log from "../../seed/log.js";
import {
  configure,
  findResearchNodes,
  getSectors,
  getRecentFindings,
  getWatchlist,
  isInitialized,
  scaffold,
} from "./core.js";
import { handleMessage } from "./handler.js";

export async function init(core) {
  configure({
    Node: core.models.Node,
    Note: core.models.Note,
    metadata: core.metadata,
  });

  // -- Modes --
  const tellMode = (await import("./modes/tell.js")).default;
  const coachMode = (await import("./modes/coach.js")).default;
  const reviewMode = (await import("./modes/review.js")).default;

  core.modes.registerMode(tellMode.name, tellMode, "market-researcher");
  core.modes.registerMode(coachMode.name, coachMode, "market-researcher");
  core.modes.registerMode(reviewMode.name, reviewMode, "market-researcher");

  // -- enrichContext: inject research awareness into investor and finance nodes --
  const _researchCache = new Map(); // treeRootId -> { summary, ts }
  const RESEARCH_CACHE_TTL = 60000;

  core.hooks.register("enrichContext", async ({ context, node }) => {
    if (!node?._id) return;

    const treeRootId = node.rootOwner ? String(node.rootOwner) : null;
    if (!treeRootId) return;

    const cached = _researchCache.get(treeRootId);
    if (cached && Date.now() - cached.ts < RESEARCH_CACHE_TTL) {
      if (cached.summary) context.marketResearch = cached.summary;
      return;
    }

    try {
      const { getExtension } = await import("../loader.js");
      const life = getExtension("life");
      if (!life?.exports?.getDomainNodes) return;

      const domains = await life.exports.getDomainNodes(treeRootId);
      const researchDomain = domains["market-researcher"];
      if (!researchDomain?.id) {
        _researchCache.set(treeRootId, { summary: null, ts: Date.now() });
        return;
      }

      const findings = await getRecentFindings(researchDomain.id, 5);
      const sectors = await getSectors(researchDomain.id);

      if (findings.length === 0 && sectors.length === 0) {
        _researchCache.set(treeRootId, { summary: null, ts: Date.now() });
        return;
      }

      const compact = {
        sectors: sectors.map(s => s.name),
        recentFindings: findings.slice(0, 5).map(f => f.content),
      };

      _researchCache.set(treeRootId, { summary: compact, ts: Date.now() });
      context.marketResearch = compact;
    } catch {}
  }, "market-researcher");

  log.info("MarketResearcher", "Loaded. The tree researches markets.");

  // ── Register apps-grid slot ──
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("apps-grid", "market-researcher", ({ userId, rootMap, tokenParam, tokenField, esc: e }) => {
      const entries = rootMap.get("Market Researcher") || [];
      const existing = entries.map(entry =>
        `<a class="app-active" href="/api/v1/root/${entry.id}/market-researcher?html${tokenParam}" style="margin-right:8px;margin-bottom:6px;">${e(entry.name)}</a>`
      ).join("");
      return `<div class="app-card">
        <div class="app-header"><span class="app-emoji">🔬</span><span class="app-name">Market Research</span></div>
        <div class="app-desc">Research agent. Uses browser to visit financial sites, pull data, and surface opportunities. Feeds findings to your investor and finance branches.</div>
        ${existing ? `<div style="display:flex;flex-wrap:wrap;margin-bottom:10px;">${existing}</div>` : ""}
        <form class="app-form" method="POST" action="/api/v1/user/${userId}/apps/create">
          ${tokenField}<input type="hidden" name="app" value="market-researcher" />
          <input class="app-input" name="message" placeholder="Research current crypto market" required />
          <button class="app-start" type="submit">${entries.length > 0 ? "New" : "Start"} Research</button>
        </form>
      </div>`;
    }, { priority: 70 });
  } catch {}

  // ── HTML dashboard route ──
  let router = null;
  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt) {
      router = (await import("./htmlRoutes.js")).default;
    }
  } catch {}

  return {
    router,
    exports: {
      scaffold,
      isInitialized,
      findResearchNodes,
      getSectors,
      getRecentFindings,
      getWatchlist,
      handleMessage,
    },
  };
}
