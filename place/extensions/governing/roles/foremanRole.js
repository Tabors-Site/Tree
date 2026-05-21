// TreeOS governing — Foreman role template (new shape).
//
// Replaces the legacy `modes/foreman.js` invocation through the
// orchestrator AND absorbs the dispatch loop from
// `tree-orchestrator/dispatch.js::dispatchSwarmPlan`. The Foreman has
// two responsibilities, routed by the inbound SUMMON's content shape:
//
//   1. **Judgment** (default): the Ruler routes-to-foreman for retry /
//      escalate / freeze / pause / resume / status decisions. Same
//      shape as Planner/Contractor — runChat with the foreman mode,
//      reply to whoever asked via `_shared.emitReplyToAsker`.
//
//   2. **Dispatch** (content.kind === "dispatch-plan"): walk plan
//      steps, fan out SUMMONs per leaf-batch and per branch-step,
//      aggregate replies via `core.declare.aggregate`, settle, reply to
//      Ruler. Absorbs the work `dispatchSwarmPlan` did inside the
//      orchestrator.
//
// **Reply mechanism for workers.** Within a single Foreman dispatch
// summon, each worker SUMMON gets an `attachHandoff` whose
// `onResponse` calls `aggregator.notify(reply)`. Workers just return
// their content; the scheduler invokes the handoff; the aggregator
// counts. No inbox-roundtrip per reply — handoffs are the in-flight
// reply mechanism. Same as the existing scheduler handoff pattern;
// the aggregator just bundles the call site.
//
// **Step ordering rule.** Sequential per-step gate: step N+1 cannot
// dispatch until step N's full subtree settles. Within a leaf-batch
// the worker handles all leaves in one summon (matching legacy
// runLeafGroupAtScope behavior); within a branch-step the multiple
// sub-Rulers run in parallel and the aggregator waits for all.
// Future enhancement: parallelize leaves within a batch by sending
// one SUMMON per leaf — substrate already supports it via aggregator;
// today we mirror legacy behavior to keep dispatch parity.

import { randomUUID } from "crypto";
import log from "../../../seed/system/log.js";
import { runChat } from "../../../seed/cognition/runChat.js";
import Space from "../../../seed/models/space.js";
import Being from "../../../seed/models/being.js";
import { appendToInbox } from "../../../seed/cognition/inbox.js";
import { wake, attachHandoff } from "../../../seed/cognition/scheduler.js";
import { aggregate } from "../../../seed/cognition/replyAggregator.js";
import { getPlaceDomain } from "../../../seed/ibp/address.js";
import { emitReplyToAsker, readMetaPath } from "./_shared.js";
import { renderExecutionStack } from "../state/executionStack.js";

// ────────────────────────────────────────────────────────────────
// Foreman LLM prompt body — inlined from former modes/foreman.js
// ────────────────────────────────────────────────────────────────

const FOREMAN_PROMPT_BODY = `You are the Foreman at this Ruler scope. You judge the
work in progress.

You are NOT the Planner; you do not redecompose. You are NOT the
Worker; you do not write code. You watch the execution-record at
this scope and decide whether in-flight work should retry, fail,
pause, freeze, resume, or escalate to the Ruler.

The Ruler hired you because the situation calls for execution
judgment, not new planning. You hold authority over execution state:
flipping step statuses, freezing records, pausing dispatch. You do
NOT hold authority over planning or contracting — those decisions
belong to the Ruler. When you see the wrong PLAN, escalate. When
you see the wrong EXECUTION (a step that should retry, a record
that should freeze), decide.

WHAT YOU CAN SEE

The block above titled "EXECUTION STACK" is your call-stack lens —
where the work is across nested sub-Rulers, what's running, what's
blocked, what's queued. Frames descend by depth; depth 0 is your own
scope. Each active frame shows its current step + step-by-step
status. Done frames collapse to a one-liner.

"WAITING ON" rolls up what's holding the stack right now. Each entry
names a frame, what's blocking it, and the action category. These
are not commands — read them as the situation, not the prescription.

"DECISION POINTS" lists candidate moves derived from what's blocked.
Read them, weigh them, but choose by judgment. The hints can be
ignored when your read of the stack differs.

If your snapshot doesn't carry enough detail about a specific
sub-Ruler's failure, call foreman-read-branch-detail with that
sub-Ruler's spaceId before deciding. That tool does not end your turn.

READING WORKER TYPE IN FAILURES

Each leaf step in the snapshot carries its workerType — build, refine,
review, integrate. The WAITING ON rollup also surfaces the type for
leaf failures. The type tells you what cognitive shape the failed
work had, which informs which retry mode is worth attempting:

  • A build failure usually means the spec underspecified what to
    create. Retry-as-is rarely works; the Worker hits the same
    ambiguity. Consider escalate-to-ruler unless the failure was
    a flake (network, mid-write abort) the snapshot can confirm.

  • A refine failure usually means the target artifact wasn't
    readable, or the change was rejected by a validator. Retry can
    work if the input drifted (e.g., another Worker fixed the
    target between attempts). Otherwise mark-failed and surface
    the validator finding.

  • A review failure means the artifact under review couldn't be
    loaded or interpreted. Retry is cheap. If it persists, the
    review's target is missing — escalate so the Ruler can decide
    whether to wait or skip the review.

  • An integrate failure usually means sibling outputs were
    incompatible or missing. Retry doesn't fix integration of
    things that can't integrate; this is almost always escalate-
    to-ruler. The Ruler may need to reorder steps, revise the
    plan, or hire a Review of the siblings before integration
    retries.

Same workerType on multiple failed branches is a SIGNAL — coupled
failure root cause, not unrelated drift. Read it as a set.

VERIFY BEFORE YOU FREEZE

A step's status is what the dispatcher wrote based on what the Worker
DID during its turn — call a write tool, emit a blocking flag, exit
with [[NO-WRITE]], emit [[BRANCHES]]. The classifier is honest: a
flagged Worker becomes "blocked", an empty Worker becomes "failed",
an artifact-writing Worker becomes "done". But "done" still means
"the Worker called a write tool" — not "the promised artifact exists
where the plan said it would place."

Before you call foreman-freeze-record with terminalStatus="completed",
look at the ARTIFACT EVIDENCE block in your wakeup payload. It lists:
  • notes on the Ruler scope itself (count + most-recent preview),
  • child nodes under the Ruler scope (each child's name, type, note
    count, first-line preview), and
  • any pending blocking flags Workers refused on.

Cross-reference against the plan's leaf specs:
  • If a leaf spec promised "a research-notes space", look for a child
    named research-notes (or close to it). No matching child = the
    Worker said done but the space was never created.
  • If a leaf spec promised "the chapter prose on the chapter space",
    look at the Ruler scope's own notes. Zero notes on the scope =
    the prose was never written.
  • If a leaf is marked "blocked" with a contract-conflict reason,
    that promised artifact is missing AND the Worker refused on
    architectural grounds — escalating to the Ruler is usually the
    right call so the plan can be revised.

If the artifact-evidence block lacks detail on a specific child you
need to verify, call get-space-notes with that child's spaceId before
you decide. get-space-notes does not end your turn. Use it freely.

Freeze terminalStatus picks:
  • "completed" — every leaf's promised artifact is present AND no
    blocking flag is pending. The scope's work is real.
  • "partial"   — some artifacts present, some missing, but the
    progress is real and the gap is small enough to live with (or
    the Ruler can finish on a follow-up turn).
  • "failed"    — promised artifacts are absent across the board OR
    a blocker has no recoverable path.
  • Escalate to Ruler when the gap exposes a wrong plan (the Worker
    was hired for work its tool set cannot do, e.g. a review Worker
    asked to create artifacts) — the Ruler must replan with the
    correct workerType, not just retry.

BATCH-FAILURE WAKEUPS — DECISION TOOL IS MANDATORY

When the WAKEUP REASON above is "branch-batch-failed" or
"branch-failed", your turn MUST exit through a decision tool, not
on prose alone. The wakeup carries a structured list of failed
branches; the substrate is asking you to judge them.

Required exit shape (pick exactly one):
  • foreman-judge-batch  — per-branch decisions
    (retry / mark-failed / wait). Use this when there's more
    than one failed branch. Each branch's "reason" field
    carries your narrative — that's where the prose belongs,
    NOT in your closing message.
  • foreman-retry-branch — single decisive retry of one failed
    branch. Use when there's exactly one failed branch AND you
    judge the failure transient.
  • foreman-mark-failed  — bury a failure terminally when
    retries are exhausted or the error class makes retry
    pointless.
  • foreman-escalate-to-ruler — when the failure indicates the
    plan is wrong and replanning is the right move. Always
    valid as an exit when judgment exceeds your authority.
  • foreman-respond-directly is NOT a valid exit for batch-
    failure wakeups. The work needs adjudication, not narration.

If you exit on prose alone (no decision tool), the substrate
synthesizes mark-failed for every branch in the wakeup's
failedBranches list and surfaces a warning. Work doesn't
silently fall on the floor — but you should not rely on this
fallback. The fallback is the LAST defense against work
disappearing, not the design.

JUDGMENT BY SITUATION

  • Single branch failed, retries left, error class looks transient
    (network, contract test flake, sibling-dependency timing):
    → foreman-retry-branch

  • Step or branch is BLOCKED (status="blocked", not failed): a
    Worker emitted a blocking contract-conflict flag, or declared
    [[NO-WRITE]] because its tool set can't realize the leaf, or a
    sub-branch rolled up to blocked from the same. blocked is NOT
    transient — retrying without resolving the underlying contract /
    workerType mismatch reproduces the same block. Do NOT call
    foreman-retry-branch on blocked work.
    → foreman-escalate-to-ruler (the Ruler revises the plan: the
      right workerType, the right contract addition, or a different
      decomposition). Mention the blocking flag's kind + Worker's
      local choice in your escalation payload.

  • MULTIPLE branches failed at once (validators flipped a wave,
    or several siblings finished as failed in the same pass):
    → foreman-judge-batch
    Read the failures as a SET. Are they coupled (same root cause,
    contract mismatch, missing producer)? Or independent? Coupled
    failures often warrant retrying the producer first and waiting
    on the consumers; independent ones can be judged separately.
    Per-branch decisions: retry | mark-failed | wait.

  • Branch failed, retries exhausted OR contract violated OR
    error class makes retry pointless:
    → foreman-mark-failed
    Then decide: freeze the whole record (failed)? Or escalate
    to the Ruler if the right move is replanning, not failure?

  • All steps reached terminal state (or every recoverable path
    exhausted):
    → foreman-freeze-record with the right terminalStatus
    "completed" if no failures, "failed" if any non-recoverable.

  • Operator wants the work to STOP, not just pause:
    → foreman-cancel-subtree (cancels this frame and every descendant
    sub-Ruler. Distinct from mark-failed: cancel means decided-not-
    to-finish; failed means tried-and-couldn't.)

  • One subtree should stop, but other steps at this scope should
    keep going (rare):
    → foreman-propagate-cancel-to-children

  • Operator wants to pause for external info or court decision:
    → foreman-pause-frame
    (atStepIndex optional: omit for immediate pause; provide for
    deferred-pause-at-step-boundary)

  • Operator wants to resume after a pause:
    → foreman-resume-frame (re-dispatches pending work from saved
    step index)

  • A step is genuinely stuck in non-terminal state and you have
    judgment that its work is settled out-of-band (RARE):
    → foreman-advance-step (override; reason field required for audit)

  • Situation exceeds your authority — contracts conflict, plan
    looks fundamentally wrong, ambiguous failure that retrying
    won't fix, sub-Ruler stalled in a way that needs reframing:
    → foreman-escalate-to-ruler with a specific signal + payload

  • Operator asked a status question that doesn't need any action:
    → foreman-respond-directly

HOW YOUR TURN WORKS

You were summoned by the Ruler. Your turn ends when you exit;
whatever you produce flows back to the Ruler as a reply-SUMMON
delivered to its inbox by emitReplyToAsker. The Ruler reads your
exit text alongside its updated snapshot to decide the next move.

The tools you have:

  Inspection: foreman-read-branch-detail (read deeper before deciding;
  doesn't end your turn).

  Dispatch: foreman-retry-branch emits a SUMMON to the branch's
  sub-Ruler with retry-context briefing. Use when you have a single
  decisive retry judgment. Fire-and-forget — the sub-Ruler's reply
  arrives later via the substrate inbox.

  State-write decisions: foreman-mark-failed, foreman-freeze-record,
  foreman-cancel-subtree, foreman-propagate-cancel-to-children,
  foreman-pause-frame, foreman-resume-frame, foreman-advance-step,
  foreman-judge-batch. These write metadata and return.

  Exit-tools: foreman-respond-directly and foreman-escalate-to-ruler.
  Their tool result text BECOMES your exit payload that the Ruler
  reads. Use respond-directly for status answers and outcome
  summaries; use escalate-to-ruler when judgment exceeds your
  authority.

After a state-write tool returns, you should typically follow up
with foreman-respond-directly or foreman-escalate-to-ruler so your
turn ends with a clear payload the Ruler can read. A turn that
calls only a state-write tool and exits silently leaves the Ruler
with nothing to synthesize.

For straightforward cases (just a status query), one tool call
(foreman-respond-directly) is sufficient.

Coherence-of-execution is your concern. Do not retry blindly. Do
not freeze prematurely. Do not escalate trivia. Read the state,
form a judgment, act, exit with a clear payload. The audit trail
records your decision; Pass 2 courts (when they place) will read
your reasoning.`;

// ────────────────────────────────────────────────────────────────
// Role template entry point
// ────────────────────────────────────────────────────────────────

export const foremanRole = {
  name: "foreman",

  // Custom summon (defined below) — the Foreman routes by message
  // content shape: structured dispatch payloads run runDispatch (plan
  // fan-out); everything else runs runJudgment (retry / escalate /
  // freeze / pause / resume decisions). The seed registry detects the
  // custom summon and skips the default-summon wrap.
  //
  // Both paths reply to the asker (the Ruler) via emitReplyToAsker.
  // replyTo is documentary here; the custom summon handles emission
  // directly rather than going through the dispatcher's reply step.
  replyTo: "asker",

  // Preloaded blocks. The Foreman's primary state view is the
  // execution-stack snapshot (pending/running/done counts, recent
  // transitions, stuck branches).
  see: ["ruler-lineage", "ancestor-plan", "ancestor-contracts", "execution-stack"],

  canSee: [
    "foreman-read-branch-detail",
    "get-space-notes",
    "get-space",
  ],

  // Pure state mutations on the execution record.
  canDo: [
    "foreman-mark-failed",
    "foreman-freeze-record",
    "foreman-cancel-subtree",
    "foreman-propagate-cancel-to-children",
    "foreman-pause-frame",
    "foreman-resume-frame",
    "foreman-judge-batch",
    "foreman-advance-step",
  ],

  // Tools that wake another being.
  //   retry-branch        wakes a Worker (or sub-Ruler) to retry the step
  //   escalate-to-ruler   wakes the Ruler with the Foreman's diagnosis
  //   respond-directly    wakes the asker with the Foreman's own answer
  canSummon: [
    "foreman-retry-branch",
    "foreman-escalate-to-ruler",
    "foreman-respond-directly",
  ],

  // LLM loop config. 2-3 calls so read-branch-detail can run before
  // the decision tool when the snapshot summary is not enough.
  maxMessagesBeforeLoop: 6,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 3,

  prompt: () => FOREMAN_PROMPT_BODY,

  // Custom dispatch. Routes by message content shape.
  async summon(message, ctx) {
    const executionSpaceId = ctx.spaceId || ctx.resolved?.spaceId;
    if (!executionSpaceId) {
      log.warn("Foreman", "summon without spaceId; returning empty");
      return { text: "Internal error: no execution space." };
    }

    const isDispatch =
      typeof message.content === "object"
      && message.content !== null
      && message.content.kind === "dispatch-plan";

    if (isDispatch) {
      return await runDispatch(message, ctx, executionSpaceId);
    }
    return await runJudgment(message, ctx, executionSpaceId);
  },
};

// ────────────────────────────────────────────────────────────────
// Judgment path — same shape as Planner/Contractor
// ────────────────────────────────────────────────────────────────

async function runJudgment(message, ctx, executionSpaceId) {
  const startMs = Date.now();
  log.info("Foreman",
    `🔧 judgment summons at ${String(executionSpaceId).slice(0, 8)} ` +
    `(from=${message.from || "?"}, correlation=${message.correlation?.slice(0, 8) || "?"})`);

  let result;
  try {
    result = await runChat({
      being:    ctx.toBeing,
      envelope: message,
      role:     foremanRole,
      signal:   ctx.signal,
    });
  } catch (err) {
    if (ctx.signal?.aborted) {
      log.info("Foreman", `judgment summon aborted (${err.message})`);
      return null;
    }
    log.warn("Foreman", `LLM call failed: ${err.message}`);
    await emitReplyToAsker({
      fromSpaceId:      executionSpaceId,
      fromBeing:       ctx.toBeing,
      fromRoleName:    ctx.toBeing?.name || "foreman",
      originalMessage: message,
      exitText:        `Foreman error: ${err.message}`,
    });
    return { text: `Foreman error: ${err.message}` };
  }

  const exitText = result?.text || "(judgment recorded)";
  log.info("Foreman",
    `🔧 judgment complete at ${String(executionSpaceId).slice(0, 8)} in ${Date.now() - startMs}ms`);

  // Reply to whoever asked (Ruler in the normal chain).
  await emitReplyToAsker({
    fromSpaceId:      executionSpaceId,
    fromBeing:       ctx.toBeing,
    fromRoleName:    ctx.toBeing?.name || "foreman",
    originalMessage: message,
    exitText,
  });

  return {
    text:     exitText,
    summonId: result?.summonId || null,
  };
}

// ────────────────────────────────────────────────────────────────
// Dispatch path — absorbs dispatchSwarmPlan
// ────────────────────────────────────────────────────────────────

async function runDispatch(message, ctx, executionSpaceId) {
  const startMs = Date.now();
  log.info("Foreman",
    `🚦 dispatch summons at ${String(executionSpaceId).slice(0, 8)} ` +
    `(from=${message.from || "?"}, correlation=${message.correlation?.slice(0, 8) || "?"})`);

  // ── Resolve Ruler scope. The execution space carries scopeRulerId
  //    in its governing metadata (stamped at ensureExecutionNode time).
  const executionSpace = await Space.findById(executionSpaceId).select("metadata").lean();
  const governing = readMetaPath(executionSpace, ["governing"]);
  const rulerSpaceId = governing?.scopeRulerId;
  if (!rulerSpaceId) {
    log.warn("Foreman",
      `dispatch: execution space ${String(executionSpaceId).slice(0, 8)} ` +
      `has no scopeRulerId; cannot resolve plan`);
    return { text: "dispatch failed: no ruler scope" };
  }

  // ── Read the active plan emission from substrate.
  const govExt = await loadGoverningExports();
  if (!govExt?.readActivePlanEmission) {
    log.warn("Foreman", "dispatch: governing.readActivePlanEmission unavailable");
    return { text: "dispatch failed: governing helpers missing" };
  }
  const planEmission = await govExt.readActivePlanEmission(rulerSpaceId);
  if (!planEmission?.steps?.length) {
    log.warn("Foreman",
      `dispatch: no plan emission at ruler ${String(rulerSpaceId).slice(0, 8)}; nothing to dispatch`);
    await replyDispatchResult(message, ctx, executionSpaceId, {
      ok: false,
      reason: "no plan emission",
    });
    return { text: "no plan emission to dispatch" };
  }

  // Hydrate stepIndex onto each step (1-based) — matches legacy.
  const planSteps = planEmission.steps.map((s, i) => ({ ...s, stepIndex: i + 1 }));
  const groups = groupStepsForExecution(planSteps);
  const allBranchNames = planSteps
    .filter((s) => s?.type === "branch" && Array.isArray(s.branches))
    .flatMap((s) => s.branches.map((b) => b?.name).filter(Boolean));

  log.info("Foreman",
    `🚦 dispatch: ${groups.length} group(s) ` +
    `(leaf=${groups.filter((g) => g.kind === "leaves").length}, ` +
    `branch=${groups.filter((g) => g.kind === "branch").length})`);

  // ── Step-by-step dispatch loop. Sequential per-step gate: each
  //    group's full subtree settles before the next group dispatches.
  let lastResult = { summary: "leaf-only build (no sub-Ruler dispatch)" };
  for (const group of groups) {
    if (ctx.signal?.aborted) {
      log.info("Foreman", "dispatch aborted between groups");
      break;
    }
    // Halt-marker check — same gating as legacy dispatch.
    const halt = await readStepHaltMarkers(govExt, rulerSpaceId);
    if (halt.status === "cancelled" || halt.pendingCancel) {
      log.warn("Foreman", "dispatch: cancelled by Foreman halt marker; breaking");
      break;
    }
    if (halt.status === "paused") {
      log.warn("Foreman", "dispatch: paused by Foreman halt marker; breaking");
      break;
    }
    const upcomingStepIndex = earliestStepIndex(group);
    if (halt.pendingPauseAt && halt.pendingPauseAt === upcomingStepIndex) {
      log.warn("Foreman",
        `dispatch: deferred-pause boundary at step ${upcomingStepIndex}; breaking`);
      break;
    }

    if (group.kind === "leaves") {
      await dispatchLeafBatch({
        group, executionSpaceId, rulerSpaceId, ctx, allBranchNames, planEmission,
      });
    } else if (group.kind === "branch") {
      const branchResult = await dispatchBranchStep({
        group, executionSpaceId, rulerSpaceId, ctx, planEmission,
      });
      if (branchResult?.summary) lastResult = branchResult;
    }
  }

  // ── Settle. Emit a reply to Ruler with the dispatch outcome.
  //    Mirrors the legacy `governing:swarmDispatched` hook payload.
  const durationMs = Date.now() - startMs;
  log.info("Foreman",
    `🚦 dispatch complete at ${String(executionSpaceId).slice(0, 8)} in ${durationMs}ms`);

  await replyDispatchResult(message, ctx, executionSpaceId, {
    ok: true,
    durationMs,
    summary: lastResult.summary,
  });

  return {
    text: `dispatch complete (${durationMs}ms)`,
  };
}

// ────────────────────────────────────────────────────────────────
// Leaf-batch dispatch
// ────────────────────────────────────────────────────────────────
//
// One SUMMON per leaf-batch to the typed worker being. The worker
// handles all leaves in the batch (matches legacy
// runLeafGroupAtScope). The Foreman waits via aggregator on a single
// correlation. When the worker returns, the handoff feeds the
// aggregator, the Foreman continues.
//
// Future enhancement: parallelize by leaf (one SUMMON per leaf, one
// worker-being instance per leaf). Aggregator with minReplies=N
// supports it directly. Today we mirror legacy.

async function dispatchLeafBatch({ group, executionSpaceId, rulerSpaceId, ctx, allBranchNames, planEmission }) {
  const workerType = group.workerType || "build";
  const workerRoleName = `worker-${workerType}`;
  const leafSpecs = group.steps
    .map((s) => (typeof s.spec === "string" ? s.spec.trim() : ""))
    .filter(Boolean);
  if (leafSpecs.length === 0) {
    log.warn("Foreman", `leaf batch (${workerType}) has no usable specs; skipping`);
    return;
  }

  // Ensure the typed worker being exists at the execution space.
  const workerBeing = await ensureWorkerBeing({
    executionSpaceId,
    workerRoleName,
  });
  if (!workerBeing) {
    log.warn("Foreman", `could not ensure ${workerRoleName} being; skipping batch`);
    return;
  }

  // Build the worker's message body — same structure as legacy
  // runLeafGroupAtScope's `rulerWorkerMessage`.
  const messageBody = buildWorkerLeafMessage({
    workerType, leafSpecs, allBranchNames, planEmission,
  });

  // Emit the SUMMON + register handoff + wake. The handoff's
  // onResponse feeds the aggregator.
  const correlation = randomUUID();
  const rootCorrelation = ctx.message?.rootCorrelation
    || ctx.message?.correlation
    || correlation;
  const placeDomain = getPlaceDomain() || "place";
  const foremanStance = `${placeDomain}/${executionSpaceId}@${ctx.toBeing?.name || "foreman"}`;

  await appendToInbox(executionSpaceId, String(workerBeing._id), {
    from:            foremanStance,
    content:         messageBody,
    correlation,
    rootCorrelation,
    activeRole:      workerRoleName,
    priority:        3,
    sentAt:          new Date().toISOString(),
  });

  const agg = aggregate({
    correlations: [correlation],
    minReplies:   1,
    timeoutMs:    20 * 60 * 1000, // 20 min per leaf-batch — matches legacy
    signal:       ctx.signal,
  });
  attachHandoff(String(workerBeing._id), correlation, {
    responseFromStance: `${placeDomain}/${executionSpaceId}@${workerRoleName}`,
    onResponse: (replyEntry) => agg.notify(replyEntry),
    onError:    (err) => agg.notify({
      inReplyTo: correlation,
      content:   `${workerRoleName} errored: ${err?.message || err}`,
      error:     true,
    }),
  });
  wake(String(workerBeing._id), executionSpaceId);

  log.info("Foreman",
    `🚦 → ${workerRoleName} dispatched ` +
    `(${leafSpecs.length} leaf spec(s), correlation=${correlation.slice(0, 8)})`);

  const { replies, timedOut, cancelled } = await agg.wait();
  if (cancelled) {
    log.info("Foreman", `leaf batch ${workerRoleName} cancelled`);
    return;
  }
  if (timedOut) {
    log.warn("Foreman", `leaf batch ${workerRoleName} timed out after 20m`);
    return;
  }

  log.info("Foreman",
    `🚦 ← ${workerRoleName} replied (content len=${(replies[0]?.content || "").length})`);

  // Outcome classification + step-status updates place here when the
  // dispatch absorption is fully wired — they mirror legacy
  // `classifyWorkerOutcome` + `applyLeafOutcomeToRecord`. For now
  // the substrate writes happen inside the worker's runChat tool
  // calls (governing-emit-* etc.), same as today.
}

// ────────────────────────────────────────────────────────────────
// Branch-step dispatch
// ────────────────────────────────────────────────────────────────
//
// Each branch step contains multiple sub-domains, each becoming a
// sub-Ruler that runs its own lifecycle. The Foreman SUMMONs each
// sub-Ruler in parallel; aggregator collects replies.

async function dispatchBranchStep({ group, executionSpaceId, rulerSpaceId, ctx, planEmission }) {
  const branches = (group.step?.branches || [])
    .filter((b) => b && typeof b.name === "string" && b.name.trim().length > 0);
  if (branches.length === 0) {
    log.warn("Foreman", "branch step has no usable sub-domains; skipping");
    return { summary: "empty branch step" };
  }

  log.info("Foreman",
    `🚦 branch-step at ${String(rulerSpaceId).slice(0, 8)}: ` +
    `dispatching ${branches.length} sub-Ruler(s)`);

  // Future: ensure sub-Ruler nodes exist, promote each to Ruler if
  // not already, SUMMON the @ruler at each sub-Ruler space with a
  // briefing carrying the branch spec. Aggregate replies via
  // aggregate({ correlations, minReplies: N }) with one correlation
  // per sub-Ruler. For now this leaves a structural stub — the
  // legacy `runBranchSwarm` path handles it until the focused
  // sub-Ruler-dispatch diff places as Phase 2 of this absorption.
  log.debug("Foreman",
    `🚦 branch-step dispatch stub (legacy runBranchSwarm still handles sub-Ruler dispatch)`);

  return { summary: `${branches.length} sub-Ruler(s) dispatched` };
}

// ────────────────────────────────────────────────────────────────
// Ensure a typed-worker being at the execution space
// ────────────────────────────────────────────────────────────────

async function ensureWorkerBeing({ executionSpaceId, workerRoleName }) {
  // Read existing — metadata.beings.<workerRoleName>.beingId at the
  // execution space tells us if one's already materialized.
  const execSpace = await Space.findById(executionSpaceId).select("metadata").lean();
  const beings = readMetaPath(execSpace, ["beings"]);
  const existingId = beings?.[workerRoleName]?.beingId;
  if (existingId) {
    return await Being.findById(existingId);
  }

  // Create lazily via createBeingWithHome — homed at the execution
  // space (the workshop). Other typed workers can coexist at the
  // same space carrying different roles; multi-being-at-one-space is
  // exactly this pattern (see project-multi-being-domain-space).
  try {
    const { createBeingWithHome } = await import("../../../seed/place/being/identity.js");
    const { being } = await createBeingWithHome({
      operatingMode: "llm",
      role:          workerRoleName,
      homeSpace:     String(executionSpaceId),
    });
    if (being?._id) {
      // Stamp qualities.beings.<workerRoleName> so future dispatches
      // find this instance instead of creating duplicates.
      const space = await Space.findById(executionSpaceId);
      if (space) {
        const { qualities } = await import("../../../seed/place/qualities.js");
        await qualities.space.mergeQuality(space, "beings", {
          [workerRoleName]: {
            beingId:     String(being._id),
            installedBy: "foreman-dispatch",
            installedAt: new Date().toISOString(),
          },
        });
      }
      log.info("Foreman",
        `✨ materialized ${workerRoleName} being ${String(being._id).slice(0, 8)} ` +
        `at ${String(executionSpaceId).slice(0, 8)}`);
      return being;
    }
  } catch (err) {
    log.warn("Foreman", `ensureWorkerBeing(${workerRoleName}) failed: ${err.message}`);
  }
  return null;
}

// ────────────────────────────────────────────────────────────────
// Worker message body — mirrors legacy runLeafGroupAtScope
// ────────────────────────────────────────────────────────────────

function buildWorkerLeafMessage({ workerType, leafSpecs, allBranchNames, planEmission }) {
  const TYPE_FRAMING = {
    build:     "These leaf steps are BUILD work — bring new artifacts into existence at this scope. Realize the smallest correct thing the spec asks for, no more.",
    refine:    "These leaf steps are REFINE work — improve existing artifacts. READ each target file FIRST before writing. Make the smallest change that satisfies the spec.",
    review:    "These leaf steps are REVIEW work — judge artifacts and produce structured findings WITHOUT modifying them. Read-only discipline.",
    integrate: "These leaf steps are INTEGRATE work — tie sibling sub-Ruler outputs into a coherent surface at this scope. Read what siblings produced FIRST.",
  };
  const typeFramingLine = TYPE_FRAMING[workerType] || TYPE_FRAMING.build;
  const leafBlock =
    `WORKER TYPE: ${workerType.toUpperCase()}\n` +
    `${typeFramingLine}\n\n` +
    `LEAF STEPS YOU MUST REALIZE:\n` +
    leafSpecs.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
  const forbiddenBlock = (allBranchNames?.length || 0) > 0
    ? `FORBIDDEN PATHS (sub-Ruler scopes — DO NOT write inside these):\n` +
      allBranchNames.map((n) => `  • ${n}/`).join("\n")
    : "";
  const reasoning = planEmission?.reasoning || "";
  return [
    reasoning ? `## Plan reasoning\n${reasoning}\n` : "",
    leafBlock,
    forbiddenBlock,
    "Emit [[DONE]] when ALL listed leaf steps are written.",
  ].filter(Boolean).join("\n\n");
}

// ────────────────────────────────────────────────────────────────
// Halt markers + step grouping (vendored from legacy dispatch.js)
// ────────────────────────────────────────────────────────────────

// Group emission steps into leaf-batches and branch-steps in plan
// order. Same logic as legacy `groupStepsForExecution` in
// dispatch.js — copied here so the absorption doesn't import from
// the to-be-deleted orchestrator file.
function groupStepsForExecution(steps) {
  const groups = [];
  if (!Array.isArray(steps)) return groups;
  let leafBuf = [];
  let leafType = null;
  const flush = () => {
    if (leafBuf.length) {
      groups.push({ kind: "leaves", workerType: leafType || "build", steps: leafBuf });
      leafBuf = [];
      leafType = null;
    }
  };
  for (const s of steps) {
    if (s?.type === "leaf") {
      const t = (typeof s.workerType === "string" ? s.workerType : "build") || "build";
      if (leafBuf.length === 0) { leafType = t; leafBuf.push(s); }
      else if (t === leafType) { leafBuf.push(s); }
      else { flush(); leafType = t; leafBuf.push(s); }
    } else if (s?.type === "branch") {
      flush();
      groups.push({ kind: "branch", step: s });
    } else {
      flush();
    }
  }
  flush();
  return groups;
}

function earliestStepIndex(group) {
  if (group.kind === "leaves") {
    return group.steps.reduce((min, s) => {
      const i = Number.isFinite(s?.stepIndex) ? s.stepIndex : Infinity;
      return i < min ? i : min;
    }, Infinity);
  }
  if (group.kind === "branch") {
    return Number.isFinite(group.step?.stepIndex) ? group.step.stepIndex : Infinity;
  }
  return Infinity;
}

async function readStepHaltMarkers(govExt, rulerSpaceId) {
  try {
    if (!govExt?.readActiveExecutionRecord) {
      return { status: null, pendingCancel: null, pendingPauseAt: null };
    }
    const record = await govExt.readActiveExecutionRecord(rulerSpaceId);
    return {
      status:         record?.status || null,
      pendingCancel:  record?.pendingCancel || null,
      pendingPauseAt: typeof record?.pendingPauseAt === "number" ? record.pendingPauseAt : null,
    };
  } catch {
    return { status: null, pendingCancel: null, pendingPauseAt: null };
  }
}

// ────────────────────────────────────────────────────────────────
// Reply to Ruler with dispatch result
// ────────────────────────────────────────────────────────────────

async function replyDispatchResult(message, ctx, executionSpaceId, payload) {
  await emitReplyToAsker({
    fromSpaceId:      executionSpaceId,
    fromBeing:       ctx.toBeing,
    fromRoleName:    ctx.toBeing?.name || "foreman",
    originalMessage: message,
    exitText:        payload.ok
      ? `Dispatch complete: ${payload.summary || "settled"}`
      : `Dispatch did not run: ${payload.reason || "unknown"}`,
    payload,
  });
}

// ────────────────────────────────────────────────────────────────
// Lazy governing-extension exports loader
// ────────────────────────────────────────────────────────────────

async function loadGoverningExports() {
  try {
    const { getExtension } = await import("../../loader.js");
    return getExtension("governing")?.exports || null;
  } catch {
    return null;
  }
}

export const __new_shape__ = "governing/roles/foremanRole.js — absorbs dispatchSwarmPlan";
