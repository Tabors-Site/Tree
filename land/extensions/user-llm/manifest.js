export default {
  name: "user-llm",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Bring your own LLM. Users create named connections with a base URL, API key, and " +
    "model name. Any OpenAI-compatible endpoint works: OpenAI, Anthropic via proxy, " +
    "local Ollama, vLLM, Together, Groq, or anything that speaks the chat completions " +
    "protocol. API keys are encrypted at rest with AES-256-CBC. Base URLs are validated " +
    "against an SSRF blocklist (private IPs, metadata endpoints, loopback) with DNS " +
    "resolution checked at both write time and request time. Admins are exempt from the " +
    "blocklist so they can point at localhost for local models.\n\n" +
    "Connections assign to slots. The main slot sets user.llmDefault, which the " +
    "conversation resolution chain checks after tree-level assignments. Extension slots " +
    "(placement, respond, notes, and any slot registered by other extensions) write to " +
    "user metadata so different tasks can use different models. Tree owners can also " +
    "assign connections to tree-level slots, overriding user defaults for everyone in " +
    "that tree. The full resolution chain: extension slot on tree, tree default, " +
    "extension slot on user, user default.\n\n" +
    "Failover stack: push backup connections onto a per-user stack (max 10). When the " +
    "primary connection fails, the conversation system walks the stack in order until " +
    "one succeeds. Deleting a connection auto-clears all user and tree assignments " +
    "pointing to it and busts the LLM client cache so changes take effect immediately.",

  needs: {
    models: ["User", "Node"],
  },

  optional: {
    extensions: ["html-rendering"],
  },

  provides: {
    models: {
      LlmConnection: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    cli: [
      { command: "llm failover", scope: ["home"], description: "Show failover stack", method: "GET", endpoint: "/user/:userId/llm-failover" },
      { command: "llm failover-push <connectionId>", scope: ["home"], description: "Add a connection to the failover stack", method: "POST", endpoint: "/user/:userId/llm-failover", body: ["connectionId"] },
      { command: "llm failover-pop", scope: ["home"], description: "Remove last connection from failover stack", method: "DELETE", endpoint: "/user/:userId/llm-failover" },
    ],
  },
};
