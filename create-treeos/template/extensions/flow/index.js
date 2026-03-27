import { getFlowForPosition } from "./core.js";

export async function init(core) {
  const { default: router } = await import("./routes.js");
  return {
    router,
    exports: { getFlowForPosition },
  };
}
