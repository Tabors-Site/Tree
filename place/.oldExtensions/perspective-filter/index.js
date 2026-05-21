import log from "../../seed/log.js";
import tools from "./tools.js";
import { shouldDeliver, resolvePerspective, setPerspective, clearPerspective, setMetadata } from "./core.js";

export async function init(core) {
  setMetadata(core.metadata);
  // Inject perspective info into AI context so the AI knows what this node cares about
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const perspective = meta.perspective || meta["perspective-filter"];
    if (perspective && (perspective.accept?.length || perspective.reject?.length)) {
      context.perspective = perspective;
    }
  }, "perspective-filter");

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
    exports: {
      shouldDeliver,
      resolvePerspective,
      setPerspective,
      clearPerspective,
    },
  };
}
