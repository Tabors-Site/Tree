/**
 * Private helpers for the http strategy.
 */

const ROUTE_NAME_RX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const METHOD_SET = new Set(["get", "post", "put", "patch", "delete"]);

export function sanitizeRoutes(routes) {
  if (!Array.isArray(routes)) return [];
  const out = [];
  for (const r of routes) {
    if (!r || typeof r !== "object") continue;
    const method = String(r.method || "get").toLowerCase();
    if (!METHOD_SET.has(method)) continue;
    const pathStr = String(r.path || "").trim();
    if (!pathStr.startsWith("/")) continue;
    const name = String(r.name || "").trim();
    if (!name || !ROUTE_NAME_RX.test(name)) continue;
    out.push({ method, path: pathStr, name });
  }
  return out;
}

export function serverSkeleton(routes) {
  const handlerBlock = routes.length === 0
    ? `app.get("/", (req, res) => {
  res.type("text/plain").send("http server up");
});`
    : routes
        .map(
          (r) =>
            `app.${r.method}(${JSON.stringify(r.path)}, (req, res) => {\n` +
            `  res.json({ ok: true, route: ${JSON.stringify(r.name)} });\n` +
            `});`
        )
        .join("\n\n");

  return `const express = require("express");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());

${handlerBlock}

app.listen(PORT, () => {
  console.log("http server listening on " + PORT);
});
`;
}

export function verifyRoutes(files) {
  const serverRoutes = new Set();
  const clientCalls = new Set();
  const ROUTE_RX = /app\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  const FETCH_RX = /fetch\s*\(\s*["'`]([^"'`]+)["'`]/g;

  for (const f of files || []) {
    const content = f.content || "";
    if (!content || typeof content !== "string") continue;
    for (const m of content.matchAll(ROUTE_RX)) {
      serverRoutes.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
    for (const m of content.matchAll(FETCH_RX)) {
      const url = m[1];
      if (!url.startsWith("/")) continue;
      clientCalls.add(`GET ${url}`);
    }
  }

  const missing = [...clientCalls].filter((c) => {
    const [, path] = c.split(" ");
    if (serverRoutes.has(c)) return false;
    for (const r of serverRoutes) {
      const [, rPath] = r.split(" ");
      if (rPath === path) return false;
    }
    return true;
  });

  return {
    ok: missing.length === 0,
    missing,
    serverRoutes: [...serverRoutes],
    clientCalls: [...clientCalls],
  };
}
