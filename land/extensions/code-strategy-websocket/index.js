import { z } from "zod";
import { defineStrategy, applies } from "../code-workspace/sdk.js";
import { sanitizeMessageTypes, serverSkeleton, clientSkeleton, verifySeam } from "./lib.js";

const CONTEXT_BLOCK = `A WebSocket is a persistent duplex connection between a browser and a
server. Unlike HTTP, the connection stays open; both sides send and
receive whenever they want. The cost of that is agreement: if the
client sends a message the server does not handle, it disappears
silently. The seam between the two sides is the most common source of
bugs.

In this land, the preview proxy rewrites \`ws://\` to \`wss://\`
automatically when the page is served over HTTPS. Do not hardcode
either scheme. The client skeleton handles the rewrite for you.

The server binds to \`process.env.PORT\`. The preview spawner assigns
the port at runtime and passes it via env.PORT. Never invent another
name (WS_PORT, SERVER_PORT, APP_PORT). A server that reads a
different variable fails with ERR_CONNECTION_REFUSED.

A WebSocket server MUST also serve HTTP. The preview proxy reaches
the child through HTTP first and upgrades to WS on /ws-style paths.
A bare \`http.createServer()\` with no request handler will accept
TCP but hang on every HTTP request; the server skeleton includes
a minimal handler.

Three functions you can call. You do not need to know how they work.
They were built once, tested once, and work.

  ws-create-server({ messageTypes }) — emit complete server.js.
  ws-create-client({ messageTypes }) — emit complete client.js.
  ws-verify() — check the client/server seam.

Pass the SAME messageTypes list to both create functions. That is
what makes the seam correct by construction — the server handles
every type the client sends, and vice versa, because both sides
were generated from the same list.

IMPORTANT — the output is COMPLETE, not a template. The skeleton
already handles connection tracking, broadcast, per-type cases, the
URL rewrite, the send queue, and reconnect. There are no TODO
comments to fill in. Do NOT edit the file to "rename clients to
players", "add real logic", or similar — the broadcast function
depends on internal variable names you cannot see.

PLAN GRANULARITY — if your branch's plan has separate steps like
"implement join handler", "implement leave handler", "set up
broadcasting", one ws-create-server call satisfies ALL of them.
Check every such step off after the call and emit [[DONE]]. Do not
try to "enhance" the skeleton step by step — that's the failure
mode this strategy was built to prevent.

SCOPE — these wrappers cover TRANSPORT only: connection, framing,
broadcast, reconnect. They do NOT cover UI, rendering, canvas,
drawing logic, server-side state tracking (who's online, what
shapes exist), or persistence. If the user asks for an actual
application (a whiteboard, a chat room, a multiplayer game), you
still need branches that write HTML, CSS, state maps, and any
storage code. The wrappers save you from writing the WebSocket
plumbing; they don't build the app around it.`;

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

const strategy = defineStrategy({
  name: "websocket",
  contextBlock: CONTEXT_BLOCK,
  appliesWhen: applies.any(
    applies.contractKind(/ws|websocket|realtime|socket/),
    applies.messageContract(),
    applies.specMatches(/\bwebsocket\b|\bws\b|\bsocket\.io\b|\breal[\s-]?time\b|\brealtime\b|\bbroadcast\b|\bmultiplayer\b|\bchat\b|\blive\b/i),
  ),
  tools: [
    {
      name: "ws-create-server",
      description:
        "Emit a complete WebSocket server into the current project. Binds to " +
        "process.env.PORT, handles the given messageTypes with broadcast, " +
        "serves a minimal HTTP handler. Default filename is server.js. Output " +
        "is COMPLETE — no TODOs to fill. Do not edit the file to 'add logic'.",
      schema: {
        messageTypes: z.array(z.string()).describe("Identifier-shaped message type names. Use the same list in ws-create-client."),
        filePath: z.string().optional().describe("Target filename. Defaults to 'server.js'."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false },
      async handler({ writeFile, ensureDeps, messageTypes, filePath }) {
        const types = sanitizeMessageTypes(messageTypes);
        if (types.length === 0) {
          return text("ws-create-server rejected: messageTypes must be a non-empty array of identifier-shaped strings.");
        }
        const dep = await ensureDeps({ ws: "^8.18.0" });
        if (!dep.ok) return text(`ws-create-server rejected (deps): ${dep.error}`);
        const result = await writeFile((filePath && filePath.trim()) || "server.js", serverSkeleton(types));
        if (!result.ok) return text(`ws-create-server rejected: ${result.error}`);
        return text(
          `${result.created ? "Created" : "Updated"} ${result.filePath} — complete WebSocket server for ${types.length} type${types.length === 1 ? "" : "s"}: ${types.join(", ")}. ` +
          `Added 'ws' to package.json dependencies. ` +
          `Covers PORT binding, HTTP handler, broadcast, per-type cases. This satisfies any plan steps about server setup or per-type handling — check them off, do not edit the file.`
        );
      },
    },
    {
      name: "ws-create-client",
      description:
        "Emit a complete WebSocket client into the current project. Uses the " +
        "preview proxy's ws:// → wss:// rewrite, handles reconnect, exposes " +
        "sender helpers. Default filename is client.js. Pass the SAME " +
        "messageTypes you passed to ws-create-server.",
      schema: {
        messageTypes: z.array(z.string()).describe("Same list you passed to ws-create-server."),
        filePath: z.string().optional().describe("Target filename. Defaults to 'client.js'."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false },
      async handler({ writeFile, messageTypes, filePath }) {
        const types = sanitizeMessageTypes(messageTypes);
        if (types.length === 0) {
          return text("ws-create-client rejected: messageTypes must be a non-empty array of identifier-shaped strings.");
        }
        const result = await writeFile((filePath && filePath.trim()) || "client.js", clientSkeleton(types));
        if (!result.ok) return text(`ws-create-client rejected: ${result.error}`);
        const senders = types.map((t) => `send${t[0].toUpperCase() + t.slice(1)}`).join(", ");
        return text(
          `${result.created ? "Created" : "Updated"} ${result.filePath} — complete WebSocket client for ${types.length} type${types.length === 1 ? "" : "s"}: ${types.join(", ")}. ` +
          `Exposes senders (${senders}). Import these from your UI code rather than rewriting the WebSocket logic by hand.`
        );
      },
    },
    {
      name: "ws-verify",
      description:
        "Check that every message type the client sends has a matching server " +
        "handler, and vice versa. PASS if the seam is coherent; FAIL lists the " +
        "missing pairs.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ readWorkspaceFiles }) {
        const files = await readWorkspaceFiles();
        if (files.length === 0) return text("ws-verify: no files in active project");
        const result = verifySeam(files);
        if (result.ok) {
          return text(`PASS — WebSocket seam coherent across ${result.types.length} type${result.types.length === 1 ? "" : "s"}: ${result.types.join(", ") || "(none)"}`);
        }
        const lines = ["FAIL — WebSocket seam mismatch:"];
        for (const t of result.clientSendsMissing) lines.push(`  client sends "${t}" but no server case handles it`);
        for (const t of result.serverSendsMissing) lines.push(`  server sends "${t}" but no client case handles it`);
        return text(lines.join("\n"));
      },
    },
  ],
});

export async function init() {
  return strategy.toInit();
}
