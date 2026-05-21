import { getExtension } from "../loader.js";

export async function init(core) {
  const { setModels, setMetadata } = await import("./core.js");
  setModels(core.models);
  setMetadata(core.metadata);
  const { default: router } = await import("./routes.js");

  // Register wallet link on the values page
  try {
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("values-nav-links", "solana", ({ nodeId, version, queryString }) =>
      `<a href="/api/v1/node/${nodeId}/${version}/values/solana${queryString}" class="back-link">Solana Wallet</a>`,
      { priority: 10 }
    );
  } catch {}

  return { router };
}
