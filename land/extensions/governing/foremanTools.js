// Foreman tool surface.
//
// The Foreman's tools are execution-oversight decisions. Same pattern
// as the Ruler: each tool records the decision in a per-visitor
// register; runForemanTurn reads it and applies the action.
//
// The Foreman is narrower than the Ruler. It does not plan, contract,
// or hire other roles. It judges in-progress execution: should this
// failed branch retry? should this record freeze with what terminal
// status? should we pause? Is this beyond my authority and I need to
// kick it back to the Ruler?

import { z } from "zod";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { setForemanDecision } from "./state/foremanDecisions.js";
import {
  tryClaim as tryClaimSpawn,
  release as releaseSpawn,
  buildPendingResponse as buildSpawnPending,
} from "./state/inFlightSpawns.js";

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

const REASON_CAP = 1000;
const RESPONSE_CAP = 4000;
const ERROR_CAP = 1000;
const SUMMARY_CAP = 1000;

// Terminal statuses an execution-record can settle into. "Cancelled"
// is first-class (decided not to finish — distinct from "failed",
// which means tried-and-couldn't). Pass 2 court adjudication and Pass
// 3 reputation accounting will treat them differently.
const TERMINAL_STATUSES = new Set(["completed", "failed", "superseded", "paused", "cancelled"]);

export default function getForemanTools(_core) {
  return [
    // ─────────────────────────────────────────────────────────────────
    // foreman-retry-branch
    //
    // A branch is in failed status. Retry it. The Foreman judged the
    // failure looks transient (network blip, contract test that's
    // flaky, a fix is in flight from a sibling, etc.) and a retry has
    // a reasonable chance of succeeding.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "foreman-retry-branch",
      description:
        "Retry a failed branch by spawning the branch's Ruler turn " +
        "as a chainstep. Use when the failure looks transient or a " +
        "sibling's progress has unblocked it. The branch's Ruler runs " +
        "with retry-context briefing (prior error + your reason), " +
        "decides how to re-attempt (typically hire-planner with the " +
        "fix in mind, or directly dispatch a worker for a small fix), " +
        "and runs to completion. Tool returns the retry's outcome " +
        "text. Args: recordNodeId, stepIndex (1-based), branchName, " +
        "reason (judgment for audit).\n\n" +
        "Note: when judging multiple failures together, prefer " +
        "foreman-judge-batch — it lets the swarm-level retry loop " +
        "coordinate. Use foreman-retry-branch for single, decisive " +
        "judgments inside your turn.",
      schema: {
        recordNodeId: z.string().describe("The execution-record's node id (from your snapshot)."),
        stepIndex: z.number().int().describe("The 1-based step index containing the branch."),
        branchName: z.string().describe("The branch name to retry."),
        reason: z.string().describe("Your judgment — why this retry has a chance of succeeding."),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, userId, username, rootId, chatId, sessionId, recordNodeId, stepIndex, branchName, reason } = args;
        if (!visitorId) return text("foreman-retry-branch: missing visitorId; substrate bug.");
        if (!userId) return text("foreman-retry-branch: missing userId; substrate bug.");
        if (!recordNodeId || typeof stepIndex !== "number" || !branchName) {
          return text("foreman-retry-branch: recordNodeId, stepIndex, branchName all required.");
        }
        const r = typeof reason === "string" ? reason.trim() : "";
        if (!r) return text("foreman-retry-branch: reason is required for the audit trail.");
        if (r.length > REASON_CAP) return text(`foreman-retry-branch: reason exceeds ${REASON_CAP} chars; trim.`);

        // Resolve the branch's Ruler scope from the execution-record.
        // The childNodeId field on the branch sub-status points at it.
        let branchScopeId = null;
        let priorError = null;
        let priorRetries = 0;
        let branchSpec = "";
        try {
          const recNode = await Node.findById(recordNodeId).select("metadata").lean();
          const meta = recNode?.metadata instanceof Map
            ? Object.fromEntries(recNode.metadata)
            : (recNode?.metadata || {});
          const stepStatuses = meta?.governing?.execution?.stepStatuses || [];
          const step = stepStatuses.find((s) => s?.stepIndex === stepIndex);
          if (step?.type === "branch" && Array.isArray(step.branches)) {
            const branch = step.branches.find(
              (b) => String(b.name).toLowerCase() === String(branchName).toLowerCase());
            if (branch) {
              branchScopeId = branch.childNodeId || null;
              priorError = branch.error || null;
              priorRetries = branch.retries || 0;
              branchSpec = branch.spec || "";
            }
          }
        } catch {}

        if (!branchScopeId) {
          return text(
            `foreman-retry-branch: could not resolve childNodeId for branch ` +
            `"${branchName}" at step ${stepIndex}. The branch may not have been ` +
            `dispatched yet, or the execution-record is in an inconsistent state.`,
          );
        }

        // Record the decision (so swarm-level coordination still sees
        // it in batch contexts; harmless when single).
        setForemanDecision(visitorId, {
          kind: "retry-branch",
          recordNodeId, stepIndex,
          branchName: String(branchName).trim(),
          reason: r,
        });

        log.info("Governing",
          `🔁 Foreman retrying branch "${branchName}" at ${String(branchScopeId).slice(0, 8)} ` +
          `(prior retries: ${priorRetries})`);

        // In-flight guard. If the LLM hit an MCP timeout on a prior
        // foreman-retry-branch and is retrying, refuse the duplicate
        // — the original retry chain is still running and a second
        // would double-dispatch the branch Ruler.
        const claim = tryClaimSpawn({
          rulerNodeId: branchScopeId,
          kind: "foreman-retry-branch",
          visitorId,
          briefing: r,
        });
        if (!claim.ok) {
          log.info("Governing",
            `⏳ Foreman retry-branch "${branchName}" at ${String(branchScopeId).slice(0, 8)} ` +
            `refused: already in-flight (${claim.since})`);
          return text(JSON.stringify(
            buildSpawnPending({ existing: claim.existing, kind: "foreman-retry-branch" }),
            null, 2,
          ));
        }

        // Spawn the branch's Ruler as a chainstep. The branch Ruler
        // re-runs its cycle with retry-context as the inherited
        // message. Its decisions (hire planner with revision, etc.)
        // are the branch's own; we just await the outcome.
        const briefing =
          `Retry of branch "${branchName}".\n\n` +
          (branchSpec ? `Original spec:\n${branchSpec}\n\n` : "") +
          `Prior error:\n${priorError || "(unknown)"}\n\n` +
          `Foreman's reason for retrying: ${r}\n\n` +
          `Sibling work has likely advanced since the first attempt — read your ` +
          `enrichContext for current state, apply the fix, complete the branch.`;

        // Thread caller's abort signal + socket so user-cancel reaches
        // the retry's LLM call AND the retry's tool calls + thinking
        // events stream to the user's chat. The orchestrator's per-
        // visitor active-request map carries both.
        let callerSignal = null;
        let callerSocket = null;
        try {
          const { getActiveRequest } = await import("../tree-orchestrator/state.js");
          const active = getActiveRequest(visitorId);
          callerSignal = active?.signal || null;
          callerSocket = active?.socket || null;
        } catch {}

        // Fire-and-forget. The branch retry spawns its own Ruler turn
        // recursively (which itself can hire-planner / hire-contractor /
        // dispatch-execution — all of those are now fire-and-forget too).
        // governing:branchRetried fires when the branch Ruler's turn
        // settles. The Foreman that initiated this retry wakes in a
        // fresh turn from that hook and synthesizes the outcome.
        const { spawnRoleAsChainstepAsync } = await import("../tree-orchestrator/ruling.js");
        const spawn = spawnRoleAsChainstepAsync({
          modeKey: "tree:governing-ruler",
          message: briefing,
          userId,
          username,
          rootId: rootId || null,
          nodeId: String(branchScopeId),
          parentChatId: chatId || null,
          parentSessionId: sessionId || null,
          signal: callerSignal,
          socket: callerSocket,
          source: "foreman-retry-branch",
          kind: "foreman-retry-branch",
          completionHookName: "governing:branchRetried",
          hookPayload: {
            branchName,
            stepIndex,
            branchScopeId: String(branchScopeId),
            recordNodeId,
          },
          releaseClaimKey: claim.key,
        });
        if (!spawn?.spawnId) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "retry-branch",
            error: "spawn-failed-to-start",
          }, null, 2));
        }

        return text(JSON.stringify({
          status: "spawned",
          decision: "retry-branch",
          spawnId: spawn.spawnId,
          branchName,
          stepIndex,
          branchScopeId: String(branchScopeId),
          note:
            "Branch retry started in the background. This turn ends now. " +
            `Synthesize one short sentence — 'Retry of "${branchName}" initiated.' — ` +
            "and stop. When the retry settles, governing:branchRetried wakes " +
            "you in a fresh turn; you'll see the new execution state and " +
            "synthesize the actual outcome THEN.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // foreman-mark-failed
    //
    // The Foreman has decided a branch (or leaf step) is terminally
    // failed — retries exhausted, contract violated, error class
    // makes retry pointless. The step's status flips to "failed" and
    // the Foreman should typically follow with freeze-record (rolling
    // up to terminal-failed) or escalate-to-ruler.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "foreman-mark-failed",
      description:
        "Mark a branch or leaf step as terminally failed. Use when " +
        "retries are exhausted, the contract is violated, or the error " +
        "class makes retry pointless. After this, decide whether to " +
        "freeze the record or escalate to the Ruler. Args: recordNodeId, " +
        "stepIndex, branchName (omit for leaf steps), reason, error (the " +
        "actual error string from the worker, if known).",
      schema: {
        recordNodeId: z.string(),
        stepIndex: z.number().int(),
        branchName: z.string().optional().describe("Sub-branch name (omit for leaf steps)."),
        reason: z.string().describe("Your judgment for the audit trail."),
        error: z.string().optional().describe("The worker's error string, if known."),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, recordNodeId, stepIndex, branchName, reason, error } = args;
        if (!visitorId) return text("foreman-mark-failed: missing visitorId; substrate bug.");
        if (!recordNodeId || typeof stepIndex !== "number") {
          return text("foreman-mark-failed: recordNodeId and stepIndex required.");
        }
        const r = typeof reason === "string" ? reason.trim() : "";
        if (!r) return text("foreman-mark-failed: reason is required for the audit trail.");
        if (r.length > REASON_CAP) return text(`foreman-mark-failed: reason exceeds ${REASON_CAP} chars; trim.`);
        const err = typeof error === "string" ? error.trim().slice(0, ERROR_CAP) : null;
        setForemanDecision(visitorId, {
          kind: "mark-failed",
          recordNodeId,
          stepIndex,
          branchName: branchName ? String(branchName).trim() : null,
          reason: r,
          error: err,
        });
        return text(JSON.stringify({ ok: true, decision: "mark-failed" }));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // foreman-freeze-record
    //
    // Roll the execution-record into a terminal status. Use when work
    // has reached its end — every step done (terminalStatus="completed"),
    // or every recoverable path exhausted (terminalStatus="failed"),
    // or the operator paused mid-flight ("paused"), or a new emission
    // supersedes ("superseded"). Stamps completedAt.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "foreman-freeze-record",
      description:
        "Freeze the execution-record at a terminal status. Use when " +
        "all steps reached terminal state (terminalStatus=\"completed\" " +
        "if no failures, \"failed\" if any did), or when superseded by " +
        "a new emission, or when paused for the operator. Args: " +
        "recordNodeId, terminalStatus, summary (one or two sentences " +
        "the dashboard surfaces).",
      schema: {
        recordNodeId: z.string(),
        terminalStatus: z.enum(["completed", "failed", "superseded", "paused"]),
        summary: z.string().optional().describe("Human-readable summary surfaced on the dashboard."),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, recordNodeId, terminalStatus, summary } = args;
        if (!visitorId) return text("foreman-freeze-record: missing visitorId; substrate bug.");
        if (!recordNodeId || !TERMINAL_STATUSES.has(terminalStatus)) {
          return text(`foreman-freeze-record: terminalStatus must be one of ${[...TERMINAL_STATUSES].join(", ")}.`);
        }
        const s = typeof summary === "string" ? summary.trim().slice(0, SUMMARY_CAP) : null;
        setForemanDecision(visitorId, {
          kind: "freeze-record",
          recordNodeId,
          terminalStatus,
          summary: s,
        });
        return text(JSON.stringify({ ok: true, decision: "freeze-record" }));
      },
    },

    // foreman-pause-record and foreman-resume-record were removed in
    // Phase D. Their replacements are foreman-pause-frame and
    // foreman-resume-frame, which carry stack-aware semantics
    // (deferred-pause-at-step-boundary, re-entry at saved step index).
    // The dispatch cases in ruling.js for the old kinds are also gone;
    // a Foreman that somehow still emits them — only possible if a
    // stale plan stash on a long-running session references them —
    // would land in the unknown-decision-kind log.

    // ─────────────────────────────────────────────────────────────────
    // foreman-escalate-to-ruler
    //
    // The Foreman's way to say "this exceeds my authority — the Ruler
    // should judge." Examples: contract conflict between sub-Rulers,
    // a sub-Ruler's plan looks fundamentally wrong, ambiguous failure
    // where the right answer requires re-planning rather than retry,
    // operator-impact decisions (drop work? reframe scope?). The
    // orchestrator returns control to the Ruler with this payload
    // as the next turn's wakeupReason.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "foreman-escalate-to-ruler",
      description:
        "Escalate to the Ruler. Use when the situation exceeds your " +
        "authority — contract conflicts between sub-Rulers, plans that " +
        "look fundamentally wrong, ambiguous failures where retrying " +
        "won't help. Args: signal (short label), payload (the " +
        "specifics the Ruler needs to read).",
      schema: {
        signal: z.string().describe(
          "Short label — e.g. \"ambiguous-failure\", \"contract-conflict\", " +
          "\"sub-ruler-stalled\", \"replan-needed\".",
        ),
        payload: z.string().describe(
          "The specifics. What you saw, why retry/freeze isn't right, " +
          "what the Ruler should consider.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, signal, payload } = args;
        if (!visitorId) return text("foreman-escalate-to-ruler: missing visitorId; substrate bug.");
        const s = typeof signal === "string" ? signal.trim() : "";
        const p = typeof payload === "string" ? payload.trim() : "";
        if (!s) return text("foreman-escalate-to-ruler: signal is required.");
        if (!p) return text("foreman-escalate-to-ruler: payload is required.");
        setForemanDecision(visitorId, { kind: "escalate-to-ruler", signal: s, payload: p });
        // Return the escalation content as the tool result text. The
        // Foreman's final answer (this text + any synthesis) flows
        // back to whoever invoked the Foreman (typically the Ruler's
        // route-to-foreman tool). Chain-nested architecture: this
        // tool result IS the Foreman's exit payload.
        return text(
          `[ESCALATION TO RULER]\n` +
          `signal: ${s}\n\n` +
          `payload:\n${p}\n\n` +
          `(Foreman's chainstep ends with this escalation. Synthesize a final ` +
          `message saying you're returning control to the Ruler with this ` +
          `payload, then exit.)`,
        );
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // foreman-respond-directly
    //
    // The Foreman's natural chainstep-exit when it can answer from
    // execution state without changing anything (typical for user
    // status queries). The response text becomes the Foreman's exit
    // payload, returned to whoever invoked the Foreman (Ruler's
    // route-to-foreman or resume-execution tool).
    // ─────────────────────────────────────────────────────────────────
    {
      name: "foreman-respond-directly",
      description:
        "Respond to the user without changing execution. Use for " +
        "status queries that don't need any action — \"what's the " +
        "build doing?\", \"why did this fail?\". Your response becomes " +
        "the Foreman's exit payload, flowing back to the Ruler that " +
        "spawned you. Args: response.",
      schema: {
        response: z.string(),
      },
      annotations: { readOnlyHint: true },
      async handler(args) {
        const { visitorId, response } = args;
        if (!visitorId) return text("foreman-respond-directly: missing visitorId; substrate bug.");
        const r = typeof response === "string" ? response.trim() : "";
        if (!r) return text("foreman-respond-directly: response is required.");
        if (r.length > RESPONSE_CAP) return text(`foreman-respond-directly: response exceeds ${RESPONSE_CAP} chars.`);
        setForemanDecision(visitorId, { kind: "respond-directly", response: r });
        // Return the response as tool result text so it's part of
        // the Foreman's final answer; the calling Ruler tool
        // (route-to-foreman or resume-execution) reads this as the
        // Foreman's exit payload.
        return text(r);
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // foreman-read-branch-detail
    //
    // Pulls a sub-Ruler's plan emission + Worker output for inspection
    // before the Foreman decides. Does NOT end the turn — the Foreman
    // calls a decision tool after.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "foreman-read-branch-detail",
      description:
        "Inspect a sub-Ruler's plan emission and most recent worker " +
        "output. Use when your snapshot summary isn't enough to decide " +
        "(e.g., before judging whether a failure is genuine or transient). " +
        "Returns the sub-Ruler's plan + recent execution state. Does NOT " +
        "end your turn — call a decision tool after. Args: subRulerNodeId.",
      schema: {
        subRulerNodeId: z.string(),
      },
      annotations: { readOnlyHint: true },
      async handler(args) {
        const subRulerNodeId = typeof args?.subRulerNodeId === "string" ? args.subRulerNodeId.trim() : "";
        if (!subRulerNodeId) return text("foreman-read-branch-detail: subRulerNodeId required.");
        try {
          const { getExtension } = await import("../loader.js");
          const governing = getExtension("governing")?.exports;
          const node = await Node.findById(subRulerNodeId).select("_id name").lean();
          if (!node) return text(`foreman-read-branch-detail: node ${subRulerNodeId.slice(0, 8)} not found.`);
          const plan = governing?.readActivePlanEmission
            ? await governing.readActivePlanEmission(subRulerNodeId)
            : null;
          const exec = governing?.readActiveExecutionRecord
            ? await governing.readActiveExecutionRecord(subRulerNodeId)
            : null;
          return text(JSON.stringify({
            ok: true,
            name: node.name,
            plan: plan
              ? { ordinal: plan.ordinal, reasoning: plan.reasoning, stepCount: plan.steps?.length || 0 }
              : null,
            execution: exec
              ? { ordinal: exec.ordinal, status: exec.status, stepStatuses: exec.stepStatuses }
              : null,
          }, null, 2));
        } catch (err) {
          log.warn("Governing", `foreman-read-branch-detail failed: ${err.message}`);
          return text(`foreman-read-branch-detail: read failed: ${err.message}`);
        }
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // STACK-OPERATION TOOLS
    //
    // These tools manage the call stack, not individual steps:
    //   - cancel-subtree: halt a frame and everything below it
    //   - propagate-cancel-to-children: halt direct sub-Rulers only
    //     (this frame keeps going)
    //   - pause-frame: pause this frame; resume re-enters at the saved
    //     step
    //   - resume-frame: un-pause and re-dispatch the pending work
    //   - advance-step: rare-use override for skipping a stuck step
    //     after manual repair
    //
    // Phase B (this pass): tools fire, write markers + register decisions,
    // but the swarm queue and dispatch path don't yet read the markers
    // to actually halt or re-enter. Phase C wires the loop-level
    // checks. Behavior in Phase B is identical to today; the markers
    // accumulate in metadata for Phase C to consume.
    // ─────────────────────────────────────────────────────────────────

    // foreman-cancel-subtree
    //
    // The Foreman decided this frame and everything below it should
    // halt. Different from mark-failed (mark-failed is "tried-and-
    // couldn't"); cancel is "decided not to finish." The audit trail
    // distinguishes the two for Pass 2 court adjudication.
    {
      name: "foreman-cancel-subtree",
      description:
        "Cancel this execution-record and every descendant sub-Ruler's " +
        "execution. Use when work should stop entirely — operator " +
        "abandoned it, conditions changed making the work moot, " +
        "court ordered cessation. Distinct from mark-failed (which " +
        "means tried-and-couldn't). Cancel means decided-not-to-finish. " +
        "Args: recordNodeId, reason. After this tool, exit your turn.",
      schema: {
        recordNodeId: z.string(),
        reason: z.string().describe("Why cancelling. Pass 2 courts read this when adjudicating."),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, recordNodeId, reason } = args;
        if (!visitorId) return text("foreman-cancel-subtree: missing visitorId; substrate bug.");
        if (!recordNodeId) return text("foreman-cancel-subtree: recordNodeId required.");
        const r = typeof reason === "string" ? reason.trim() : "";
        if (!r) return text("foreman-cancel-subtree: reason is required.");
        if (r.length > REASON_CAP) return text(`foreman-cancel-subtree: reason exceeds ${REASON_CAP} chars; trim.`);
        setForemanDecision(visitorId, { kind: "cancel-subtree", recordNodeId, reason: r });
        return text(JSON.stringify({ ok: true, decision: "cancel-subtree", reason: r }, null, 2));
      },
    },

    // foreman-propagate-cancel-to-children
    //
    // Cancel only the immediate sub-Ruler children of this frame; this
    // frame itself keeps running on its other steps. Use when a parent
    // wants to abandon one subtree but not the whole stack. Rare.
    {
      name: "foreman-propagate-cancel-to-children",
      description:
        "Cancel the IMMEDIATE child sub-Rulers of this frame, but keep " +
        "this frame itself running on its other steps. Use when a parent " +
        "decides one branch step's children no longer matter (e.g., " +
        "upstream replan obsoleted them) but other steps at this scope " +
        "should proceed. Rare. Args: recordNodeId, reason.",
      schema: {
        recordNodeId: z.string(),
        reason: z.string(),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, recordNodeId, reason } = args;
        if (!visitorId) return text("foreman-propagate-cancel-to-children: missing visitorId; substrate bug.");
        if (!recordNodeId) return text("foreman-propagate-cancel-to-children: recordNodeId required.");
        const r = typeof reason === "string" ? reason.trim() : "";
        if (!r) return text("foreman-propagate-cancel-to-children: reason is required.");
        setForemanDecision(visitorId, { kind: "propagate-cancel-to-children", recordNodeId, reason: r });
        return text(JSON.stringify({ ok: true, decision: "propagate-cancel-to-children", reason: r }, null, 2));
      },
    },

    // foreman-pause-frame
    //
    // Replaces foreman-pause-record. With atStepIndex omitted, pauses
    // immediately (current step's status pauses where it is). With
    // atStepIndex provided, pauses at that upcoming step boundary —
    // queue stops just before dispatching that step.
    {
      name: "foreman-pause-frame",
      description:
        "Pause this frame's execution. Without atStepIndex: immediate " +
        "pause (current work flushes; no new dispatch). With atStepIndex: " +
        "deferred pause (queue stops just before that step boundary). " +
        "Resume via foreman-resume-frame; the saved step index is what " +
        "resume re-enters at. Args: recordNodeId, atStepIndex (optional, " +
        "1-based), reason.",
      schema: {
        recordNodeId: z.string(),
        atStepIndex: z.number().int().optional(),
        reason: z.string(),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, recordNodeId, atStepIndex, reason } = args;
        if (!visitorId) return text("foreman-pause-frame: missing visitorId; substrate bug.");
        if (!recordNodeId) return text("foreman-pause-frame: recordNodeId required.");
        const r = typeof reason === "string" ? reason.trim() : "";
        if (!r) return text("foreman-pause-frame: reason is required.");
        const atIdx = typeof atStepIndex === "number" ? atStepIndex : null;
        setForemanDecision(visitorId, {
          kind: "pause-frame",
          recordNodeId,
          atStepIndex: atIdx,
          reason: r,
        });
        return text(JSON.stringify({
          ok: true,
          decision: "pause-frame",
          recordNodeId,
          atStepIndex: atIdx,
          reason: r,
        }, null, 2));
      },
    },

    // foreman-resume-frame
    //
    // Replaces foreman-resume-record. Clears pause markers and triggers
    // re-dispatch. Resume picks up at the step indices captured when
    // pause was set (or, if no atStepIndex, at the first non-done step).
    {
      name: "foreman-resume-frame",
      description:
        "Resume a paused frame's execution. Clears pause markers and " +
        "re-dispatches pending work starting at the saved step index. " +
        "Args: recordNodeId, reason.",
      schema: {
        recordNodeId: z.string(),
        reason: z.string(),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, recordNodeId, reason } = args;
        if (!visitorId) return text("foreman-resume-frame: missing visitorId; substrate bug.");
        if (!recordNodeId) return text("foreman-resume-frame: recordNodeId required.");
        const r = typeof reason === "string" ? reason.trim() : "";
        if (!r) return text("foreman-resume-frame: reason is required.");
        setForemanDecision(visitorId, { kind: "resume-frame", recordNodeId, reason: r });
        return text(JSON.stringify({ ok: true, decision: "resume-frame", reason: r }, null, 2));
      },
    },

    // foreman-judge-batch
    //
    // Batch-judgment tool. The Foreman judges multiple failures in
    // one turn rather than one Foreman call per failure. Replaces the
    // per-failure invocation loop that ran inside retryFailedBranches
    // when validators flipped M branches to failed simultaneously.
    //
    // The set-framing is load-bearing. Per-failure Foreman calls
    // miss coupling: lobby fails because rooms hasn't ratified the
    // shared onScore contract; rooms fails because client expects
    // a storage-key shape rooms didn't write. Treating each as
    // independent suggests retry-everything; reading them as a SET
    // suggests "fix one upstream, retry the others next pass."
    //
    // Why this is a separate tool rather than letting the Foreman call
    // retry-branch / mark-failed multiple times in one turn:
    //   1. Single tool emission is structurally validatable. The
    //      handler checks that the decisions list covers every named
    //      branch from the wakeup, no extras, no duplicates.
    //   2. The tool description carries the set-framing instructions
    //      directly at the call site — the model has to read it as it
    //      forms the args, not just maybe-remember it from the system
    //      prompt.
    //   3. The decision register stays single-decision-per-turn (the
    //      batch decision IS the single decision); existing dispatch
    //      logic in ruling.js only needs one new case.
    //
    // Per-decision actions:
    //   "retry"       — re-dispatch the branch (will get fresh worker turn)
    //   "mark-failed" — leave failed, no retry (terminal failure)
    //   "wait"        — don't retry yet; revisit next pass after other
    //                   retries finish. Use when this branch is downstream
    //                   of another retry — fixing the upstream may auto-
    //                   resolve this one.
    //
    // For "escalate the whole batch to Ruler" or "freeze terminally":
    // those are TURN-LEVEL decisions; call foreman-escalate-to-ruler
    // or foreman-freeze-record instead of foreman-judge-batch. The
    // batch tool is for "I want to handle this batch myself; here are
    // my per-branch judgments."
    {
      name: "foreman-judge-batch",
      description:
        "Judge multiple failed branches in one turn. Use when the wakeup " +
        "lists 2 or more failures. Read them as a SET — are these all the " +
        "same root cause? Independent? Does fixing one unblock others? — " +
        "then emit a decision per branch.\n\n" +
        "Set-framing matters. Per-failure judgment risks treating coupled " +
        "failures as independent. If three branches fail because they all " +
        "consumed the same missing contract, retrying all three without " +
        "fixing the contract is wasted work. The right call may be: retry " +
        "the producer first; let the consumers wait this pass; revisit on " +
        "the next pass.\n\n" +
        "Args: decisions[] — one entry per branch named in the wakeup. " +
        "Each entry has branchName + action ('retry' | 'mark-failed' | " +
        "'wait') + reason (required for audit).\n\n" +
        "If the situation looks like the wrong PLAN rather than execution " +
        "judgment (failure exposes a decomposition error), don't use this " +
        "tool — call foreman-escalate-to-ruler instead. If everything is " +
        "terminal-failed and you're done, call foreman-freeze-record " +
        "instead. This tool is for actionable per-branch decisions.",
      schema: {
        decisions: z.array(z.object({
          branchName: z.string().describe(
            "Must match a branch name from the wakeup's failure list.",
          ),
          action: z.enum(["retry", "mark-failed", "wait"]).describe(
            "retry = re-dispatch the branch. mark-failed = terminal " +
            "failure, no retry. wait = revisit next pass (use when this " +
            "branch is downstream of another retry).",
          ),
          reason: z.string().describe(
            "Required for audit. Be specific about WHY this branch " +
            "warrants this action vs the alternatives. Pass 2 courts " +
            "read these reasons.",
          ),
        })).describe(
          "One entry per failed branch in the wakeup. The handler " +
          "validates coverage: every named failure must have exactly one " +
          "decision; no extra branches; no duplicates.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, decisions } = args;
        if (!visitorId) return text("foreman-judge-batch: missing visitorId; substrate bug.");
        if (!Array.isArray(decisions) || decisions.length === 0) {
          return text("foreman-judge-batch: decisions must be a non-empty array.");
        }
        // Validate per-decision shape. Coverage check (every wakeup
        // failure has exactly one decision, no duplicates, no extras)
        // happens at dispatch time in ruling.js where the wakeup
        // failure list is in scope; the tool handler only does
        // structural validation here.
        const errors = [];
        const seenNames = new Set();
        decisions.forEach((d, i) => {
          if (!d || typeof d !== "object") {
            errors.push(`decision ${i} must be an object`);
            return;
          }
          const name = typeof d.branchName === "string" ? d.branchName.trim() : "";
          if (!name) errors.push(`decision ${i} missing branchName`);
          else if (seenNames.has(name.toLowerCase())) {
            errors.push(`decision ${i} duplicate branchName "${name}" — emit one decision per branch`);
          } else {
            seenNames.add(name.toLowerCase());
          }
          if (!["retry", "mark-failed", "wait"].includes(d.action)) {
            errors.push(`decision ${i} action must be one of retry|mark-failed|wait`);
          }
          const reason = typeof d.reason === "string" ? d.reason.trim() : "";
          if (!reason) errors.push(`decision ${i} missing reason (required for audit)`);
          else if (reason.length > REASON_CAP) errors.push(`decision ${i} reason exceeds ${REASON_CAP} chars`);
        });
        if (errors.length) {
          return text(`foreman-judge-batch rejected:\n  - ${errors.join("\n  - ")}`);
        }
        setForemanDecision(visitorId, {
          kind: "judge-batch",
          decisions: decisions.map((d) => ({
            branchName: String(d.branchName).trim(),
            action: d.action,
            reason: String(d.reason).trim(),
          })),
        });
        const summary = decisions.map((d) => `${d.branchName}:${d.action}`).join(", ");
        return text(JSON.stringify({
          ok: true,
          decision: "judge-batch",
          summary,
          count: decisions.length,
        }, null, 2));
      },
    },

    // foreman-advance-step
    //
    // RARE-USE OVERRIDE. The Foreman is the call-stack manager via
    // structural enforcement (queue halt, frame discipline, stack ops),
    // NOT per-step approval. Routine advance is programmatic.
    // advance-step is for explicit override cases:
    //   - A step is stuck in a non-terminal state after manual repair
    //     and needs to be marked done so the queue can advance.
    //   - The Foreman judges a step's work was already accomplished
    //     out-of-band (e.g., user manually wrote the file).
    // Reason field required for the audit trail.
    {
      name: "foreman-advance-step",
      description:
        "RARE-USE OVERRIDE. Mark a stuck non-terminal step as advanced " +
        "so the queue can move past it. NOT routine glue — routine " +
        "step advance is programmatic. Use only when a step is genuinely " +
        "stuck and you have judgment that its work is settled (resolved " +
        "out-of-band, user repaired it manually, etc.). Args: " +
        "recordNodeId, fromStepIndex, reason (required for audit).",
      schema: {
        recordNodeId: z.string(),
        fromStepIndex: z.number().int(),
        reason: z.string().describe("Required for audit. Be specific about why this step is being skipped."),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, recordNodeId, fromStepIndex, reason } = args;
        if (!visitorId) return text("foreman-advance-step: missing visitorId; substrate bug.");
        if (!recordNodeId || typeof fromStepIndex !== "number") {
          return text("foreman-advance-step: recordNodeId and fromStepIndex required.");
        }
        const r = typeof reason === "string" ? reason.trim() : "";
        if (!r) return text("foreman-advance-step: reason is required for the audit trail.");
        if (r.length > REASON_CAP) return text(`foreman-advance-step: reason exceeds ${REASON_CAP} chars; trim.`);
        setForemanDecision(visitorId, {
          kind: "advance-step",
          recordNodeId,
          fromStepIndex,
          reason: r,
        });
        return text(JSON.stringify({
          ok: true,
          decision: "advance-step",
          recordNodeId,
          fromStepIndex,
          reason: r,
        }, null, 2));
      },
    },
  ];
}
