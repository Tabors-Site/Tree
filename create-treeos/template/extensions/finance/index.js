import log from "../../seed/log.js";
import { configure, findFinanceNodes, getAccounts, getCategories, getMonthSummary, isInitialized, scaffold } from "./core.js";
import { handleMessage } from "./handler.js";

export async function init(core) {
  configure({
    Node: core.models.Node,
    Note: core.models.Note,
    metadata: core.metadata,
  });

  // ── Modes ──
  const logMode = (await import("./modes/log.js")).default;
  const coachMode = (await import("./modes/coach.js")).default;
  const reviewMode = (await import("./modes/review.js")).default;

  core.modes.registerMode(logMode.name, logMode, "finance");
  core.modes.registerMode(coachMode.name, coachMode, "finance");
  core.modes.registerMode(reviewMode.name, reviewMode, "finance");

  // ── enrichContext: inject financial awareness into ALL tree nodes ──
  const _financeCache = new Map(); // treeRootId -> { summary, ts }
  const FINANCE_CACHE_TTL = 60000;

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (!node?._id) return;

    // At finance nodes: full detail
    const finMeta = meta?.finance;
    if (finMeta?.role === "account") {
      const values = meta?.values || {};
      context.financeAccount = { name: node.name, type: finMeta.accountType, balance: values.balance || 0 };
      return;
    }
    if (finMeta?.role === "category") {
      const values = meta?.values || {};
      const goals = meta?.goals || {};
      context.financeCategory = { name: node.name, spent: values.monthSpent || 0, budget: goals.monthBudget || 0 };
      return;
    }

    // For all other tree nodes: compact spending summary
    const treeRootId = node.rootOwner ? String(node.rootOwner) : null;
    if (!treeRootId) return;

    const cached = _financeCache.get(treeRootId);
    if (cached && Date.now() - cached.ts < FINANCE_CACHE_TTL) {
      if (cached.summary) context.financeSummary = cached.summary;
      return;
    }

    try {
      const { getExtension } = await import("../loader.js");
      const life = getExtension("life");
      if (!life?.exports?.getDomainNodes) return;

      const domains = await life.exports.getDomainNodes(treeRootId);
      if (!domains.finance?.id) {
        _financeCache.set(treeRootId, { summary: null, ts: Date.now() });
        return;
      }

      const summary = await getMonthSummary(domains.finance.id);
      const compact = {
        totalBalance: summary.totalBalance,
        spentThisMonth: summary.totalSpent,
        budgetRemaining: summary.budgetRemaining,
      };

      _financeCache.set(treeRootId, { summary: compact, ts: Date.now() });
      if (summary.totalBalance > 0 || summary.totalSpent > 0) {
        context.financeSummary = compact;
      }
    } catch {}
  }, "finance");

  log.info("Finance", "Loaded. The tree tracks money.");

  // ── Register apps-grid slot ──
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("apps-grid", "finance", ({ userId, rootMap, tokenParam, tokenField, esc: e }) => {
      const entries = rootMap.get("Finance") || [];
      const existing = entries.map(entry =>
        `<a class="app-active" href="/api/v1/root/${entry.id}/finance?html${tokenParam}" style="margin-right:8px;margin-bottom:6px;">${e(entry.name)}</a>`
      ).join("");
      return `<div class="app-card">
        <div class="app-header"><span class="app-emoji">💰</span><span class="app-name">Finance</span></div>
        <div class="app-desc">Track accounts, log spending in natural language. Budget goals per category. The AI reflects on patterns and helps you think about money.</div>
        ${entries.length > 0
          ? `<div style="display:flex;flex-wrap:wrap;">${existing}</div>`
          : `<form class="app-form" method="POST" action="/api/v1/user/${userId}/apps/create">
              ${tokenField}<input type="hidden" name="app" value="finance" />
              <input class="app-input" name="message" placeholder="How much did you spend today?" required />
              <button class="app-start" type="submit">Start Finance</button>
            </form>`}
      </div>`;
    }, { priority: 60 });
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
      findFinanceNodes,
      getAccounts,
      getCategories,
      getMonthSummary,
      handleMessage,
    },
  };
}
