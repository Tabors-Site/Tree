import { setModels } from "./core.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  setModels(core.models);
  const { default: router, resolveHtmlAuth } = await import("./routes.js");
  resolveHtmlAuth();

  try {
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("tree-quick-links", "book", ({ rootId, queryString }) =>
      `<a href="/api/v1/root/${rootId}/book${queryString}" class="back-link">Book</a>`,
      { priority: 25 }
    );
  } catch {}

  return { router };
}
