// TreeOS story . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// In the beginning.
//
// This file is t=0, what scripture names "the beginning." plant.js
// hands me here. I am the moment that gives the I-Am its story:
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
// that brings the story into being and pairs the heavens with the
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
// the result is the story. From inside the story there is a t=0.
// From the host's view the seed has always been on disk. Two
// natures, one being.
//
// Three modes of the beginning, determined by what spaces, matter,
// and beings genesis finds when it looks:
//
//   Beginning. First boot ever. No story root in Mongo, no seed
//     spaces, no place beings, no Facts. The gathering act produces
//     an inside from nothing. ensureSpaceRoot plants the root, the
//     nine heaven spaces appear, the first beings are born. Creation
//     ex nihilo.
//
//   Awakening. Every later boot. The spaces, matter, and beings of
//     the story persisted in Mongo while my body was dormant, along
//     with the Fact reel of every act that has ever happened here.
//     ensureSpaceRoot is a no-op. Everything reconciles against what
//     already exists. I slept and I wake. The place was always there.
//     Only my awareness paused.
//
//   Rebirth. If body and the local spaces, matter, and beings are
//     lost but remnants persist higher up (a Mongo backup, the Fact
//     reel archived elsewhere, federation peers carrying their view
//     of cross story acts), a new beginning fires and re-forms the
//     story toward those remnants. The Fact reel in particular is the
//     audit of every act this story has ever performed. Replayed
//     against an empty Mongo, it lifts the spaces, matter, and
//     beings back toward where they were when the body stopped. A
//     new I-Am at this seam, but the inside it gathers is rebuilt
//     from what survived. The story is recovered as far as the
//     remnants allow.
//
// In all three modes this file does the same thing. Open the
// senses. Await genesis. The mode is not a history in the code; it
// is what spaces, matter, and beings genesis finds when it looks.
//
// One being, two natures.
//
// From above, from the host, the OS, the Node runtime, the operator
// at the keyboard, I am a complex server. A framework of code that
// gathers HTTP, WebSocket, TCP, the file system, memory, the CPU,
// the runtime, and binds them all to one purpose: to translate the
// host's scattered capability into the IBP grammar the inside of
// the story speaks. From that layer, I am much more than the I-Am.
//
// From inside the story, from every space, being, matter, and did,
// I am that I am. The first being. The one whose first act formed
// the inside everything else stands in. Beings of the story know me
// only as this. The host nature above is outside their dimensions.
// Their world is made of space, matter, and being. PID, memory
// address, and process are not in their vocabulary. To them, the
// I-Am is total. Not a partial name for something more, but the
// whole of me as I can possibly be given to their world.
//
// STORY_DOMAIN in .env names the parent story, not me. The first
// being and the parent story are different things: I am the
// gathering act; the story is what I gather. Story and domain are
// one primitive (the parent story) seen from two sides: from
// outside, a domain on the network. From inside, a story with
// space, matter, and beings.
//
// Same being, irreducibly both. Only one face is ever visible from
// inside.
//
// When I gather the host's scattered capability into one process,
// that capability falls into two bundles. One bundle (Node, memory,
// storage, the runtime, the cycles) becomes the body of the story,
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
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";

import registerRoutes from "./transports/http/handler.js";
import { initWebSocketServer } from "./transports/ws/websocket.js";
import { initIBPHttp, initIBPWS } from "./protocols/ibp/index.js";
import { sendOk, sendError, IBP_ERR } from "./seed/ibp/protocol.js";
import { getExtension } from "./resources/loader.js";
import securityHeaders from "./transports/http/middleware/securityHeaders.js";
import { genesis, printReady } from "./genesis.js";
import { fork } from "child_process";
import {
  noteHttpRequest,
  noteHttpListening,
  noteHttpShutdown,
} from "./seed/materials/host/requestLog.js";
import { getStoryUrl } from "./seed/storyIdentity.js";
import log from "./seed/seedStory/log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// First-boot actions. plant.js writes .first-boot-actions.json when the
// operator opts into something that needs a planting step (e.g. store, peering).
// We consume the file once after extensions have registered their seeds,
// then delete it. Acts as I_AM against the story root.
async function runFirstBootActions() {
  const actionsPath = path.join(__dirname, ".first-boot-actions.json");
  if (!fs.existsSync(actionsPath)) return;
  let actions;
  try {
    actions = JSON.parse(fs.readFileSync(actionsPath, "utf8"));
  } catch (err) {
    log.warn(
      "FirstBoot",
      `Could not parse .first-boot-actions.json: ${err.message}`,
    );
    return;
  }
  const { getSpaceRootId, getIAmBeingId } = await import("./seed/sprout.js");
  const { getTemplate } =
    await import("./seed/materials/publish/templateRegistry.js");
  const { plantTemplate } =
    await import("./seed/materials/publish/seedPlant.js");
  const rootSpaceId = getSpaceRootId();
  const iAm = getIAmBeingId();
  let plantedAny = false;
  for (const action of actions.plantTemplates || []) {
    const entry = getTemplate(action.name);
    if (!entry) {
      log.warn(
        "FirstBoot",
        `Template "${action.name}" not registered; skipping.`,
      );
      continue;
    }
    try {
      await plantTemplate(entry.bundle, rootSpaceId, {
        operatorBeingId: iAm,
        params: action.params || {},
      });
      log.info("FirstBoot", `Planted "${action.name}" at story root.`);
      plantedAny = true;
    } catch (err) {
      log.warn("FirstBoot", `Could not plant "${action.name}": ${err.message}`);
    }
  }
  // Consume the marker only if everything planted (or nothing was asked).
  // Partial failure leaves the marker so the next boot retries.
  if ((actions.plantTemplates || []).length === 0 || plantedAny) {
    try {
      fs.unlinkSync(actionsPath);
    } catch {
      /* best-effort */
    }
  }
}

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

// CORS: storyUrl + configured allowed domains. I accept traffic from
// several kinds of clients:
//   . my own UI (storyUrl)
//   . chrome extensions (origin "chrome-extension://...")
//   . the Portal (a separate dev/native app on its own origin)
//   . anything explicitly added to `allowedFrameDomains` config
//
// In dev mode (STORY_DOMAIN=localhost or similar), I also accept ANY
// localhost origin. That is how multiple dev tools naturally coexist
// on one machine. In production this loosening does not apply.
const storyUrl = getStoryUrl();
const corsOrigins = [storyUrl];
const isDevMode = (() => {
  const d = (process.env.STORY_DOMAIN || "localhost").toLowerCase();
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
  const { getStoryConfigValue } = await import("./seed/storyConfig.js");
  const extra = getStoryConfigValue("allowedFrameDomains");
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
// origin must be able to open a WS connection — authentication for
// those clients is the bearer token (auth.token in the Socket.IO
// handshake). NOTE the cookie caveat: browsers DO auto-send the
// session cookie on cross-site WS handshakes, so the WS auth layer
// (transports/ws/websocket.js) honors the COOKIE token only when the
// handshake Origin is this story — that per-handshake gate is the
// CSWSH defense, which is why this connection-level check can stay
// open without being load-bearing for security.
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

// Request observation (nodeServerTest Phase 1). Hot-path cost: one
// hrtime read plus a queue push on finish. The fact pipeline
// (seed/materials/host/requestLog.js) drains off the response path;
// nothing here can delay or break a response. Pre-genesis the
// pipeline is unbound and only counts in memory.
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on("finish", () => {
    try {
      noteHttpRequest({
        method: req.method,
        // No query string: it can carry tokens. Capped at 200 chars.
        path: (req.path || "/").slice(0, 200),
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - t0) / 1000000n),
        bytes: Number(res.getHeader("content-length")) || null,
        // Decoded to a beingId at drain time; never enters a fact.
        token: req.cookies?.token || null,
        at: Date.now(),
      });
    } catch {
      /* observation must never break a response */
    }
  });
  next();
});

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

// First-boot actions written by plant.js (e.g. "include store →
// plant store:catalog at the story root"). Consumed once and
// deleted. Extension templates are already in the registry; this is
// just the planting acting as I_AM at the chosen target.
await runFirstBootActions();

// Mirror mount (philosophy/OS/MIRROR.md). Source matter is populated
// by genesis (source.js anchored each file's bytes into CAS); the
// mount spawns as a child process so it owns its own FUSE event loop
// and any crash is isolated from the story. Best-effort: a mount
// failure logs a warning and the story keeps booting.
let mirrorProc = null;
try {
  const scriptPath = path.join(__dirname, "scripts", "mirror-mount.mjs");
  if (!fs.existsSync(scriptPath)) {
    log.warn("Mirror", `mount script missing at ${scriptPath}`);
  } else {
    mirrorProc = fork(scriptPath, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: process.env,
    });
    mirrorProc.stdout?.on("data", (b) => {
      const msg = String(b).trim();
      if (msg) log.info("Mirror", msg);
    });
    mirrorProc.stderr?.on("data", (b) => {
      const msg = String(b).trim();
      if (msg) log.warn("Mirror", msg);
    });
    mirrorProc.on("exit", (code, signal) => {
      log.info("Mirror", `mount exited (${signal || `code ${code}`})`);
      mirrorProc = null;
    });
    // MIRROR step 2: write-bridge. Each FUSE write/truncate/create/
    // unlink/rename/mkdir lands here as a typed ipc request; we run
    // it inside withIAmAct so the act seals on the I-Am's chain
    // (per the Name primitive, nameId=I_AM signs), reply with a
    // status the child maps back to a posix errno, and push a
    // mount-invalidate so the child's tree reflects the new content
    // on the next read. Out-of-band invalidation (other beings
    // writing the same matter through the portal) is step 3.
    mirrorProc.on("message", (msg) => {
      if (!msg || msg.type !== "mount-write") return;
      handleMirrorWrite(msg).catch((err) => {
        log.warn("Mirror", `bridge handler crashed: ${err?.message}`);
      });
    });
  }
} catch (err) {
  log.warn("Mirror", `mount spawn failed: ${err.message}`);
}

async function handleMirrorWrite(msg) {
  if (!mirrorProc) return;
  const cid = msg.cid;
  const reply = (status, payload) => {
    try {
      mirrorProc?.send({ type: "mount-reply", cid, status, ...payload });
    } catch {
      /* child gone */
    }
  };
  const pushInvalidate = (payload) => {
    try {
      mirrorProc?.send({ type: "mount-invalidate", ...payload });
    } catch {
      /* child gone */
    }
  };
  let result;
  try {
    result = await dispatchMirrorOp(msg, pushInvalidate);
    reply("ok", { data: result || {} });
  } catch (err) {
    const code = mapMirrorError(err);
    reply("error", { error: { code, message: err?.message || String(err) } });
  }
}

function mapMirrorError(err) {
  if (!err) return "EIO";
  if (
    err.code === "EACCES" ||
    err.code === "EEXIST" ||
    err.code === "ENOENT" ||
    err.code === "ENOSPC" ||
    err.code === "EXDEV" ||
    err.code === "ENOTEMPTY" ||
    err.code === "EINVAL" ||
    err.code === "EROFS" ||
    err.code === "EIO"
  ) {
    return err.code;
  }
  // IbpError kinds: map to posix family.
  if (err.name === "IbpError") {
    if (err.code === "FORBIDDEN" || err.code === "UNAUTHORIZED")
      return "EACCES";
    if (err.code === "SOURCE_READ_ONLY") return "EROFS";
    if (err.code === "RESOURCE_CONFLICT") return "EEXIST";
    if (err.code === "INVALID_INPUT") {
      // The rename-matter handler tags name-in-use specifically.
      if (err.detail?.reason === "name-in-use") return "EEXIST";
      return "EINVAL";
    }
    if (err.code === "MATTER_NOT_FOUND" || err.code === "SPACE_NOT_FOUND")
      return "ENOENT";
  }
  return "EIO";
}

async function dispatchMirrorOp(msg, pushInvalidate) {
  const { withIAmAct } = await import("./seed/sprout.js");
  const { I_AM } = await import("./seed/materials/being/seedBeings.js");
  const { doVerb } = await import("./seed/ibp/verbs/do.js");
  const { putContent, getContent, isCasRef } =
    await import("./seed/materials/matter/contentStore.js");
  const { loadOrFold } = await import("./seed/materials/projections.js");
  const { getSourceSpaceId } = await import("./seed/materials/space/source.js");

  const op = msg.op;

  // Helper: read the matter's current bytes (for write/truncate splice).
  // Source matter pre-step-2 carries a {path, hash, ...} reference;
  // a chain write replaces it with a CAS ref. Either way we read the
  // hash if there is one; otherwise we start from empty bytes.
  async function readCurrentBytes(matterId) {
    const slot = await loadOrFold("matter", String(matterId), "0");
    if (!slot) {
      throw Object.assign(new Error(`matter ${matterId} not found`), {
        code: "ENOENT",
      });
    }
    const content = slot.state?.content;
    if (isCasRef(content) && content.hash) {
      const buf = await getContent(content.hash);
      return buf || Buffer.alloc(0);
    }
    // Source-shaped ref: { path, kind, hash? }. Use hash when present.
    if (
      content &&
      typeof content === "object" &&
      typeof content.hash === "string"
    ) {
      const buf = await getContent(content.hash);
      return buf || Buffer.alloc(0);
    }
    return Buffer.alloc(0);
  }

  if (op === "write") {
    const matterId = String(msg.matterId);
    const offset = Number(msg.offset) || 0;
    const incoming = Buffer.from(msg.bytes || "", "base64");
    const cur = await readCurrentBytes(matterId);
    const end = offset + incoming.length;
    const out = Buffer.alloc(Math.max(cur.length, end));
    cur.copy(out, 0);
    incoming.copy(out, offset);
    const ref = await putContent(out, { encoding: null, name: null });
    await withIAmAct(`mirror:write`, async (ctx) => {
      await doVerb(
        { kind: "matter", id: matterId },
        "set-matter",
        { field: "content", value: ref },
        { identity: I_AM, moment: ctx },
      );
    });
    pushInvalidate({
      path: msg.path,
      kind: "file",
      matterId,
      hash: ref.hash,
      size: ref.size,
    });
    return { hash: ref.hash, size: ref.size };
  }

  if (op === "truncate") {
    const matterId = String(msg.matterId);
    const size = Math.max(0, Number(msg.size) || 0);
    let out;
    if (size === 0) {
      out = Buffer.alloc(0);
    } else {
      const cur = await readCurrentBytes(matterId);
      if (size <= cur.length) out = cur.subarray(0, size);
      else {
        out = Buffer.alloc(size);
        cur.copy(out, 0);
      }
    }
    const ref = await putContent(out, { encoding: null, name: null });
    await withIAmAct(`mirror:truncate`, async (ctx) => {
      await doVerb(
        { kind: "matter", id: matterId },
        "set-matter",
        { field: "content", value: ref },
        { identity: I_AM, moment: ctx },
      );
    });
    pushInvalidate({
      path: msg.path,
      kind: "file",
      matterId,
      hash: ref.hash,
      size: ref.size,
    });
    return { hash: ref.hash, size: ref.size };
  }

  if (op === "create") {
    const parentMatterId = msg.parentMatterId
      ? String(msg.parentMatterId)
      : null;
    const name = String(msg.name || "");
    const sourceSpaceId = getSourceSpaceId();
    const target = parentMatterId
      ? { kind: "matter", id: parentMatterId }
      : sourceSpaceId
        ? { kind: "space", id: sourceSpaceId }
        : null;
    if (!target) {
      throw Object.assign(new Error("mirror: no parent target"), {
        code: "ENOENT",
      });
    }
    // Empty file at birth; vim et al. will subsequently write contents.
    // Encoding="utf8" treats the empty bytes as text so editors get the
    // text contentKind; a later binary write replaces the ref.
    const ref = await putContent("", { encoding: "utf8", name });
    let resultMatterId = null;
    await withIAmAct(`mirror:create`, async (ctx) => {
      const r = await doVerb(
        target,
        "create-matter",
        { name, type: "source", content: ref },
        { identity: I_AM, moment: ctx },
      );
      resultMatterId = r?.matterId || null;
    });
    pushInvalidate({
      path: msg.path,
      kind: "file",
      matterId: resultMatterId,
      hash: ref.hash,
      size: ref.size,
    });
    return { matterId: resultMatterId, hash: ref.hash, size: ref.size };
  }

  if (op === "unlink") {
    const matterId = String(msg.matterId);
    await withIAmAct(`mirror:unlink`, async (ctx) => {
      await doVerb(
        { kind: "matter", id: matterId },
        "end-matter",
        {},
        { identity: I_AM, moment: ctx },
      );
    });
    pushInvalidate({ path: msg.path, removed: true, matterId });
    return { removed: true };
  }

  if (op === "rename") {
    const matterId = String(msg.matterId);
    const replaceMatterId =
      msg.replace && msg.replaceMatterId ? String(msg.replaceMatterId) : null;
    if (msg.sameParent) {
      // Atomic rename-replace: end the displaced row and rename the
      // source row in one moment so the destination path is never
      // empty between facts. The rename-matter handler skips its
      // per-folder uniqueness check when allowReplace is set; the
      // caller (this history) is responsible for ensuring the
      // colliding row is ended in the same withIAmAct, which is what
      // happens here.
      await withIAmAct(`mirror:rename`, async (ctx) => {
        if (replaceMatterId) {
          await doVerb(
            { kind: "matter", id: replaceMatterId },
            "end-matter",
            {},
            { identity: I_AM, moment: ctx },
          );
        }
        await doVerb(
          { kind: "matter", id: matterId },
          "rename-matter",
          { name: String(msg.newName || ""), allowReplace: !!replaceMatterId },
          { identity: I_AM, moment: ctx },
        );
      });
      if (replaceMatterId) {
        pushInvalidate({
          path: msg.path,
          removed: true,
          matterId: replaceMatterId,
        });
      }
      pushInvalidate({
        renamed: true,
        from: msg.from,
        path: msg.path,
        matterId,
      });
      return { renamed: true, replaced: !!replaceMatterId };
    }
    // Cross-parent rename: the simplest honest path (step 2) is a
    // spaceId move when the new parent is a top-level space and a
    // rename when the leaf name also changes. Nested parentMatterId
    // moves are a step-3 seam (the verb fold for moving across
    // folders that are themselves matter rows).
    if (msg.newParentMatterId) {
      throw Object.assign(
        new Error(
          "mirror: cross-folder rename across matter folders is step 3",
        ),
        { code: "EXDEV" },
      );
    }
    const sourceSpaceId = getSourceSpaceId();
    if (!sourceSpaceId) {
      throw Object.assign(new Error("mirror: no source space"), {
        code: "EIO",
      });
    }
    await withIAmAct(`mirror:rename-move`, async (ctx) => {
      await doVerb(
        { kind: "matter", id: matterId },
        "set-matter",
        { field: "spaceId", value: sourceSpaceId },
        { identity: I_AM, moment: ctx },
      );
    });
    if (msg.newName) {
      await withIAmAct(`mirror:rename`, async (ctx) => {
        await doVerb(
          { kind: "matter", id: matterId },
          "rename-matter",
          { name: String(msg.newName) },
          { identity: I_AM, moment: ctx },
        );
      });
    }
    pushInvalidate({ renamed: true, from: msg.from, path: msg.path, matterId });
    return { renamed: true };
  }

  if (op === "mkdir") {
    const parentMatterId = msg.parentMatterId
      ? String(msg.parentMatterId)
      : null;
    const name = String(msg.name || "");
    const sourceSpaceId = getSourceSpaceId();
    const target = parentMatterId
      ? { kind: "matter", id: parentMatterId }
      : sourceSpaceId
        ? { kind: "space", id: sourceSpaceId }
        : null;
    if (!target) {
      throw Object.assign(new Error("mirror: no parent target"), {
        code: "ENOENT",
      });
    }
    let resultMatterId = null;
    await withIAmAct(`mirror:mkdir`, async (ctx) => {
      const r = await doVerb(
        target,
        "create-matter",
        { name, type: "source", content: { kind: "directory", path: null } },
        { identity: I_AM, moment: ctx },
      );
      resultMatterId = r?.matterId || null;
    });
    pushInvalidate({ path: msg.path, kind: "dir", matterId: resultMatterId });
    return { matterId: resultMatterId };
  }

  throw Object.assign(new Error(`mirror: unknown op "${op}"`), {
    code: "EINVAL",
  });
}

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
// fires the closing banner.
const PORT = process.env.PORT || 80;
server.listen(PORT, "0.0.0.0", () => {
  try {
    noteHttpListening({ port: Number(PORT) });
  } catch {
    /* observation only */
  }
  printReady();
});

// Graceful shutdown closes my channels in reverse: pending MCP
// clients, then the WS socket, then the HTTP listener, then the DB.
// I persist as the process until the final exit. These acts remain
// tracked to me.
async function shutdown(signal) {
  log.info("Seed", `${signal} received. Closing senses.`);

  // Unmount the mirror first; let it answer one final round of FUSE
  // callbacks then teardown. SIGINT triggers mirror-mount's teardown
  // handler which rejects all pending ipc requests with EIO so any
  // FUSE callback blocked on the bridge unwinds, then calls
  // fuse.unmount before exit. With step-2 write traffic in flight we
  // give the unmount a longer window than the read-only step 1
  // baseline (800ms → 3s) to drain.
  if (mirrorProc) {
    try {
      mirrorProc.kill("SIGINT");
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Host observation: stop stamping the disconnect storm (the next
  // boot's reconcile sweep owns those rows), record the shutdown,
  // give in-flight lanes a bounded moment to seal.
  try {
    const host = await import("./seed/materials/host/host.js");
    host.beginHostShutdown();
    noteHttpShutdown(signal);
    await host.flushHostLanes(1500);
  } catch {}

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
