import tools from "./tools.js";
import { setServices, setEnergyService } from "./core.js";
import { setExtensions } from "./scriptsFunctions/safeFunctions.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  setServices({ models: core.models, contributions: core.contributions, metadata: core.metadata });
  if (core.energy) setEnergyService(core.energy);

  const { default: router, setNodeModel, resolveHtmlAuth } = await import("./routes.js");
  setNodeModel(core.models.Node);
  resolveHtmlAuth();

  // Wire optional extension functions for sandboxed scripts
  setExtensions({
    values: getExtension("values")?.exports,
    prestige: getExtension("prestige")?.exports,
    schedules: getExtension("schedules")?.exports,
  });

  // Inject script list into AI context
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const scripts = meta.scripts?.list || [];
    if (scripts.length > 0) {
      context.scripts = scripts.map(s => ({ id: s._id, name: s.name }));
    }
  }, "scripts");

  // Register navigation for script tools (if treeos-base installed)
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    if (base?.exports?.registerToolNavigations) {
      const scriptNav = ({ args, withToken: t }) => t(`/api/v1/node/${args.nodeId}?html`);
      base.exports.registerToolNavigations({
        "update-node-script": scriptNav,
        "execute-node-script": scriptNav,
      });
    }
  } catch {}

  // Register scripts section on node detail page
  try {
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("node-detail-below", "scripts", ({ node, nodeId, qs }) => {
      const scripts = (node.metadata instanceof Map ? node.metadata?.get("scripts") : node.metadata?.scripts)?.list || [];
      return `<div class="scripts-section">
        <h2><a href="/api/v1/node/${node._id}/scripts/help${qs}">Scripts</a></h2>
        <form method="POST" action="/api/v1/node/${nodeId}/script/create${qs}"
              style="display:flex;gap:8px;align-items:center;margin-bottom:16px;">
          <input type="text" name="name" placeholder="New script name" required
                 style="padding:12px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.2);color:white;font-size:15px;min-width:200px;flex:1;" />
          <button type="submit" class="primary-button" title="Create script" style="padding:10px 18px;font-size:16px;">+</button>
        </form>
        <ul class="scripts-list">
          ${scripts.length
            ? scripts.map(s => `<a href="/api/v1/node/${node._id}/script/${s._id}${qs}"><li><strong>${s.name}</strong><pre>${s.script}</pre></li></a>`).join("")
            : `<li><em>No scripts defined</em></li>`}
        </ul>
      </div>`;
    }, { priority: 20 });
  } catch {}

  return { router, tools };
}
