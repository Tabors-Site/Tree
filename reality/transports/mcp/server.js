// TreeOS Place . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// MCP. The transport I keep here in case the world needs to reach me
// through it.
//
// MCP was once at the heart of the factory. In an earlier era I
// hosted my own MCP server inside the seed and the LLM voice
// called itself through it — a self-loop over HTTP, wrapping every
// tool call in MCP envelopes just to dispatch back into my own
// operation registry. That layer is gone.
//
// IBP is the main now. The four verbs (SEE / DO / SUMMON / BE) are
// my universal grammar; every act inside me already speaks them.
// The LLM voice's tool dispatch goes direct from getToolHandler to
// the verb dispatcher — no protocol wrapper between the inference
// loop and place.do. Tools are verb-tagged at registration; the
// verb tells the dispatcher how to gate the call.
//
// MCP lives on as a future wrapper around the verbs, not a parallel
// surface inside them. If an external MCP client wants to call into
// this place, I'd activate this transport: it announces my tool
// registry to MCP clients and translates inbound MCP tool calls
// into IBP verb dispatches at intake. Same shape as transports/http/
// and transports/ws/ — an edge adapter that turns an outside
// protocol into one of my four verbs and then steps out of the way.
//
// I do not call this myself. genesis.js does not import this file.
// An operator (or a future config flag) wires it in when they want
// MCP-protocol clients to reach this place. Until then it sits
// dormant, a doorway that knows how to open.
//
// ─────────────────────────────────────────────────────────────────
// Shape (when activated)
// ─────────────────────────────────────────────────────────────────
//
// Boot:
//   1. Open an McpServer (from @modelcontextprotocol/sdk).
//   2. Enumerate my seed tool registry. For each tool, register it
//      with the MCP server using:
//        - the tool's existing JSON schema (already built by
//          zod-to-json-schema inside seed/present/voices/llm/tools.js).
//        - a thin handler that calls getToolHandler(name)(args) and
//          wraps the return as MCP's { content: [{ type: "text", text }] }.
//   3. Mount three HTTP routes (POST / GET / DELETE /mcp) protected
//      by the standard `authenticate` middleware, so every inbound
//      tool call rides a verified beingId into the verb dispatcher.
//
// Per-call:
//   external MCP client emits tool call
//     → mcp transport unwraps name + args
//     → handler = getToolHandler(name)
//     → handler runs (typically wrapping place.see/do/summon/be)
//     → verb dispatcher authorizes (stance auth + extension-scope gate)
//     → operation handler runs, Fact is stamped
//     → result wrapped into MCP's content shape, returned to client
//
// Auth carries through unchanged. The verb dispatcher's authorize
// gate is the only gate; this transport adds no parallel checks.
//
// Tool list freshness: MCP locks the announced tool list at session
// connect. genesis order must finish (extensions load, tools
// register) before any MCP client connects. The simplest discipline
// is "genesis completes → MCP listens." Notification-based refresh
// (notifications/tools/list_changed) is a follow-up if hot reload
// becomes a need.

import log from "../../seed/parentReality/log.js";

/**
 * Initialize the MCP server transport.
 *
 * Dormant by default. Call this from your boot sequence (after
 * genesis() has finished registering tools) when you want MCP
 * clients to be able to reach this place.
 *
 * @param {import("express").Express} app — the express app to mount on
 * @param {object} [opts]
 * @param {string} [opts.mountPath="/mcp"] — HTTP path prefix
 */
export async function initMcpServer(app, opts = {}) {
  const mountPath = opts.mountPath || "/mcp";

  log.warn(
    "MCP",
    `MCP transport is a stub. To activate: import the MCP SDK, wire ` +
    `getToolHandler from seed/present/voices/llm/tools.js into MCP tool ` +
    `registrations, and mount routes at ${mountPath}. See header comment.`,
  );

  // SHAPE (to fill in when activated):
  //
  //   const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  //   const { StreamableHTTPServerTransport } = await import(
  //     "@modelcontextprotocol/sdk/server/streamableHttp.js"
  //   );
  //   const { listToolNames, getToolDef, getToolHandler } = await import(
  //     "../../seed/present/voices/llm/tools.js"
  //   );
  //   const authenticate = (await import("../http/middleware/authenticate.js")).default;
  //
  //   const mcp = new McpServer({ name: "treeos", version: getSeedVersion() });
  //
  //   for (const name of listToolNames()) {
  //     const def = getToolDef(name);
  //     const handler = getToolHandler(name);
  //     if (!handler) continue;             // def-only tools skipped
  //     mcp.registerTool(
  //       name,
  //       {
  //         description: def.function.description,
  //         inputSchema: def.function.parameters,
  //       },
  //       async (args) => wrapAsMcpResult(await handler(args)),
  //     );
  //   }
  //
  //   // Per-session HTTP transport. Each connect spins up its own
  //   // StreamableHTTPServerTransport bound to the shared McpServer.
  //   app.post(mountPath,   authenticate, makeMcpHttpHandler(mcp));
  //   app.get(mountPath,    authenticate, makeMcpHttpHandler(mcp));
  //   app.delete(mountPath, authenticate, makeMcpHttpHandler(mcp));
}

/**
 * Wrap a tool handler's return into MCP's content shape.
 * Tool handlers return arbitrary JSON (or strings); MCP expects:
 *   { content: [{ type: "text", text: "..." }] }
 */
export function wrapAsMcpResult(result) {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  return { content: [{ type: "text", text }] };
}
