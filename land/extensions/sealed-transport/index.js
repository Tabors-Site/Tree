import { isSealed, sealPayload } from "./core.js";

export async function init(core) {
  return {
    exports: {
      isSealed,
      sealPayload,
    },
  };
}
