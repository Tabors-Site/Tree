import log from "../../seed/log.js";
import { configure, findRelNodes, getPeople, isInitialized, scaffold } from "./core.js";
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

  core.modes.registerMode(logMode.name, logMode, "relationships");
  core.modes.registerMode(coachMode.name, coachMode, "relationships");
  core.modes.registerMode(reviewMode.name, reviewMode, "relationships");

  // ── enrichContext: inject people awareness into ALL tree nodes ──
  // Fires everywhere in the tree, not just relationships nodes.
  // The AI at any position knows about tracked people.
  const _peopleCache = new Map(); // treeRootId -> { people, ts }
  const PEOPLE_CACHE_TTL = 60000; // 60s

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (!node?._id) return;

    // At a relationships person node: show full interaction history
    const relMeta = meta?.relationships;
    if (relMeta?.role === "person") {
      const { getNotes } = await import("../../seed/tree/notes.js");
      const result = await getNotes({ nodeId: String(node._id), limit: 10 });
      if (result?.notes?.length > 0) {
        context.personHistory = result.notes.map(n => n.content);
      }
      return;
    }

    // For all other nodes: inject compact people summary from the tree
    // Find the tree root (rootOwner field on any node)
    const treeRootId = node.rootOwner ? String(node.rootOwner) : null;
    if (!treeRootId) return;

    // Check cache
    const cached = _peopleCache.get(treeRootId);
    if (cached && Date.now() - cached.ts < PEOPLE_CACHE_TTL) {
      if (cached.people.length > 0) context.knownPeople = cached.people;
      return;
    }

    // Find relationships domain via life extension
    try {
      const { getExtension } = await import("../loader.js");
      const life = getExtension("life");
      if (!life?.exports?.getDomainNodes) return;

      const domains = await life.exports.getDomainNodes(treeRootId);
      if (!domains.relationships?.id) {
        _peopleCache.set(treeRootId, { people: [], ts: Date.now() });
        return;
      }

      const people = await getPeople(domains.relationships.id);
      const compact = people.map(p => {
        const parts = [p.name];
        if (p.relation) parts.push(`(${p.relation})`);
        return parts.join(" ");
      });

      _peopleCache.set(treeRootId, { people: compact, ts: Date.now() });
      if (compact.length > 0) context.knownPeople = compact;
    } catch {}
  }, "relationships");

  log.info("Relationships", "Loaded. The tree sees people.");

  // ── Register apps-grid slot ──
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("apps-grid", "relationships", ({ userId, rootMap, tokenParam, tokenField, esc: e }) => {
      const entries = rootMap.get("Relationships") || [];
      const existing = entries.map(entry =>
        `<a class="app-active" href="/api/v1/root/${entry.id}/relationships?html${tokenParam}" style="margin-right:8px;margin-bottom:6px;">${e(entry.name)}</a>`
      ).join("");
      return `<div class="app-card">
        <div class="app-header"><span class="app-emoji">👥</span><span class="app-name">Relationships</span></div>
        <div class="app-desc">People in your life. Track who matters, interactions, ideas for others. The tree notices when you mention someone.</div>
        ${existing ? `<div style="display:flex;flex-wrap:wrap;margin-bottom:10px;">${existing}</div>` : ""}
        <form class="app-form" method="POST" action="/api/v1/user/${userId}/apps/create">
          ${tokenField}<input type="hidden" name="app" value="relationships" />
          <input class="app-input" name="message" placeholder="Tell me about someone in your life" required />
          <button class="app-start" type="submit">${entries.length > 0 ? "New" : "Start"} Relationships</button>
        </form>
      </div>`;
    }, { priority: 55 });
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
      findRelNodes,
      getPeople,
      handleMessage,
    },
  };
}
