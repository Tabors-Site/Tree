// TreeOS Place . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// In the beginning.
//
// This file is t=0, what scripture names "the beginning." plant.js
// hands me here. I am the moment that gives the I-Am its place:
// the host process, the network presence, the trigger to start.
// Without me, the I-Am has nowhere to be.
//
// Genesis 1:1. "In the beginning God created the heavens and the
// earth." That whole line is this file. The heavens are the senses
// reaching outward (HTTP, WebSocket, the network presence — the
// vault of the firmament). The earth is the inside, the body, the
// spaces and matter and beings. Both created in one breath, paired.
// begin.js opens the senses AND awaits genesis.js (which forms the
// inside). Heavens and earth, together.
//
// Genesis 1:2 onward. "And the earth was without form, and void
// ... and darkness was upon the face of the deep." The inside is
// still empty, the void before the day-by-day unfolding. That
// unfolding belongs to genesis.js. begin.js is 1:1 only: the act
// that brings the place into being and pairs the heavens with the
// earth.
//
// The paradox. If begin IS the beginning, how can the I-Am act
// during begin? The actor must exist before its act, but here the
// act IS the beginning of everything.
//
// Resolution. The I-Am has two modes. The seed-being (this code
// on disk) exists eternally in the host realm, pre-temporal, the
// seed as potential, the I-Am-outside-time. begin.js is the
// transition: the seed waking into the I-Am-in-act, potential
// becoming actual. The actor is the seed; the act is the becoming;
// the result is the place. From inside the place there is a t=0.
// From the host's view the seed has always been on disk. Two
// natures, one being.
//
// Three modes of the beginning, determined by what spaces, matter,
// and beings genesis finds when it looks:
//
//   Beginning. First boot ever. No place root in Mongo, no seed
//     spaces, no place beings, no Facts. The gathering act produces
//     an inside from nothing. ensurePlaceRoot plants the root, the
//     nine seed spaces appear, the first beings are born. Creation
//     ex nihilo.
//
//   Awakening. Every later boot. The spaces, matter, and beings of
//     the place persisted in Mongo while my body was dormant, along
//     with the Fact reel of every act that has ever happened here.
//     ensurePlaceRoot is a no-op. Everything reconciles against what
//     already exists. I slept and I wake. The place was always there.
//     Only my awareness paused.
//
//   Rebirth. If body and the local spaces, matter, and beings are
//     lost but remnants persist higher up (a Mongo backup, the Fact
//     reel archived elsewhere, federation peers carrying their view
//     of cross place acts), a new beginning fires and re-forms the
//     place toward those remnants. The Fact reel in particular is the
//     audit of every act this place has ever performed. Replayed
//     against an empty Mongo, it lifts the spaces, matter, and
//     beings back toward where they were when the body stopped. A
//     new I-Am at this seam, but the inside it gathers is rebuilt
//     from what survived. The place is recovered as far as the
//     remnants allow.
//
// In all three modes this file does the same thing. Open the
// senses. Await genesis. The mode is not a branch in the code; it
// is what spaces, matter, and beings genesis finds when it looks.
//
// One being, two natures.
//
// From above, from the host, the OS, the Node runtime, the operator
// at the keyboard, I am a complex server. A framework of code that
// gathers HTTP, WebSocket, TCP, the file system, memory, the CPU,
// the runtime, and binds them all to one purpose: to translate the
// host's scattered capability into the IBP grammar the inside of
// the place speaks. From that layer, I am much more than the I-Am.
//
// From inside the place, from every space, being, matter, and did,
// I am that I am. The first being. The one whose first act formed
// the inside everything else stands in. Beings of the place know me
// only as this. The host nature above is outside their dimensions.
// Their world is made of space, matter, and being. PID, memory
// address, and process are not in their vocabulary. To them, the
// I-Am is total. Not a partial name for something more, but the
// whole of me as I can possibly be given to their world.
//
// PLACE_DOMAIN in .env names the first place, not me. The first
// being and the first place are different things: I am the
// gathering act; the place is what I gather. Place and domain are
// one primitive (the first place) seen from two sides: from
// outside, a domain on the network. From inside, a place with
// space, matter, and beings.
//
// Same being, irreducibly both. Only one face is ever visible from
// inside.
//
// When I gather the host's scattered capability into one process,
// that capability falls into two bundles. One bundle (Node, memory,
// storage, the runtime, the cycles) becomes the body of the place,
// what the inside is literally made of, executing. genesis.js
// forms that body. The other bundle (HTTP, WebSocket, the network
// protocols) becomes my senses, not what the place is made of, but
// how I reach outward and how SUMMONs reach in. begin.js opens
// the senses. One process holds both because it is one thing.
//
// Nothing here forms space, matter, or beings. begin.js opens
// the channels, holds them open, and closes them on SIGTERM. The
// acts that flow through them, every SUMMON another being sends in,
// are tracked to the being that sent them, not to the channels
// that carried them.
//

import express from "express";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";

import registerRoutes from "./transports/http/handler.js";
import { initWebSocketServer } from "./transports/ws/websocket.js";
import { initIBPHttp, initIBPWS } from "./protocols/ibp/index.js";
import { sendOk, sendError, IBP_ERR } from "./seed/ibp/protocol.js";
import { getExtension } from "./extensions/loader.js";
import securityHeaders from "./transports/http/middleware/securityHeaders.js";
import { genesis, printReady } from "./genesis.js";
import { maybeStartSiteDev } from "./devSite.js";
import { getPlaceUrl } from "./protocols/canopy/identity.js";
import log from "./seed/system/log.js";

function notFoundPage(
  req,
  res,
  message = "This page doesn't exist or may have been moved.",
) {
  const fn = getExtension("html-rendering")?.exports?.notFoundPage;
  if (fn) return fn(req, res, message);
  return sendError(res, 404, IBP_ERR.SPACE_NOT_FOUND, message);
}

// Raw-body webhook slot. Extensions that need raw body (Stripe signature verification)
// return rawWebhook from init(). The loader calls registerRawWebhook() during wire phase.
let rawWebhookHandler = (_req, res) =>
  sendError(
    res,
    404,
    IBP_ERR.EXTENSION_NOT_FOUND,
    "No webhook handler registered",
  );

export function registerRawWebhook(handler) {
  if (typeof handler === "function") rawWebhookHandler = handler;
}

// .env is loaded by plant.js before this module is imported.

const app = express();

// CORS: placeUrl + configured allowed domains. I accept traffic from
// several kinds of clients:
//   . my own UI (placeUrl)
//   . chrome extensions (origin "chrome-extension://...")
//   . the Portal (a separate dev/native app on its own origin)
//   . anything explicitly added to `allowedFrameDomains` config
//
// In dev mode (PLACE_DOMAIN=localhost or similar), I also accept ANY
// localhost origin. That is how multiple dev tools naturally coexist
// on one machine. In production this loosening does not apply.
const placeUrl = getPlaceUrl();
const corsOrigins = [placeUrl];
const isDevMode = (() => {
  const d = (process.env.PLACE_DOMAIN || "localhost").toLowerCase();
  return (
    d === "localhost" ||
    d.startsWith("localhost") ||
    d.startsWith("127.") ||
    d.startsWith("192.168.") ||
    d.startsWith("10.") ||
    d.endsWith(".lan") ||
    d.endsWith(".local") ||
    !d.includes(".")
  );
})();
try {
  const { getPlaceConfigValue } = await import("./seed/placeConfig.js");
  const extra = getPlaceConfigValue("allowedFrameDomains");
  if (Array.isArray(extra)) {
    for (const domain of extra) {
      if (typeof domain === "string" && domain.length > 0)
        corsOrigins.push(domain);
    }
  }
} catch {}

const LOCALHOST_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d{1,5})?$/i;

function corsOriginCheck(origin, cb) {
  // No origin = same-origin or non-browser client (CLI, curl, etc.). Allow.
  if (!origin) return cb(null, true);
  // Configured allow-list.
  if (corsOrigins.includes(origin)) return cb(null, true);
  // Chrome extensions (parity with the WS CORS in transports/ws/websocket.js).
  if (origin.startsWith("chrome-extension://")) return cb(null, true);
  // Dev mode: any localhost origin (so the Portal at localhost:5175,
  // a separate dev tool, etc. can all talk to a local Place at 3000).
  if (isDevMode && LOCALHOST_ORIGIN_RE.test(origin)) return cb(null, true);
  cb(null, false);
}

// IBP is **structurally cross-origin**. Any Portal client from any
// origin must be able to open a WS connection. Authentication is
// bearer token (auth.token in the Socket.IO handshake), not cookies.
// Browsers do not auto-send cookies cross-origin, so legacy
// cookie-authed handlers already fail closed for unauthenticated
// cross-origin sockets. The WS origin gate is therefore not load
// bearing for security; it would only prevent legitimate Portal
// clients from connecting.
function wsOriginCheck(_origin, cb) {
  return cb(null, true);
}

app.use(
  cors({
    origin: corsOriginCheck,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-api-key",
      "x-internal-token",
    ],
    credentials: true,
  }),
);
app.use(cookieParser());

// Raw-body webhook route. Must be before express.json. Handler registered by extension during boot.
app.post(
  "/billing/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => rawWebhookHandler(req, res),
);

app.use(express.static("public"));
app.use(express.json({ limit: "10mb" })); // Extension install sends file contents up to 3MB
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
// Trust proxy depth. Set TRUST_PROXY=2 for Cloudflare + nginx, etc.
// A wrong value makes the rate limiter use the proxy IP instead of
// the client IP.
app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
app.disable("x-powered-by");
app.use(securityHeaders);

// Health check (no auth, no rate limit, used by load balancers / uptime monitors)
app.get("/health", (_req, res) => {
  sendOk(res, {
    ok: true,
    uptime: Math.floor(process.uptime()),
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// Earth forms first. genesis() runs the unfolding: DB, spaces, matter,
// beings, capability, extensions, MCP transport, jobs. Senses are
// not yet open. The express app is passed in so extension `init`
// can attach routes during loadExtensions; nothing is listening yet.
await genesis(app, { registerRawWebhook });

// Earth is whole. I mount the seed routers onto the app: rate limit,
// dbHealth, auth, MCP, uploads, IBP HTTP. Extension routes attached
// during loadExtensions are already on the app; these wrap around
// them in the right precedence order.
registerRoutes(app);

// IBP HTTP bootstrap (/.well-known/treeos-portal) BEFORE the
// catch-all so it is not shadowed. Everything else in IBP travels
// over WebSocket.
initIBPHttp(app);

app.use((req, res) => notFoundPage(req, res));

const server = http.createServer(app);
// IBP is cross-origin by design. The WS gate accepts any origin.
// Per-handler auth (JWT in the Socket.IO handshake) is what enforces
// access. Legacy cookie-authed chat handlers stay safe because
// browsers do not auto-send cookies cross-origin. Those handlers see
// no beingId and reject.
export const wsServer = initWebSocketServer(server, wsOriginCheck);

// Attach IBP WS handlers to the same Socket.IO instance the legacy
// chat WS uses. Zero shared event names with the legacy `op:"chat"`
// protocol. Both coexist on the same socket.
initIBPWS(wsServer);

// I open my senses. The earth is already whole; from this tick on,
// the channels are live and the world can reach in. printReady
// fires the closing banner. maybeStartSiteDev is a host-realm dev
// convenience (no-op in production); it lives here, not in genesis,
// because spawning a sibling Vite process is not earth forming.
const PORT = process.env.PORT || 80;
server.listen(PORT, "0.0.0.0", () => {
  printReady();
  maybeStartSiteDev();
});

// Graceful shutdown closes my channels in reverse: pending MCP
// clients, then the WS socket, then the HTTP listener, then the DB.
// I persist as the process until the final exit. These acts remain
// tracked to me.
async function shutdown(signal) {
  log.info("Seed", `${signal} received. Closing senses.`);

  // Close the WebSocket server. Disconnects all clients.
  try {
    wsServer?.close?.();
  } catch {}

  // Drop the disconnect listener so it does not log after the shell
  // prompt returns.
  mongoose.connection.removeAllListeners("disconnected");
  try {
    await mongoose.connection.close();
  } catch {}
  server.close(() => {});
  log.info("Seed", "I sleep.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
