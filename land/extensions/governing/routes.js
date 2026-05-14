// governing extension routes.
//
// Mounted at /api/v1/*. Phase F absorbed the plan extension into
// governing; the dashboard's plan panel route lives here too.
//
// Routes:
//   GET  /api/v1/governing/plan/:nodeId/panel.html    plan panel fragment
//   GET  /api/v1/governing/plan/:nodeId               plan node identity
//   GET  /api/v1/root/:rootId/governance              dashboard page (HTML)
//   GET  /api/v1/root/:rootId/governance/stream       SSE live-update stream

import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { getExtension } from "../loader.js";
import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";
import { readPlan } from "./state/planNode.js";
import { renderPlanPanel } from "./pages/planPanel.js";
import { renderDashboardPage } from "./pages/dashboard.js";

const router = express.Router();

// htmlAuth resolves after boot to html-rendering's urlAuth (accepts
// cookies + URL share tokens). The dashboard page loads in the
// dashboard iframe with a token query param; the standard Bearer
// authenticate middleware doesn't accept that. Falls back to
// Bearer authenticate if html-rendering isn't installed.
let htmlAuth = authenticate;
export function resolveHtmlAuth() {
  const htmlExt = getExtension("html-rendering");
  if (htmlExt?.exports?.urlAuth) htmlAuth = htmlExt.exports.urlAuth;
}

// ─────────────────────────────────────────────────────────────────────
// SSE BROADCAST INFRASTRUCTURE
//
// rootId → Set<Response>. Subscribers are dashboard pages with the
// SSE stream open. broadcastGovernanceUpdate(rootId, reason) writes
// an update frame to every subscriber of that rootId.
//
// Hooks in governing/index.js's init() call broadcastGovernanceUpdate
// after resolving the affected node up to its root. The dashboard
// page's client-side bootstrap script refetches its HTML fragment on
// each update event and replaces the DOM.
// ─────────────────────────────────────────────────────────────────────

const dashboardSubscribers = new Map();

export function broadcastGovernanceUpdate(rootId, reason) {
  const set = dashboardSubscribers.get(String(rootId));
  if (!set || set.size === 0) return 0;
  const frame = `event: update\ndata: ${JSON.stringify({ reason, at: new Date().toISOString() })}\n\n`;
  let delivered = 0;
  for (const res of set) {
    try { res.write(frame); delivered++; } catch {}
  }
  return delivered;
}

function subscribeDashboard(rootId, res) {
  const key = String(rootId);
  let set = dashboardSubscribers.get(key);
  if (!set) { set = new Set(); dashboardSubscribers.set(key, set); }
  set.add(res);
  return function unsubscribe() {
    set.delete(res);
    if (set.size === 0) dashboardSubscribers.delete(key);
  };
}

// ─────────────────────────────────────────────────────────────────────
// EXISTING PLAN PANEL ROUTES (unchanged from prior pass)
// ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/governing/plan/:nodeId/panel.html
 * Server-rendered HTML fragment of the plan panel for this plan-type
 * node. Slot placeholder fetches and swaps it in.
 */
router.get("/governing/plan/:nodeId/panel.html", authenticate, async (req, res) => {
  try {
    const node = await Node.findById(req.params.nodeId).lean();
    if (!node) return res.status(404).send("");
    const qs = req.query.token ? `?token=${encodeURIComponent(req.query.token)}` : "";
    const out = await renderPlanPanel({
      node,
      nodeId: String(node._id),
      qs,
      isPublicAccess: !!req.query.share || !!req.query.publicShare,
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(out || "");
  } catch (err) {
    res.status(500).send(`<!-- governing plan panel error: ${err.message} -->`);
  }
});

/**
 * GET /api/v1/governing/plan/:nodeId
 * Read the plan-type node's identity. For diagnostic / audit views.
 * The active plan content lives on plan-emission-N children.
 */
router.get("/governing/plan/:nodeId", authenticate, async (req, res) => {
  try {
    const plan = await readPlan(req.params.nodeId);
    return sendOk(res, { plan });
  } catch (err) {
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ─────────────────────────────────────────────────────────────────────
// GOVERNANCE DASHBOARD
// ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/root/:rootId/governance
 * Server-rendered HTML page consolidating the full rulership tree at
 * this root onto one observational surface. Loads in the dashboard
 * iframe alongside the chat panel.
 *
 * Query params:
 *   inApp=1     suppress chat-bar duplication (page loaded inside the
 *               dashboard shell which already has chat). Always set
 *               when the iframe loads it.
 *   fragment=1  return just the main container's HTML, no chrome
 *               (used by the client bootstrap script after SSE update
 *               events for in-place DOM swap).
 *   token=...   URL-auth token; html-rendering's urlAuth accepts it.
 */
router.get("/root/:rootId/governance", (req, res, next) => htmlAuth(req, res, next), async (req, res) => {
  try {
    const { rootId } = req.params;
    const inApp = req.query.inApp === "1" || req.query.inApp === "true";
    const fragment = req.query.fragment === "1" || req.query.fragment === "true";
    const html = await renderDashboardPage({ req, rootId, inApp, fragment });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    log.warn("Governing/Dashboard", `render failed: ${err.message}`);
    res.status(500).send(
      `<!doctype html><html><body><h1>Governance dashboard error</h1>` +
      `<pre>${String(err.message).replace(/</g, "&lt;")}</pre></body></html>`,
    );
  }
});

/**
 * GET /api/v1/root/:rootId/governance/stream
 * Server-Sent Events stream. The dashboard page opens this on load
 * and refetches its HTML fragment on each `update` event. Keepalive
 * comment every 25s prevents proxy idle-timeout drops.
 */
router.get("/root/:rootId/governance/stream", (req, res, next) => htmlAuth(req, res, next), async (req, res) => {
  const { rootId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // CORS-safe for same-origin iframe; nothing special needed.
  res.flushHeaders?.();
  // First frame: tell the client it's connected. Client treats this
  // as a no-op (doesn't trigger refresh) since the page just loaded
  // with fresh data.
  res.write(`event: open\ndata: connected\n\n`);
  const unsubscribe = subscribeDashboard(rootId, res);
  const keepalive = setInterval(() => {
    try { res.write(`: keepalive\n\n`); } catch {}
  }, 25000);
  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});

export default router;
