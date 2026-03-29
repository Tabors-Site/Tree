import { setModels } from "./core.js";

export async function init(core) {
  setModels(core.models);
  const { default: router, resolveHtmlAuth } = await import("./routes.js");
  resolveHtmlAuth();
  return { router };
}
