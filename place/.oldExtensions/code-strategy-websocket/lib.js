/**
 * Private helpers for the websocket strategy. Strategies own their
 * whole folder; anything here is internal to this extension and
 * called only by its own tool wrappers in index.js.
 *
 * If you build your own strategy, put skeletons, codegen helpers,
 * transformers, validators, or any shared logic in a file like this.
 * Tool wrappers stay thin; the hard code lives here.
 */

const TYPE_RX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function sanitizeMessageTypes(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = String(raw || "").trim();
    if (!t || !TYPE_RX.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function serverSkeleton(messageTypes) {
  const handlerBlock = messageTypes
    .map(
      (t) =>
        `    case "${t}":\n` +
        `      broadcast({ type: "${t}", payload: msg.payload, from: client.id });\n` +
        `      break;`
    )
    .join("\n");

  return `const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

// The HTTP handler answers only /health so the WebSocket upgrade path
// works AND every other URL returns 404 — letting the preview's static
// fallback serve the frontend's index.html without this server swallowing
// the request with a generic "server up" body.
const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

const wss = new WebSocketServer({ server: httpServer });
const clients = new Set();

function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const c of clients) {
    if (c.socket.readyState === 1) c.socket.send(payload);
  }
}

wss.on("connection", (socket) => {
  const client = { id: crypto.randomUUID?.() || String(Date.now() + Math.random()), socket };
  clients.add(client);

  socket.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
${handlerBlock}
      default:
        break;
    }
  });

  socket.on("close", () => clients.delete(client));
});

httpServer.listen(PORT, () => {
  console.log("ws server listening on " + PORT);
});
`;
}

export function clientSkeleton(messageTypes) {
  const senderStubs = messageTypes
    .map(
      (t) =>
        `export function send${t[0].toUpperCase() + t.slice(1)}(payload) {\n` +
        `  send({ type: "${t}", payload });\n` +
        `}`
    )
    .join("\n\n");

  const caseBlock = messageTypes
    .map(
      (t) =>
        `    case "${t}":\n` +
        `      console.log("[ws] received ${t}", msg.payload);\n` +
        `      break;`
    )
    .join("\n");

  return `// WebSocket client. Uses the preview proxy's automatic ws:// → wss://
// rewrite so this works both in local dev and behind HTTPS.

const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
const base = window.location.pathname.replace(/\\/+$/, "");
const url = \`\${proto}//\${window.location.host}\${base}/ws\`;

let socket = null;
const queue = [];

function connect() {
  socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    while (queue.length) socket.send(queue.shift());
  });
  socket.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
${caseBlock}
      default:
        break;
    }
  });
  socket.addEventListener("close", () => setTimeout(connect, 1000));
}

function send(obj) {
  const payload = JSON.stringify(obj);
  if (socket && socket.readyState === 1) socket.send(payload);
  else queue.push(payload);
}

${senderStubs}

connect();
`;
}

export function verifySeam(files) {
  const serverSends = new Set();
  const serverHandles = new Set();
  const clientSends = new Set();
  const clientHandles = new Set();

  const SEND_RX = /type\s*:\s*["'`]([a-zA-Z_][a-zA-Z0-9_]*)["'`]/g;
  const CASE_RX = /case\s+["'`]([a-zA-Z_][a-zA-Z0-9_]*)["'`]\s*:/g;

  for (const f of files || []) {
    const content = f.content || "";
    if (!content || typeof content !== "string") continue;
    const isServer = /WebSocketServer|require\(["']ws["']\)|from\s+["']ws["']/.test(content);
    const isClient = /new\s+WebSocket\s*\(/.test(content);
    if (!isServer && !isClient) continue;
    const sends = new Set();
    for (const m of content.matchAll(SEND_RX)) sends.add(m[1]);
    const handles = new Set();
    for (const m of content.matchAll(CASE_RX)) handles.add(m[1]);
    if (isServer) {
      for (const t of sends) serverSends.add(t);
      for (const t of handles) serverHandles.add(t);
    }
    if (isClient) {
      for (const t of sends) clientSends.add(t);
      for (const t of handles) clientHandles.add(t);
    }
  }

  const clientSendsMissing = [...clientSends].filter((t) => !serverHandles.has(t));
  const serverSendsMissing = [...serverSends].filter((t) => !clientHandles.has(t));

  if (clientSendsMissing.length === 0 && serverSendsMissing.length === 0) {
    const all = new Set([...serverHandles, ...clientHandles, ...serverSends, ...clientSends]);
    return { ok: true, types: [...all] };
  }

  return {
    ok: false,
    clientSendsMissing,
    serverSendsMissing,
  };
}
