import log from "../../seed/log.js";
import { configure, findInvestorNodes, getHoldings, getPortfolioSummary, getWatchlist, isInitialized, scaffold } from "./core.js";
import { handleMessage } from "./handler.js";

export async function init(core) {
  configure({
    Node: core.models.Node,
    Note: core.models.Note,
    metadata: core.metadata,
  });

  // -- Modes --
  const logMode = (await import("./modes/log.js")).default;
  const coachMode = (await import("./modes/coach.js")).default;
  const reviewMode = (await import("./modes/review.js")).default;

  core.modes.registerMode(logMode.name, logMode, "investor");
  core.modes.registerMode(coachMode.name, coachMode, "investor");
  core.modes.registerMode(reviewMode.name, reviewMode, "investor");

  // -- enrichContext: inject portfolio awareness into ALL tree nodes --
  const _investorCache = new Map(); // treeRootId -> { summary, ts }
  const INVESTOR_CACHE_TTL = 60000;

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (!node?._id) return;

    // At investor holding nodes: full detail
    const invMeta = meta?.investor;
    if (invMeta?.role === "portfolio") {
      return;
    }

    // For all other tree nodes: compact portfolio summary
    const treeRootId = node.rootOwner ? String(node.rootOwner) : null;
    if (!treeRootId) return;

    const cached = _investorCache.get(treeRootId);
    if (cached && Date.now() - cached.ts < INVESTOR_CACHE_TTL) {
      if (cached.summary) context.investorSummary = cached.summary;
      return;
    }

    try {
      const { getExtension } = await import("../loader.js");
      const life = getExtension("life");
      if (!life?.exports?.getDomainNodes) return;

      const domains = await life.exports.getDomainNodes(treeRootId);
      if (!domains.investor?.id) {
        _investorCache.set(treeRootId, { summary: null, ts: Date.now() });
        return;
      }

      const portfolio = await getPortfolioSummary(domains.investor.id);
      const topHoldings = portfolio.allocation
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
        .map(a => ({ ticker: a.ticker, value: a.value, percent: a.percent }));

      const compact = {
        totalValue: portfolio.totalValue,
        totalGain: portfolio.totalGain,
        totalGainPercent: portfolio.totalGainPercent,
        topHoldings,
      };

      _investorCache.set(treeRootId, { summary: compact, ts: Date.now() });
      if (portfolio.totalValue > 0) {
        context.investorSummary = compact;
      }
    } catch {}
  }, "investor");

  log.info("Investor", "Loaded. The tree tracks investments.");

  // ── Register apps-grid slot ──
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("apps-grid", "investor", ({ userId, rootMap, tokenParam, tokenField, esc: e }) => {
      const entries = rootMap.get("Investor") || [];
      const existing = entries.map(entry =>
        `<a class="app-active" href="/api/v1/root/${entry.id}/investor?html${tokenParam}" style="margin-right:8px;margin-bottom:6px;">${e(entry.name)}</a>`
      ).join("");
      return `<div class="app-card">
        <div class="app-header"><span class="app-emoji">📈</span><span class="app-name">Investor</span></div>
        <div class="app-desc">Track holdings, cost basis, gains and losses. Portfolio allocation. The AI helps you think through decisions without predicting.</div>
        ${existing ? `<div style="display:flex;flex-wrap:wrap;margin-bottom:10px;">${existing}</div>` : ""}
        <form class="app-form" method="POST" action="/api/v1/user/${userId}/apps/create">
          ${tokenField}<input type="hidden" name="app" value="investor" />
          <input class="app-input" name="message" placeholder="What did you buy or sell?" required />
          <button class="app-start" type="submit">${entries.length > 0 ? "New" : "Start"} Investor</button>
        </form>
      </div>`;
    }, { priority: 65 });
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
      findInvestorNodes,
      getHoldings,
      getPortfolioSummary,
      handleMessage,
    },
  };
}
