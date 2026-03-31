import tools from "./tools.js";
import { setServices, setEnergyService, addPrestige, resolveVersion } from "./core.js";

export async function init(core) {
  setServices({ models: core.models, contributions: core.contributions, metadata: core.metadata });
  if (core.energy) setEnergyService(core.energy);

  const { default: router, setNodeModel } = await import("./routes.js");
  setNodeModel(core.models.Node);

  const Node = core.models.Node;

  core.hooks.register("beforeNote", async (data) => {
    const node = await Node.findById(data.nodeId).select("metadata").lean();
    if (!node) return;
    const prestige = core.metadata.getExtMeta(node, "prestige");
    if (!data.metadata) data.metadata = {};
    data.metadata.version = prestige?.current || 0;
  }, "prestige");

  core.hooks.register("beforeContribution", async (data) => {
    const node = await Node.findById(data.nodeId).select("metadata").lean();
    if (!node) return;
    const prestige = core.metadata.getExtMeta(node, "prestige");
    if (prestige?.current) {
      data.nodeVersion = String(prestige.current);
    }
  }, "prestige");

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const prestige = meta.prestige;
    if (prestige?.current) {
      context.prestige = prestige.current;
      context.totalVersions = (prestige.history?.length || 0) + 1;
    }
  }, "prestige");

  // Register navigation for prestige tool (if treeos-base installed)
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    if (base?.exports?.registerToolNavigation) {
      base.exports.registerToolNavigation("add-node-prestige", ({ args, withToken: t }) =>
        t(`/api/v1/node/${args.nodeId}/${args.prestige || 0}?html`));
    }
  } catch {}

  // Register UI slots
  try {
    const { getExtension } = await import("../loader.js");
    const treeos = getExtension("treeos-base");
    if (treeos?.exports?.registerSlot) {
      // Versions list on node detail page
      treeos.exports.registerSlot("node-detail-sections", "prestige", ({ node, nodeId, qs, isPublicAccess }) => {
        const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
        const prestige = meta.prestige || { current: 0, history: [] };
        return `<div class="versions-section">
          <h2>Versions</h2>
          <ul class="versions-list">
            ${[...Array(prestige.current + 1)].map((_, i) =>
              `<li><a href="/api/v1/node/${nodeId}/${i}${qs}">Version ${i}${i === prestige.current ? " (current)" : ""}</a></li>`
            ).reverse().join("")}
          </ul>
          ${!isPublicAccess ? `<form method="POST" action="/api/v1/node/${nodeId}/prestige${qs}"
            onsubmit="return confirm('Complete current version and create new prestige level?')" style="margin-top:16px;">
            <button type="submit" class="primary-button">Add New Version</button>
          </form>` : ""}
        </div>`;
      }, { priority: 10 });

      // Version badge on version detail page
      treeos.exports.registerSlot("version-badge", "prestige", ({ version, data }) => {
        return `<span class="version-badge version-status-${data?.status || "active"}">Version ${version}</span>`;
      }, { priority: 10 });

      // Version control on version detail page
      treeos.exports.registerSlot("version-detail-sections", "prestige", ({ nodeId, version, qs, showPrestige }) => {
        if (!showPrestige) return "";
        return `<div class="actions-section">
          <h3>Version Control</h3>
          <form method="POST" action="/api/v1/node/${nodeId}/${version}/prestige${qs}"
            onsubmit="return confirm('Complete current version and create new prestige level?')" class="action-form">
            <button type="submit" class="primary-button">Add New Version</button>
          </form>
        </div>`;
      }, { priority: 10 });
    }
  } catch {}

  return {
    router,
    tools,
    modeTools: [
      { modeKey: "tree:edit", toolNames: ["add-node-prestige"] },
    ],
    exports: { addPrestige, resolveVersion },
  };
}
