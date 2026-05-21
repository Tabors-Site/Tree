import { isSealed, sealPayload } from "./core.js";

export async function init(core) {
  const { default: router, setMetadata } = await import("./routes.js");
  setMetadata(core.metadata);

  return {
    router,
    exports: {
      isSealed,
      sealPayload,
    },
  };
}
