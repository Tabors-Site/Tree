/**
 * Active cascade — session watcher + nudge primitives.
 *
 * The passive cascade system (signalInbox on metadata + enrichContext
 * pulling it once per turn) already delivers signals eventually. What's
 * missing is CROSS-SESSION AWARENESS: when session A writes a signal
 * targeted at session B's subtree, B should notice it between turns
 * AND see it prominently in its next enrichContext as "new since your
 * last look", not buried in the history block.
 *
 * This module owns:
 *   1. A reverse index `nodeId → Set<sessionId>` populated when a
 *      session's enrichContext fires for a project or branch node
 *      (which means that session is actively working at that position)
 *   2. `notifySignal(targetNodeId)` — iterate live watchers, pull each
 *      one's cached ancestor chain, flag any whose chain contains the
 *      write's target node. The walk is O(watchers × depth), not
 *      O(subtree descendants)
 *   3. `partitionCascaded(signals, watermark)` — split signalInbox
 *      into {fresh, seen} by comparing signal timestamps to the session's
 *      `lastSeenCascadedAt` watermark
 *   4. `formatFreshBanner(fresh)` — render fresh signals as a prominent
 *      "🔔 NEW SIGNALS since your last turn" block that sits ABOVE the
 *      normal signalInbox block in the AI's prompt
 *   5. `maybeApplyCascadeNudge({ sessionId })` — called from the
 *      orchestrator's continuation loop between turns; logs the nudge
 *      if the flag is set and returns a bool so callers can branch on it
 *   6. `dumpContextForSession(sessionId, core, { dryRun })` — re-runs
 *      the real enrichContext hook pipeline and returns the assembled
 *      context object. `dryRun: true` (default) skips the watermark
 *      advance so the operator can inspect state without mutating it.
 *      The orchestrator's real path passes `dryRun: false` to advance
 *      the watermark after a successful render.
 *
 * Design non-goals (intentional):
 *   - No websocket round-trip. The orchestrator runs in the same process
 *     as afterNote, so a Map write + boolean flag is the entire transport.
 *   - No kernel changes. Session tracking lives in session.meta via the
 *     existing updateSessionMeta / getSession API.
 *   - No abort-and-restart mid-turn. If B is waiting on a 30s LLM call,
 *     B sees the nudge after the call completes, before the next one
 *     begins. Aborting mid-stream loses work.
 *   - No general-purpose watcher system. Keyed by project-level nodeIds
 *     under code-workspace. Other extensions build their own if they
 *     need it.
 */

import log from "../../seed/log.js";

// ─────────────────────────────────────────────────────────────────────
// REVERSE INDEX
// ─────────────────────────────────────────────────────────────────────

/**
 * nodeId → Set<sessionId>
 *
 * Each session registers under ONE node at a time (the project or
 * branch it's currently working on). Re-registration updates both
 * the nodeId → session set AND the session → nodeId pointer so
 * unregister is O(1).
 */
const watchersByNode = new Map();

/**
 * sessionId → { nodeId, projectId, registeredAt }
 *
 * Reverse pointer so unregisterWatcher can find the set entry to
 * remove without scanning every bucket.
 */
const sessionsByWatcher = new Map();

/**
 * Register that `sessionId` is currently working at `nodeId` (inside
 * project `projectId`). Called from code-workspace's enrichContext
 * handler every time a project or branch node gets enriched, which is
 * the natural "session is active here" signal.
 *
 * Safe to call repeatedly; replaces any prior registration for the
 * same session.
 */
export function registerWatcher(sessionId, nodeId, projectId = null) {
  if (!sessionId || !nodeId) return;
  sessionId = String(sessionId);
  nodeId = String(nodeId);

  // If this session was previously registered at a different node,
  // remove the old entry from that node's set.
  const prior = sessionsByWatcher.get(sessionId);
  if (prior && prior.nodeId !== nodeId) {
    const priorSet = watchersByNode.get(prior.nodeId);
    if (priorSet) {
      priorSet.delete(sessionId);
      if (priorSet.size === 0) watchersByNode.delete(prior.nodeId);
    }
  }

  // Register at the new node
  let set = watchersByNode.get(nodeId);
  if (!set) {
    set = new Set();
    watchersByNode.set(nodeId, set);
  }
  set.add(sessionId);
  sessionsByWatcher.set(sessionId, {
    nodeId,
    projectId: projectId ? String(projectId) : null,
    registeredAt: Date.now(),
  });
}

/**
 * Remove a session from the reverse index. Called from the
 * afterSessionEnd hook so dead sessions don't accumulate as phantom
 * watchers.
 */
export function unregisterWatcher(sessionId) {
  if (!sessionId) return;
  sessionId = String(sessionId);
  const entry = sessionsByWatcher.get(sessionId);
  if (!entry) return;
  const set = watchersByNode.get(entry.nodeId);
  if (set) {
    set.delete(sessionId);
    if (set.size === 0) watchersByNode.delete(entry.nodeId);
  }
  sessionsByWatcher.delete(sessionId);
}

/**
 * Return the current watcher count. Diagnostic; callers should treat
 * `0` as "skip the walk entirely" — no one is listening so notifying
 * anything is a no-op.
 */
export function watcherCount() {
  return sessionsByWatcher.size;
}

/**
 * Return a snapshot of every watcher for an operator-level debug view.
 * Not used in the hot path.
 */
export function snapshotWatchers() {
  const out = [];
  for (const [sessionId, entry] of sessionsByWatcher.entries()) {
    out.push({
      sessionId,
      nodeId: entry.nodeId,
      projectId: entry.projectId,
      registeredAt: entry.registeredAt,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// NOTIFY
// ─────────────────────────────────────────────────────────────────────

/**
 * A signal just landed on `targetNodeId`. Find every live watcher whose
 * active node's ancestor chain contains `targetNodeId`, and flag their
 * session meta with `nudgeFlag: true + nudgeAt: now`.
 *
 * The walk is INVERTED: we don't crawl the subtree of targetNodeId
 * (O(descendants)). We iterate the watchers (usually 1–10) and for
 * each, check if targetNodeId appears in their cached ancestor chain.
 * Siblings fall out naturally — they share an ancestor with target.
 *
 * Cheap short-circuit: if there are zero watchers, return without
 * touching anything. Zero cost for solo mode.
 *
 * Best-effort: every failure path is caught and logged. This function
 * MUST NOT throw into the hook chain.
 */
export async function notifySignal(targetNodeId, { reason = null } = {}) {
  if (!targetNodeId || sessionsByWatcher.size === 0) return;
  const target = String(targetNodeId);

  try {
    const [{ getAncestorChain }, { updateSessionMeta, getSession }] = await Promise.all([
      import("../../seed/tree/ancestorCache.js"),
      import("../../seed/ws/sessionRegistry.js"),
    ]);

    let nudged = 0;
    for (const [sessionId, entry] of sessionsByWatcher.entries()) {
      try {
        // A session is ALWAYS relevant to a signal on its own node
        // (no ancestor walk needed). Short-circuit.
        const watcherNode = entry.nodeId;
        let isAncestor = watcherNode === target;

        if (!isAncestor) {
          // Walk the watcher's ancestor chain and check if target is in it.
          // If the signal landed on an ancestor of the watcher's position,
          // the watcher cares.
          const chain = await getAncestorChain(watcherNode);
          if (Array.isArray(chain)) {
            isAncestor = chain.some((a) => String(a._id) === target);
          }
        }

        if (!isAncestor) continue;

        // Set the nudge flag on the session's meta so the continuation
        // loop sees it next iteration. Don't touch lastSeenCascadedAt —
        // that's advanced ONLY after a successful render of the fresh
        // banner in enrichContext.
        const sess = getSession(sessionId);
        if (!sess) {
          // Dead session — unregister to prevent accumulating stale
          // watchers after a crash
          unregisterWatcher(sessionId);
          continue;
        }
        const prev = sess.meta?.codeWorkspace || {};
        updateSessionMeta(sessionId, {
          codeWorkspace: {
            ...prev,
            nudgeFlag: true,
            nudgeAt: Date.now(),
            nudgeReason: reason || prev.nudgeReason || null,
          },
        });
        nudged++;
      } catch (perSessionErr) {
        log.warn(
          "CodeWorkspace",
          `notifySignal: per-session failure for ${sessionId.slice(0, 8)}: ${perSessionErr.message}`,
        );
      }
    }

    if (nudged > 0) {
      log.info(
        "CodeWorkspace",
        `🌊 active cascade: nudged ${nudged} session(s) from signal on ${target.slice(0, 8)}${reason ? ` (${reason})` : ""}`,
      );
    }
  } catch (err) {
    log.warn("CodeWorkspace", `notifySignal failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// WATERMARK + PARTITION
// ─────────────────────────────────────────────────────────────────────

/**
 * Split a signalInbox signal array into fresh (arrived after the
 * session's last watermark) and seen (everything else). Used by the
 * enrichContext handler to render fresh signals in a prominent banner
 * and stale signals in the normal block.
 *
 * The watermark is a millisecond timestamp stored in session meta as
 * `codeWorkspace.lastSeenCascadedAt`. Signals whose `at` field is
 * strictly greater than the watermark are "fresh".
 *
 * If the watermark is null/undefined (first render of this session),
 * everything is "seen" — we don't want to show the whole history as
 * a fresh-signal banner on first contact.
 */
export function partitionCascaded(signals, watermark) {
  if (!Array.isArray(signals) || signals.length === 0) {
    return { fresh: [], seen: [] };
  }
  if (!watermark) {
    return { fresh: [], seen: signals };
  }
  const fresh = [];
  const seen = [];
  for (const s of signals) {
    const at = s?.at;
    if (!at) {
      seen.push(s);
      continue;
    }
    const atMs = typeof at === "number" ? at : Date.parse(at);
    if (Number.isFinite(atMs) && atMs > watermark) {
      fresh.push(s);
    } else {
      seen.push(s);
    }
  }
  return { fresh, seen };
}

/**
 * Format a list of fresh signals into a prominent banner block for
 * the AI's next turn. Shown ABOVE the normal signalInbox block
 * with clear "just arrived" framing so the model actively addresses
 * the new information instead of burying it.
 *
 * Each fresh signal gets a one-line summary keyed by kind:
 *   🔴 syntax-error in server.js:42 — Unexpected token '}'
 *   👻 dead-receiver player.id — never assigned
 *   🔗 contract-mismatch POST /api/login — expected sessionId, got sessionToken
 *   📜 contract — backend declared POST /api/health
 *   🔴 probe-failure POST /api/auth/register → 500
 *   🧪 test-failure tests/spec.test.js — user can register
 *   💥 runtime-error server.js:55 — Cannot find module 'ws'
 *
 * Caller merges this into `context.swarmFreshSignals` which the mode's
 * system prompt renders near the top.
 */
export function formatFreshBanner(fresh) {
  if (!Array.isArray(fresh) || fresh.length === 0) return null;
  const lines = [
    "## 🔔 NEW SIGNALS SINCE YOUR LAST TURN",
    "",
    "These arrived while you were working. Read them FIRST — something",
    "changed in the project that may affect what you're about to do.",
    "",
  ];

  for (const s of fresh.slice(0, 10)) {
    const from = s.from ? `[${s.from}]` : "";
    const kind = s.kind || "signal";
    const file = s.filePath ? ` ${s.filePath}` : "";
    const p = s.payload || {};

    switch (kind) {
      case "syntax-error": {
        const line = p.line ? `:${p.line}` : "";
        const msg = p.message ? ` — ${String(p.message).slice(0, 100)}` : "";
        lines.push(`🔴 ${kind}${file}${line}${msg} ${from}`);
        break;
      }
      case "dead-receiver": {
        const msg = p.message ? ` — ${String(p.message).slice(0, 100)}` : "";
        lines.push(`👻 ${kind}${file}${msg} ${from}`);
        break;
      }
      case "contract-mismatch": {
        const endpoint = p.contract?.endpoint || p.expectation?.endpoint || "?";
        const method = p.contract?.method || p.expectation?.method || "?";
        const key = p.key || "?";
        lines.push(`🔗 ${kind} ${method} ${endpoint} — field "${key}" ${from}`);
        break;
      }
      case "contract": {
        const payload = typeof p === "string" ? p : (p.message || JSON.stringify(p).slice(0, 100));
        lines.push(`📜 ${kind} — ${payload} ${from}`);
        break;
      }
      case "probe-failure": {
        const method = p.method || "?";
        const path = p.path || p.url || "?";
        const status = p.status != null ? p.status : "err";
        lines.push(`🔴 ${kind} ${method} ${path} → ${status} ${from}`);
        break;
      }
      case "test-failure": {
        const name = p.name || p.message || "test failed";
        lines.push(`🧪 ${kind} — ${String(name).slice(0, 120)} ${from}`);
        break;
      }
      case "runtime-error": {
        const line = p.line ? `:${p.line}` : "";
        const msg = p.message ? ` — ${String(p.message).slice(0, 100)}` : "";
        lines.push(`💥 ${kind}${file}${line}${msg} ${from}`);
        break;
      }
      default: {
        const payloadText = typeof p === "string" ? p : (p.message || JSON.stringify(p).slice(0, 100));
        lines.push(`${kind}${file} — ${payloadText} ${from}`);
      }
    }
  }

  if (fresh.length > 10) {
    lines.push(`  ... and ${fresh.length - 10} more`);
  }

  lines.push("");
  lines.push("After reading these, your old signalInbox block is below for reference.");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// BETWEEN-TURN NUDGE CHECK
// ─────────────────────────────────────────────────────────────────────

/**
 * Called from the orchestrator's continuation loop between turns.
 * Reads the session's nudge flag, logs if it's set, and returns true.
 *
 * Does NOT clear the flag — the flag is cleared by the enrichContext
 * handler when the fresh banner is successfully rendered. If enrichContext
 * hasn't run yet (because processMessage hasn't been called), the flag
 * persists so the next turn still sees the banner.
 *
 * Best-effort: never throws. Safe to call unconditionally.
 */
export async function maybeApplyCascadeNudge({ sessionId }) {
  if (!sessionId) return false;
  try {
    const { getSession } = await import("../../seed/ws/sessionRegistry.js");
    const sess = getSession(sessionId);
    if (!sess) return false;
    const cw = sess.meta?.codeWorkspace;
    if (!cw?.nudgeFlag) return false;

    const age = cw.nudgeAt ? Date.now() - cw.nudgeAt : null;
    const reason = cw.nudgeReason || "signal";
    log.info(
      "CodeWorkspace",
      `🌊 nudge applied: sid=${sessionId.slice(0, 8)} reason=${reason}${age != null ? ` age=${age}ms` : ""}`,
    );
    return true;
  } catch (err) {
    log.warn("CodeWorkspace", `maybeApplyCascadeNudge failed: ${err.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// DUMP CONTEXT (read-only by default)
// ─────────────────────────────────────────────────────────────────────

/**
 * Re-run the real enrichContext hook pipeline for a session's current
 * node and return the assembled context object. Used by the operator
 * via `workspace-show-context` to inspect exactly what the AI sees.
 *
 * `dryRun: true` (default) means the watermark advance and nudge flag
 * clear that normally happen inside enrichContext's code-workspace
 * handler are SKIPPED — the inspection must not mutate session state.
 * Otherwise calling the tool once "consumes" fresh signals and the
 * next real turn sees an empty banner.
 *
 * The orchestrator's real enrichContext path is the only caller that
 * should pass `dryRun: false` (and only through the normal hook fire,
 * not through this function).
 */
export async function dumpContextForSession(sessionId, core, { dryRun = true } = {}) {
  if (!sessionId || !core?.hooks?.run) {
    return { error: "missing sessionId or core.hooks" };
  }
  try {
    const { getSession } = await import("../../seed/ws/sessionRegistry.js");
    const sess = getSession(sessionId);
    if (!sess) return { error: `session ${sessionId} not found or inactive` };

    const watcher = sessionsByWatcher.get(String(sessionId));
    if (!watcher) {
      return {
        error: "session is not registered as a watcher. Open a code-workspace project node first.",
      };
    }

    // Read the node metadata so we can pass the same shape enrichContext
    // receives from its normal caller.
    const { default: NodeModel } = await import("../../seed/models/node.js");
    const node = await NodeModel.findById(watcher.nodeId).select("_id name metadata parent").lean();
    if (!node) return { error: `node ${watcher.nodeId} not found` };
    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});

    // Build the context object — start empty, let the enrichContext
    // hook populate it. Pass `dumpMode: dryRun` in the hook data so
    // the code-workspace handler can skip the watermark advance.
    const context = {};
    await core.hooks.run("enrichContext", {
      context,
      meta,
      nodeId: watcher.nodeId,
      userId: sess.userId,
      sessionId,
      dumpMode: dryRun,
    });

    return {
      sessionId,
      watchedNodeId: watcher.nodeId,
      projectId: watcher.projectId,
      dryRun,
      context,
    };
  } catch (err) {
    return { error: err.message };
  }
}
