import { setServices, setEnergyService } from "./core.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  setServices({ models: core.models, contributions: core.contributions, metadata: core.metadata });
  if (core.energy) setEnergyService(core.energy);
  const { default: router, resolveHtmlAuth } = await import("./routes.js");
  resolveHtmlAuth();

  // Register version quick link
  try {
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("version-quick-links", "transactions", ({ nodeId, version, qs }) =>
      `<a href="/api/v1/node/${nodeId}/${version}/transactions${qs}">Transactions</a>`,
      { priority: 20 }
    );

    treeos?.exports?.registerSlot?.("tree-transaction-policy", "transactions", ({ policyHtml }) => {
      if (!policyHtml) return "";
      return `<div class="content-card">
  <div class="section-header"><h2>Transaction Policy</h2></div>
  ${policyHtml}
</div>`;
    }, { priority: 30 });
  } catch {}

  return { router };
}
