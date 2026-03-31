import log from "../../seed/log.js";

const DEFAULT_TYPES = ["goal", "plan", "task", "knowledge", "resource", "identity"];

let configuredTypes = [...DEFAULT_TYPES];

export async function init(core) {
  // Land operators can override via land config: starterTypes = ["goal", "plan", ...]
  try {
    const { getLandConfigValue } = await import("../../seed/landConfig.js");
    const custom = getLandConfigValue("starterTypes");
    if (Array.isArray(custom) && custom.length > 0) {
      configuredTypes = custom;
    }
  } catch (err) {
    log.debug("StarterTypes", "Custom types config not found, using defaults");
  }

  // Inject suggested types into AI context at every node
  core.hooks.register("enrichContext", async ({ context }) => {
    context.suggestedTypes = configuredTypes;
  }, "starter-types");

  // Register type options on node detail page
  try {
    const { getExtension } = await import("../loader.js");
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("node-type-options", "starter-types", ({ nodeType }) => {
      return configuredTypes.map(t =>
        `<option value="${t}" ${nodeType === t ? "selected" : ""}>${t}</option>`
      ).join("\n");
    }, { priority: 10 });
  } catch {}

  log.info("StarterTypes", `Loaded ${configuredTypes.length} type suggestions`);

  const tools = [
    {
      name: "get-available-types",
      description: "Get the list of suggested node types for this land.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async handler() {
        return {
          content: [{
            type: "text",
            text: `Available node types: ${configuredTypes.join(", ")}. Custom types are also allowed.`,
          }],
        };
      },
    },
  ];

  return { tools };
}
