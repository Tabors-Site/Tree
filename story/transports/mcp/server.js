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
// my universal grammar; every act inside me already speaks them. The
// internal cognition speaks WORD (14.md §4.5) — there is no JSON tool
// registry to announce; a being's act is one Word parsed into a verb
// dispatch. The old self-loop's JSON tool surface is gone.
//
// MCP lives on as a future wrapper around the verbs, not a parallel
// surface inside them. If an external MCP client wants to call into
// this place, I'd activate this transport: it would expose the verb
// dispatcher (or the DO operation registry) to MCP clients and
// translate inbound MCP tool calls into IBP verb dispatches at intake.
// Same shape as transports/http/ and transports/ws/ — an edge adapter
// that turns an outside protocol into one of my four verbs and then
// steps out of the way.
//
// I do not call this myself. genesis.js does not import this file.
// An operator (or a future config flag) wires it in when they want
// MCP-protocol clients to reach this place. Until then it sits
// dormant, a doorway that knows how to open.
//
// ─────────────────────────────────────────────────────────────────
// DEPENDENCY REMOVED — read before re-enabling
// ─────────────────────────────────────────────────────────────────
//
// `@modelcontextprotocol/sdk` is NO LONGER a declared dependency. It
// was dropped during the 2026-06 dependency cleanup (MCP was dormant,
// and the sdk was the only thing dragging in transitive packages the
// seed actually used directly, e.g. jose — which has since also been
// removed, replaced by seed/jwsEd25519.js over node:crypto). The
// imports below therefore will NOT resolve until you reinstall it.
// To re-enable MCP:
//
//   1. npm install @modelcontextprotocol/sdk
//   2. Wire this transport into boot: import + start it from
//      genesis.js (or behind a story-config flag), passing the
//      express app + the authenticate seat for inbound calls.
//   3. Each op carries its own JSON schema on its spec (seed/ibp/
//      operations.js) — there is no zod step anymore. Confirm the
//      enumeration in "Shape" step 2 still reads that schema directly.
//
// Nothing imports this file at boot, so the missing dependency does
// not affect the running story; it only matters the day you turn
// MCP back on.
//
// ─────────────────────────────────────────────────────────────────
// Shape (when activated)
// ─────────────────────────────────────────────────────────────────
//
// Boot:
//   1. Open an McpServer (from @modelcontextprotocol/sdk).
//   2. Enumerate the DO operation registry (seed/ibp/operations.js).
//      For each op, register it with the MCP server using:
//        - the op's JSON schema (stored directly on the op spec).
//        - a thin handler that dispatches through the verb dispatcher
//          and wraps the return as MCP's { content: [{ type: "text", text }] }.
//   3. Mount three HTTP routes (POST / GET / DELETE /mcp) protected
//      by the standard `authenticate` middleware, so every inbound
//      tool call rides a verified beingId into the verb dispatcher.
//
// Per-call:
//   external MCP client emits tool call
//     → mcp transport unwraps op name + args
//     → dispatch through the verb dispatcher (story.see/do/summon/be)
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

import log from "../../seed/seedStory/log.js";

/**
 * Initialize the MCP server transport.
 *
 * Dormant by default. Call this from your boot sequence (after
 * genesis() has finished registering tools) when you want MCP
 * clients to be able to reach this place.
 *
 * @param {object} app — the express app to mount on
 * @param {object} [opts]
 * @param {string} [opts.mountPath="/mcp"] — HTTP path prefix
 */
export async function initMcpServer(app, opts = {}) {
  const mountPath = opts.mountPath || "/mcp";

  log.warn(
    "MCP",
    `MCP transport is a stub. To activate: import the MCP SDK, expose the ` +
    `DO operation registry (seed/ibp/operations.js) as MCP tools that ` +
    `dispatch through the verb dispatcher, and mount routes at ${mountPath}. ` +
    `See header comment.`,
  );

  // SHAPE (to fill in when activated):
  //
  //   const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  //   const { StreamableHTTPServerTransport } = await import(
  //     "@modelcontextprotocol/sdk/server/streamableHttp.js"
  //   );
  //   const authenticate = (await import("../http/middleware/authenticate.js")).default;
  //
  //   const mcp = new McpServer({ name: "treeos", version: getSeedVersion() });
  //
  //   // Enumerate the DO operation registry and register each op as an
  //   // MCP tool whose handler dispatches through the verb layer
  //   // (story.do / the verb dispatcher), which authorizes + stamps.
  //   for (const op of listDoOperations()) {
  //     mcp.registerTool(
  //       op.name,
  //       { description: op.description, inputSchema: op.schema },
  //       async (args) => wrapAsMcpResult(await dispatchDo(op.name, args)),
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
