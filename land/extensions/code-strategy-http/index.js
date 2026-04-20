import { z } from "zod";
import { defineStrategy, applies } from "../code-workspace/sdk.js";
import { sanitizeRoutes, serverSkeleton, verifyRoutes } from "./lib.js";

const CONTEXT_BLOCK = `An HTTP server in this land is an Express app that binds to
\`process.env.PORT\`. The preview spawner assigns a port at runtime and
serves the app through \`/api/v1/preview/<slug>/\`. Do not hardcode a
port. Do not read a different env var (no HTTP_PORT, no APP_PORT, no
SERVER_PORT). A server that reads the wrong variable fails with
ERR_CONNECTION_REFUSED.

The server parses JSON bodies by default. Request handlers receive
\`(req, res)\`. Responses use \`res.json()\` for JSON or
\`res.type(...).send(...)\` for other content types.

If your app also has a frontend, the same Express server can serve it
statically (\`express.static\`) or a separate static page can be added
as a sibling file and the preview proxy will serve it directly.

Two functions you can call. You do not need to know how they work.

  http-create-server({ routes }) — emit complete server.js wiring
    each route handler. Pass an empty routes array for a plain
    health server.
  http-verify() — check every client fetch hits a defined server route.

The routes list you pass to http-create-server is the single source of
truth for what the server handles. Match your client-side fetch calls
to the same paths and the seam is correct by construction.`;

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

const strategy = defineStrategy({
  name: "http",
  contextBlock: CONTEXT_BLOCK,
  appliesWhen: applies.any(
    applies.routeContract(),
    applies.contractKind(/http|rest|api|route|endpoint/),
    applies.specMatches(/\b(rest\s+api|http\s+server|express|fetch\s+endpoint|json\s+api)\b/i),
  ),
  tools: [
    {
      name: "http-create-server",
      description:
        "Emit a complete Express HTTP server into the current project. Binds " +
        "to process.env.PORT, parses JSON bodies, wires the given routes. " +
        "Default filename is server.js.",
      schema: {
        routes: z
          .array(
            z.object({
              method: z.string().describe("HTTP method: get, post, put, patch, delete."),
              path: z.string().describe("Route path starting with '/'."),
              name: z.string().describe("Identifier name for the route handler."),
            })
          )
          .optional()
          .describe("Routes to wire. If empty, emits a / health handler only."),
        filePath: z.string().optional().describe("Target filename. Defaults to 'server.js'."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false },
      async handler({ writeFile, ensureDeps, routes, filePath }) {
        const clean = sanitizeRoutes(routes || []);
        const dep = await ensureDeps({ express: "^4.19.0" });
        if (!dep.ok) return text(`http-create-server rejected (deps): ${dep.error}`);
        const result = await writeFile(
          (filePath && filePath.trim()) || "server.js",
          serverSkeleton(clean)
        );
        if (!result.ok) return text(`http-create-server rejected: ${result.error}`);
        const summary = clean.length === 0
          ? "health handler on GET /"
          : `${clean.length} route${clean.length === 1 ? "" : "s"}: ${clean.map((r) => `${r.method.toUpperCase()} ${r.path}`).join(", ")}`;
        return text(
          `${result.created ? "Created" : "Updated"} ${result.filePath} — Express HTTP server (${summary}). Binds to process.env.PORT. Added 'express' to package.json.`
        );
      },
    },
    {
      name: "http-verify",
      description:
        "Check every client-side fetch targets a defined server route. PASS " +
        "if coherent; FAIL lists the mismatches.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ readWorkspaceFiles }) {
        const files = await readWorkspaceFiles();
        if (files.length === 0) return text("http-verify: no files in active project");
        const result = verifyRoutes(files);
        if (result.ok) {
          return text(
            `PASS — every client fetch targets a defined server route. ` +
            `Routes: ${result.serverRoutes.join(", ") || "(none)"}. ` +
            `Calls: ${result.clientCalls.join(", ") || "(none)"}.`
          );
        }
        const lines = ["FAIL — HTTP seam mismatch:"];
        for (const c of result.missing) lines.push(`  client calls "${c}" but no matching server route`);
        return text(lines.join("\n"));
      },
    },
  ],
});

export async function init() {
  return strategy.toInit();
}
