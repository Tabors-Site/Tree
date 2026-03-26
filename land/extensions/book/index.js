import { setModels } from "./core.js";

export async function init(core) {
  setModels(core.models);
  const { default: router } = await import("./routes.js");
  return { router };
}
