/**
 * Mid-flight message router.
 *
 * When messages accumulate while the AI is working and drain at a
 * checkpoint or at the end of a debounce window, they usually belong
 * to the currently running step. But when a SWARM is in flight, a
 * message might instead be a plan-level pivot ("drop menu, add
 * multiplayer") or a full stop ("cancel this"). Treating every such
 * message as a branch-local correction is wrong — it lands inside a
 * single branch's turn when the user actually wanted the whole plan
 * redirected.
 *
 * Three possible scopes:
 *
 *   branch  — absorb into the current running branch (today's
 *             default; zero-cost when there is no active swarm).
 *   stop    — abort the whole swarm. Archive the current plan.
 *   plan    — abort the current branch, archive the current plan,
 *             re-invoke the architect with the user's new direction
 *             + context of what was running, stash the new plan,
 *             emit PLAN_PROPOSED so the user sees a fresh plan card.
 *
 * The classifier walks a cheap ladder:
 *   1. Regex fast-paths for obvious stop / plan shapes.
 *   2. If there is no active swarm, everything is branch-scope.
 *   3. LLM classification for ambiguous messages during an active
 *      swarm, with a tight one-word-reply prompt.
 *
 * Keeping the plan-pivot flow in this file (next to the classifier)
 * means the stream extension's index.js stays about plumbing; the
 * policy lives here.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";

const STOP_WORDS_RE = /^(stop|cancel|nevermind|never ?mind|abort|quit|end it|kill it|forget it)$/i;

// These regex fast-paths cover the common vocabulary for plan-level
// changes. A word match on its own doesn't force the route — we need
// the STRUCTURE of a plan edit: a verb plus a branch / component /
// feature noun, OR a clear scrap / pivot directive, OR an explicit
// user-frustration phrase ("u didnt plan", "wait plan this first").
const PLAN_FAST_PATHS = [
  /\b(add|drop|remove|scrap|kill|replace|swap|rename|merge|split|extract|pull out)\s+(?:the\s+|a\s+|an\s+)?\w+\s+(branch|branches|module|feature|component|part|step|phase)\b/i,
  /\b(scrap|redo|restart|rethink|revise|rebuild)\s+(the\s+)?(whole\s+)?plan\b/i,
  /\bpivot\b/i,
  /\b(start|go)\s+over\b/i,
  /\bchange\s+direction\b/i,
  /\bmake\s+it\s+(a|an)\s+\w+\s+instead\b/i,
  // User-frustration — "u didnt (make a )?plan", "didnt plan this",
  // "where('?s)? (the|your) plan", "plan (it |this )?first",
  // "no plan", "no plan was made". Typos tolerated: u/you, didnt/didn't.
  /\b(u|you|y)\s*(didn'?t|didnt|haven'?t|never)\s+(make|made|do|did|create|created)?\s*(a\s+|the\s+|your\s+)?plan\b/i,
  /\b(where'?s|wheres|where\s+is)\s+(the|your|a)\s+plan\b/i,
  /\bno\s+plan(\s+was)?\s*(made|here|yet)?\b/i,
  /\bplan\s+(it|this|that)?\s*(first|before)\b/i,
  /\b(wait|hold on|stop).{0,30}\bplan\b/i,
];

/**
 * Detect whether the current visitor has a swarm in flight at the
 * project root. Returns a small context snapshot so the caller can
 * hand the router what it needs, or null if no active swarm.
 */
export async function detectActiveSwarm({ rootId, currentNodeId }) {
  const anchor = currentNodeId || rootId;
  if (!anchor) return null;
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (!governing?.findRulerScope || !governing?.readActiveExecutionRecord) return null;

    const ruler = await governing.findRulerScope(anchor);
    if (!ruler) return null;
    const record = await governing.readActiveExecutionRecord(ruler._id);
    if (!record) return null;

    const branches = [];
    for (const step of (record.stepStatuses || [])) {
      if (step?.type !== "branch" || !Array.isArray(step.branches)) continue;
      for (const entry of step.branches) {
        branches.push({
          name: entry.name,
          status: entry.status,
          spec: entry.spec || null,
          path: null,
          childNodeId: entry.childNodeId || null,
        });
      }
    }
    if (branches.length === 0) return null;

    const running = branches.filter((b) => b.status === "running" || b.status === "pending");
    if (running.length === 0) return null;

    return {
      projectNodeId: String(ruler._id),
      projectName: ruler.name || null,
      branches,
      running: running.map((b) => b.name),
      version: record.ordinal || 1,
    };
  } catch (err) {
    log.debug("Stream", `detectActiveSwarm failed: ${err.message}`);
    return null;
  }
}

/**
 * Classify a mid-flight message into one of: "branch" | "plan" | "stop".
 * Fast-paths first; LLM fallback only for ambiguous messages during an
 * active swarm.
 */
export async function classifyMidflight({ message, active, core }) {
  const trimmed = String(message || "").trim();
  if (!trimmed) return "branch";

  if (STOP_WORDS_RE.test(trimmed)) return "stop";
  if (!active) return "branch";

  for (const re of PLAN_FAST_PATHS) {
    if (re.test(trimmed)) return "plan";
  }

  // LLM fallback. Short prompt, small-tier model if available. If
  // the call fails or takes too long, fall through to "branch" —
  // better to inject into the current branch than block the user.
  try {
    const { runChat } = await import("../../seed/llm/conversation.js");
    const branchList = active.branches
      .map((b) => `${b.name}[${b.status || "?"}]`)
      .slice(0, 20)
      .join(", ");
    const runningList = (active.running || []).slice(0, 5).join(", ");
    const prompt =
      `You classify a mid-flight user message during a multi-branch code build.\n\n` +
      `Swarm branches: ${branchList}\n` +
      `Currently running: ${runningList || "(none)"}\n` +
      `User just said: "${trimmed.slice(0, 500)}"\n\n` +
      `Is this a:\n` +
      `  - branch: tweak/correction to the currently running branch's work\n` +
      `  - plan: change to the overall plan (add/drop/redirect branches, scope pivot)\n` +
      `  - stop: full halt, abandon the build\n\n` +
      `Reply with ONE word only: branch, plan, or stop.`;

    const result = await Promise.race([
      runChat({
        userId: null,
        username: "midflight-router",
        message: prompt,
        mode: "tree:code-ask",
        rootId: null,
        nodeId: active.projectNodeId,
        // Classifier — each call is independent, default ephemeral.
        llmPriority: "INTERACTIVE",
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("classifier timed out")), 8000),
      ),
    ]);
    const answer = String(result?.answer || result?.content || "").toLowerCase();
    if (/\bstop\b/.test(answer)) return "stop";
    if (/\bplan\b/.test(answer)) return "plan";
    return "branch";
  } catch (err) {
    log.debug("Stream", `classifier LLM fell back: ${err.message}`);
    return "branch";
  }
}

/**
 * Handle a stop route. Archive the in-flight plan with a user-cancel
 * reason. The kernel already breaks the LLM loop when we return
 * { abort: true }; this function does the plan-level bookkeeping.
 */
export async function triggerStop({ active, socket }) {
  if (!active) return;
  try {
    // Phase E: archivePlan removed. The execution-record's status flips
    // to "superseded" automatically on the next Planner re-invocation;
    // for a plain stop without re-emission, the user can either resume
    // ("continue") or send a fresh request that triggers a new
    // emission. We only do the WS emit here so the dashboard knows
    // the active plan was cancelled.

    const { SWARM_WS_EVENTS } = await import("../swarm/wsEvents.js");
    socket?.emit?.(SWARM_WS_EVENTS.PLAN_ARCHIVED, {
      projectNodeId: active.projectNodeId,
      projectName: active.projectName,
      branchCount: active.branches.length,
      reason: "user-cancelled-midflight",
    });
    log.info("Stream", `Mid-flight stop: archived plan on ${active.projectNodeId}`);
  } catch (err) {
    log.warn("Stream", `triggerStop failed: ${err.message}`);
  }
}

/**
 * Handle a plan-pivot route. The caller already returned
 * { abort: true } to the kernel so the running branch stops at its
 * next tool-loop boundary. Here we:
 *   1. Archive the current plan (reason: user-pivot).
 *   2. Re-invoke the architect at the project root with the user's
 *      new direction PLUS a snapshot of what was running so it can
 *      decide what to preserve and what to redesign.
 *   3. Parse the architect's new [[BRANCHES]] block, stash it via
 *      setPendingSwarmPlan, emit PLAN_PROPOSED so the user sees a
 *      fresh plan card they can Accept / Revise / Cancel.
 *
 * Runs fire-and-forget (callers `triggerPlanPivot(...)` without
 * awaiting). If anything fails, the plan is still archived and the
 * user can just type their request again; we never leave the swarm
 * in a half-broken state.
 */
export async function triggerPlanPivot({
  active,
  message,
  visitorId,
  socket,
  userId,
  username,
  rootId,
}) {
  if (!active || !message) return;

  try {
    const { SWARM_WS_EVENTS } = await import("../swarm/wsEvents.js");
    const { getExtension } = await import("../loader.js");
    const planExt = getExtension("governing")?.exports;
    const { setPendingSwarmPlan, getPendingSwarmPlan } = await import("../swarm/state/pendingSwarmPlan.js");

    // Snapshot the running state BEFORE we archive so the architect
    // prompt can reference what was underway when the user pivoted.
    const snapshot = active.branches.map((b) => ({
      name: b.name,
      status: b.status,
      path: b.path || null,
      spec: b.spec || null,
    }));

    // Notify every currently-running branch that its plan was
    // superseded BEFORE we archive. The signal lands in each branch's
    // metadata.swarm.inbox; at the next tool-loop checkpoint the
    // branch's enrichContext picks it up and emits the "plan pivoted"
    // block, which instructs the model to exit cleanly with
    // [[NO-WRITE: superseded by pivot]]. This is the half of the
    // "Dede sees the updated plan" story we can close: running
    // branches at least stop building against the OLD plan instead of
    // burning cycles on stale work. The NEW plan's branches launch
    // after the user accepts v2.
    const nextVersion = (active.version || 1) + 1;
    const runningBranches = (active.branches || [])
      .filter((b) =>
        (b.status === "running" || b.status === "pending") && b.childNodeId,
      );
    if (runningBranches.length > 0) {
      try {
        const swarm = getExtension("swarm")?.exports;
        if (swarm?.appendSignal) {
          for (const b of runningBranches) {
            await swarm.appendSignal({
              nodeId: b.childNodeId,
              signal: {
                kind: "plan-pivoted",
                from: "midflight-pivot",
                filePath: null,
                payload: {
                  reason: "user-pivot-midflight",
                  newVersion: nextVersion,
                  oldBranchName: b.name,
                  userDirection: String(message).slice(0, 400),
                  at: new Date().toISOString(),
                },
              },
              core: null,
            });
          }
          log.info("Stream",
            `🛑 Pivot: signaled ${runningBranches.length} running branch(es) to stop (v${active.version || 1} → v${nextVersion})`);
        }
      } catch (err) {
        log.warn("Stream", `pivot signal propagation failed: ${err.message}`);
      }
    }

    // Phase E: explicit archivePlan call removed. The Planner
    // re-invocation below produces emission-2 which auto-supersedes
    // the prior approval ledger entry and freezes prior records.
    socket?.emit?.(SWARM_WS_EVENTS.PLAN_ARCHIVED, {
      projectNodeId: active.projectNodeId,
      projectName: active.projectName,
      branchCount: active.branches.length,
      reason: "user-pivot-midflight",
    });

    // Re-invoke the Planner at the project root via governing's
    // structured-emission path. The Planner emits via governing-emit-plan
    // which persists a new emission child + planApproval that supersedes
    // the prior active approval (which was archived above). We then read
    // the structured emission back to build the dispatch list.
    const branchSummary = snapshot
      .map((b) => `  • ${b.name}${b.path ? ` (${b.path})` : ""} [${b.status}]${b.spec ? `: ${b.spec}` : ""}`)
      .join("\n");
    const runningList = (active.running || []).join(", ") || "(none)";
    const pivotPrompt =
      `The user sent a mid-build message that changes the plan. ` +
      `Produce a FRESH plan via governing-emit-plan that incorporates ` +
      `their new direction. Do not try to diff against the old plan — ` +
      `the user wants to see one coherent whole.\n\n` +
      `Previous plan (now archived):\n${branchSummary}\n\n` +
      `Was running: ${runningList}\n\n` +
      `User's new direction:\n"${String(message).slice(0, 2000)}"\n\n` +
      `Emit one structured plan via governing-emit-plan covering the ` +
      `updated scope. Preserve branch names whose work still applies; ` +
      `replace or drop sub-domains whose scope is gone; add new ones as ` +
      `needed. Keep branch names stable where possible so existing work ` +
      `can be reused. Close with [[DONE]].`;

    const governing = getExtension("governing")?.exports;
    if (!governing?.readActivePlanEmission) {
      log.warn("Stream", "pivot: governing extension unavailable, cannot re-emit plan");
      return;
    }
    const priorEmission = await governing.readActivePlanEmission(active.projectNodeId);
    const priorOrdinal = priorEmission?.ordinal || 0;

    const { runChat } = await import("../../seed/llm/conversation.js");
    await runChat({
      userId,
      username,
      message: pivotPrompt,
      mode: "tree:governing-planner",
      rootId,
      nodeId: active.projectNodeId,
      llmPriority: "INTERACTIVE",
    });

    // Read the structured emission as the source of truth.
    const newEmission = await governing.readActivePlanEmission(active.projectNodeId);
    const newOrdinal = newEmission?.ordinal || 0;
    const plannerEmittedNewPlan = !!newEmission && newOrdinal > priorOrdinal;
    if (!plannerEmittedNewPlan) {
      log.warn("Stream", "pivot Planner did not emit a new plan; leaving plan archived");
      socket?.emit?.("chatResponse", {
        success: true,
        answer:
          `📦 Archived the in-flight plan and reset. The Planner couldn't ` +
          `re-emit a plan from your new direction — send it again as a fresh ` +
          `request and I'll propose a plan.`,
      });
      return;
    }

    // Build branches from the structured emission.
    const branches = [];
    for (const step of (newEmission.steps || [])) {
      if (step?.type !== "branch" || !Array.isArray(step.branches)) continue;
      for (const b of step.branches) {
        if (!b?.name) continue;
        branches.push({
          name: b.name,
          spec: b.spec || "",
          path: null,
          files: [],
          slot: null,
          mode: null,
          parentBranch: null,
        });
      }
    }

    if (branches.length === 0) {
      log.warn("Stream", "pivot Planner emitted leaf-only plan; nothing to dispatch");
      return;
    }

    const prev = getPendingSwarmPlan(visitorId);
    // If a later pending stash exists, bump past it; otherwise keep the
    // version we already used when signaling running branches.
    const stashVersion = prev?.version
      ? Math.max(nextVersion, prev.version + 1)
      : nextVersion;
    setPendingSwarmPlan(visitorId, {
      branches,
      contracts: [],
      projectNodeId: active.projectNodeId,
      projectName: active.projectName,
      userRequest: message,
      architectChatId: null,
      rootChatId: null,
      rootId,
      // Pivot stash dispatches through governance Ruler → typed
      // Workers; the modeKey field is informational only now (audit
      // trail / dashboard hint), so we use the Ruler key directly
      // rather than the legacy code-plan that no longer exists.
      modeKey: "tree:governing-ruler",
      targetNodeId: active.projectNodeId,
      version: stashVersion,
      cleanedAnswer: "",
      pivot: true,
      emission: newEmission,
    });

    socket?.emit?.(SWARM_WS_EVENTS.PLAN_PROPOSED, {
      version: stashVersion,
      projectNodeId: active.projectNodeId,
      projectName: active.projectName,
      trigger: "mid-flight pivot",
      branches: branches.map((b) => ({
        name: b.name,
        spec: b.spec,
        path: b.path || null,
        files: b.files || [],
        slot: b.slot || null,
        mode: b.mode || null,
        parentBranch: b.parentBranch || null,
      })),
      emission: newEmission,
    });

    log.info("Stream",
      `Mid-flight pivot: archived v${active.version}, proposed v${stashVersion} with ${branches.length} branches (emission-${newOrdinal})`,
    );
  } catch (err) {
    log.warn("Stream", `triggerPlanPivot failed: ${err.message}`);
  }
}
