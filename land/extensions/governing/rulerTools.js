// Ruler tool surface.
//
// Two tool shapes, matched to what the tool actually does:
//
// SPAWN-AND-AWAIT — invokes another role as a chainstep, awaits its
//   completion, returns a concise summary the Ruler reads. The Ruler's
//   chat continues after the tool result so it can synthesize for the
//   user. Tools: hire-planner, revise-plan, route-to-foreman,
//   resume-execution.
//
// STATE-WRITE DECISION-RECORDER — writes metadata (or fires a hook,
//   or returns text), no LLM spawn. Decision is recorded to the
//   per-visitor register; runRulerTurn applies state writes after the
//   Ruler's chat ends. Tools: archive-plan, pause-execution,
//   convene-court, respond-directly.
//
// INSPECTION — read-only utility that does NOT end the turn. The
//   Ruler can call it before deciding. Tools: read-plan-detail.
//
// The architecture is "the Ruler is the addressable being." Tools
// that invoke other roles spawn them as chain-nested chainsteps so
// each role still runs in its own LLM call (own mode, own context),
// but the Ruler stays open to synthesize what happened back to the
// user. Each role's full output lives in metadata; only a concise
// summary flows back to the Ruler's tool-result.

import { z } from "zod";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { setRulerDecision } from "./state/rulerDecisions.js";

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

const BRIEFING_CAP = 4000;
const RESPONSE_CAP = 8000;
const REASON_CAP = 2000;

// Build the concise summary returned to the Ruler after the
// Contractor emits. Mirrors formatPlannerSpawnSummary's role: the
// full contract details live in metadata.governing.emission on the
// contracts-emission node; the Ruler reads counts/kinds/names.
function formatContractorSpawnSummary(emission) {
  if (!emission) {
    return {
      ok: false,
      message: "Contractor did not produce a contract emission. Surface as substrate bug.",
    };
  }
  const contracts = Array.isArray(emission.contracts) ? emission.contracts : [];
  const byKind = {};
  const names = [];
  for (const c of contracts) {
    const kind = c.kind || "contract";
    byKind[kind] = (byKind[kind] || 0) + 1;
    if (c.name) names.push(`${kind}:${c.name}`);
  }
  const reasoning = (emission.reasoning || "").trim();
  const firstSentenceMatch = reasoning.match(/^[^.!?]*[.!?]/);
  const reasoningHeadline = firstSentenceMatch
    ? firstSentenceMatch[0].trim().slice(0, 240)
    : reasoning.slice(0, 240);
  return {
    ok: true,
    emissionId: emission._emissionNodeId || null,
    ordinal: emission.ordinal || null,
    reasoningHeadline,
    count: contracts.length,
    byKind,
    names: names.slice(0, 20),
    awaitingDispatch: true,
  };
}

// Emit the plan card to the user via governingPlanProposed (or
// governingPlanUpdated for revisions). The card carries the
// structured emission so the dashboard renders reasoning + steps +
// branches + Accept/Revise/Cancel buttons. Clicking Accept sends
// "yes" through the normal chat pipeline → next Ruler turn reads
// lifecycle.awaiting === "contracts" and calls hire-contractor.
//
// Event names live in governing/wsEvents.js. The legacy swarm
// equivalents (swarmPlanProposed/Updated) are also fired during the
// transition so existing dashboard code paths that haven't migrated
// keep working — drop the dual emit once all listeners are updated.
//
// Returns true if emit succeeded, false if no socket available.
async function emitPlanCard({ visitorId, ruler, emission, isRevision }) {
  if (!visitorId || !emission) return false;
  try {
    const { getActiveRequest } = await import("../tree-orchestrator/state.js");
    const { GOVERNING_WS_EVENTS } = await import("./wsEvents.js");
    const active = getActiveRequest(visitorId);
    const socket = active?.socket;
    if (!socket?.emit) return false;

    // Build branches list for the card from the emission's branch
    // steps. The card renders these as "sub-Rulers about to dispatch."
    const branches = [];
    for (const step of (emission.steps || [])) {
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

    const payload = {
      version: emission.ordinal || 1,
      projectNodeId: String(ruler._id),
      projectName: ruler.name || null,
      branches,
      contracts: [],
      emission,
      ...(isRevision ? { trigger: "revision" } : {}),
    };

    const eventName = isRevision
      ? GOVERNING_WS_EVENTS.PLAN_UPDATED
      : GOVERNING_WS_EVENTS.PLAN_PROPOSED;
    socket.emit(eventName, payload);

    log.info("Governing",
      `🎴 ${isRevision ? "PLAN_UPDATED" : "PLAN_PROPOSED"} emitted at ` +
      `${String(ruler._id).slice(0, 8)} ` +
      `(emission-${emission.ordinal}, ${branches.length} branches, ${emission.steps?.length || 0} steps)`);
    return true;
  } catch (err) {
    log.debug("Governing", `plan card emit skipped: ${err.message}`);
    return false;
  }
}

// Build the concise summary returned to the Ruler after the Planner
// emits. The full structured emission lives in metadata.governing.emission;
// the Ruler reads the headline + counts + names. ~150 tokens of context.
function formatPlannerSpawnSummary(emission) {
  if (!emission) {
    return {
      ok: false,
      message: "Planner did not produce a plan emission. Surface as substrate bug.",
    };
  }
  const steps = Array.isArray(emission.steps) ? emission.steps : [];
  const leafCount = steps.filter((s) => s?.type === "leaf").length;
  const branchSteps = steps.filter((s) => s?.type === "branch");
  const branchNames = branchSteps.flatMap((s) =>
    Array.isArray(s.branches) ? s.branches.map((b) => b?.name).filter(Boolean) : []);
  const reasoning = (emission.reasoning || "").trim();
  // Reasoning headline: first sentence (up to ~200 chars), so the
  // Ruler sees the gist without the full reasoning bloating its
  // context. The Ruler can call read-plan-detail if it wants more.
  const firstSentenceMatch = reasoning.match(/^[^.!?]*[.!?]/);
  const reasoningHeadline = firstSentenceMatch
    ? firstSentenceMatch[0].trim().slice(0, 240)
    : reasoning.slice(0, 240);
  return {
    ok: true,
    emissionId: emission._emissionNodeId || null,
    ordinal: emission.ordinal || null,
    reasoningHeadline,
    leafCount,
    branchCount: branchSteps.length,
    branchNames,
    planCardEmitted: true,
    awaitingApproval: true,
  };
}

// Resolve the Ruler scope from the calling tool's nodeId. Used by
// spawn-and-await tools to anchor the Planner/Foreman/etc. at the
// right scope. Walks up via governing.findRulerScope.
async function resolveRulerScope(nodeId) {
  if (!nodeId) return null;
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (!governing?.findRulerScope) return null;
    return await governing.findRulerScope(nodeId);
  } catch {
    return null;
  }
}

// Fetch the calling visitor's active abort signal. Tool handlers
// can't receive AbortSignal through args (not JSON-serializable),
// so the orchestrator's per-visitor active-request map is the
// indirection. When the user cancels their turn, that signal aborts;
// spawn-and-await tools threading it through to runChat propagate
// the cancel into the spawned role.
async function getCallerAbortSignal(visitorId) {
  if (!visitorId) return null;
  try {
    const { getActiveRequest } = await import("../tree-orchestrator/state.js");
    const active = getActiveRequest(visitorId);
    return active?.signal || null;
  } catch {
    return null;
  }
}

// Fetch the calling visitor's active socket. Same indirection as the
// abort signal — tool handlers can't receive Socket through args.
// Threading the socket lets spawned roles emit tool-call/thinking
// events back to the user's chat so they see the inner chain unfold
// live (Planner narration, Contractor reasoning, etc.) instead of
// only the parent's post-synthesis.
async function getCallerSocket(visitorId) {
  if (!visitorId) return null;
  try {
    const { getActiveRequest } = await import("../tree-orchestrator/state.js");
    const active = getActiveRequest(visitorId);
    return active?.socket || null;
  } catch {
    return null;
  }
}

export default function getRulerTools(_core) {
  return [
    // ─────────────────────────────────────────────────────────────────
    // governing-hire-planner
    //
    // The Ruler decides this scope needs decomposition. The Planner
    // will run with the Ruler's briefing as additional context. After
    // the Planner emits, the user is shown the plan for approval (top-
    // level) or the cycle auto-approves (sub-Ruler).
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-hire-planner",
      description:
        "Hire a Planner to decompose the work at this scope. Spawns " +
        "the Planner as a chainstep child of your turn — it runs in " +
        "its own LLM call (own context, own prompt), emits a structured " +
        "plan to metadata, and the plan card is sent to the user. The " +
        "tool returns a concise summary (emission ordinal, reasoning " +
        "headline, leaf/branch counts, branch names). You read the " +
        "summary, decide whether the plan looks reasonable (call " +
        "revise-plan if not — rare), then synthesize a final response " +
        "to the user about what was drafted.\n\n" +
        "Use when the user's message describes new work or new " +
        "structure needing decomposition. Args: briefing (your " +
        "instructions to the Planner — what frame, what constraints, " +
        "what to consider). The Planner reads this alongside the " +
        "user's original message.",
      schema: {
        briefing: z.string().describe(
          "What you want the Planner to focus on. Frame the work, name " +
          "the constraints, point at relevant tree state. The Planner " +
          "reads this alongside the user's original message.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, userId, username, nodeId, rootId, chatId, sessionId } = args;
        const briefing = typeof args.briefing === "string" ? args.briefing.trim() : "";
        if (!briefing) return text("governing-hire-planner: briefing is required.");
        if (briefing.length > BRIEFING_CAP) {
          return text(`governing-hire-planner: briefing exceeds ${BRIEFING_CAP} chars; trim or push detail into your reasoning.`);
        }
        if (!visitorId) return text("governing-hire-planner: missing visitorId; substrate bug — surface.");
        if (!userId) return text("governing-hire-planner: missing userId; substrate bug.");

        // Resolve the Ruler scope (the scope where the Planner anchors).
        const ruler = await resolveRulerScope(nodeId);
        if (!ruler) {
          return text(
            "governing-hire-planner: no Ruler scope resolvable from current node. " +
            "runRulerTurn should promote before tool calls reach here; surface as substrate bug.",
          );
        }

        // Spawn the Planner as a chainstep. The Planner runs in its
        // own session (separate visitorId via runChat's ephemeral
        // session-key), with its own modeKey, system prompt, and
        // context. Its tool calls (governing-emit-plan) write the
        // structured emission to metadata. PLAN_PROPOSED websocket
        // event fires during the run; the user sees the plan card.
        log.info("Governing",
          `🧭 Ruler hiring Planner at ${String(ruler._id).slice(0, 8)} ` +
          `(briefing length: ${briefing.length}c)`);

        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);
        const { spawnRoleAsChainstep } = await import("../tree-orchestrator/ruling.js");
        const plannerAnswer = await spawnRoleAsChainstep({
          modeKey: "tree:governing-planner",
          message: briefing,
          userId,
          username,
          rootId: rootId || null,
          nodeId: String(ruler._id),
          parentChatId: chatId || null,
          parentSessionId: sessionId || null,
          signal: callerSignal,
          socket: callerSocket,
          source: "ruler-spawned-planner",
        });

        // Read the active plan emission to build the summary. The
        // Planner should have written it via governing-emit-plan; if
        // not, surface that as a substrate bug.
        const { getExtension } = await import("../loader.js");
        const governing = getExtension("governing")?.exports;
        let emission = null;
        try {
          if (governing?.readActivePlanEmission) {
            emission = await governing.readActivePlanEmission(ruler._id);
          }
        } catch (err) {
          log.debug("Governing", `hire-planner: emission readback skipped: ${err.message}`);
        }

        const summary = formatPlannerSpawnSummary(emission);
        if (!summary.ok) {
          // Planner ran but didn't emit. Surface honestly.
          return text(JSON.stringify({
            ok: false,
            decision: "hire-planner",
            briefing,
            plannerAnswerPreview: typeof plannerAnswer === "string"
              ? plannerAnswer.slice(0, 240)
              : null,
            note: "Planner ran but no plan emission detected at this Ruler scope. " +
                  "Either the Planner failed to call governing-emit-plan, or there's " +
                  "a substrate bug. Synthesize an honest response to the user about " +
                  "the situation; consider revise-plan if the model needs another shot.",
          }, null, 2));
        }

        // Emit the plan card to the user. The card carries the
        // structured emission and renders Accept/Revise/Cancel
        // buttons. Accept → user message "yes" → next Ruler turn
        // reads lifecycle.awaiting === "contracts" and calls
        // hire-contractor.
        await emitPlanCard({ visitorId, ruler, emission, isRevision: false });

        // Optional: record a lightweight decision marker so audit walks
        // can see the Ruler chose hire-planner this turn. Not load-
        // bearing for dispatch (the work has already happened).
        setRulerDecision(visitorId, { kind: "hire-planner", briefing, emissionId: summary.emissionId });

        return text(JSON.stringify({
          decision: "hire-planner",
          briefing,
          ...summary,
          note: "Plan emitted; plan card has been sent to the user with " +
                "Accept/Revise/Cancel buttons. Synthesize a BRIEF response " +
                "(1-2 sentences) acknowledging what was drafted and naming " +
                "what the user should do next (review the card, accept to " +
                "proceed, or describe revisions). Do NOT restate the plan " +
                "in your text — the card carries it. If the summary " +
                "suggests the Planner misunderstood (wrong branch names, " +
                "wrong leaf/branch counts), call revise-plan with a " +
                "corrective briefing instead.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-hire-contractor
    //
    // The plan exists but contracts haven't been ratified yet. This
    // is the typical state immediately after Planner emits, before
    // execution can dispatch. Spawns Contractor as a chainstep,
    // awaits its emission, returns concise summary. The Ruler reads
    // the summary, decides whether the contracts look right, then
    // synthesizes for the user.
    //
    // Use when lifecycle.awaiting === "contracts" — your snapshot's
    // lifecycle field indicates this directly.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-hire-contractor",
      description:
        "Hire a Contractor to draft contracts shaped around the active " +
        "plan. Spawns the Contractor as a chainstep child of your turn " +
        "— it reads the active plan emission, identifies shared " +
        "vocabulary (events, storage keys, dom ids, message types, " +
        "function signatures) that sub-domains must agree on, validates " +
        "scope authority against the LCA of named consumers, and emits " +
        "the contract set to metadata. Tool returns a concise summary " +
        "(emission ordinal, count, kinds, names). You read the summary " +
        "and synthesize for the user.\n\n" +
        "Use when your snapshot shows lifecycle.awaiting === 'contracts' " +
        "— a plan is approved at this scope but no contracts have been " +
        "ratified yet. Args: briefing (optional context for the " +
        "Contractor; the Contractor reads the plan emission directly, " +
        "so briefing is for nuance you want to add).",
      schema: {
        briefing: z.string().optional().describe(
          "Optional. Additional context for the Contractor beyond the " +
          "plan emission it reads automatically. Useful for naming " +
          "specific concerns (\"the contract between client and server " +
          "for onScore needs to carry playerId\"). Leave empty if the " +
          "plan emission is self-explanatory.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, userId, username, nodeId, rootId, chatId, sessionId } = args;
        if (!visitorId) return text("governing-hire-contractor: missing visitorId; substrate bug.");
        if (!userId) return text("governing-hire-contractor: missing userId; substrate bug.");

        const briefing = typeof args.briefing === "string" ? args.briefing.trim() : "";
        if (briefing.length > BRIEFING_CAP) {
          return text(`governing-hire-contractor: briefing exceeds ${BRIEFING_CAP} chars; trim.`);
        }

        const ruler = await resolveRulerScope(nodeId);
        if (!ruler) {
          return text("governing-hire-contractor: no Ruler scope resolvable. Surface as substrate bug.");
        }

        // Verify a plan emission exists. Hiring a Contractor without
        // a plan is meaningless; surface the precondition violation
        // honestly so the Ruler can decide what to do (probably
        // hire-planner instead).
        const { getExtension } = await import("../loader.js");
        const governing = getExtension("governing")?.exports;
        let planEmission = null;
        try {
          if (governing?.readActivePlanEmission) {
            planEmission = await governing.readActivePlanEmission(ruler._id);
          }
        } catch {}
        if (!planEmission) {
          return text(JSON.stringify({
            ok: false,
            decision: "hire-contractor",
            note:
              "No active plan emission at this Ruler scope. Contracts " +
              "are drafted around an approved plan; without one, the " +
              "Contractor has nothing to shape contracts against. " +
              "Hire a Planner first (governing-hire-planner) or, if " +
              "the user's request is a question rather than work, " +
              "call governing-respond-directly.",
          }, null, 2));
        }

        // Compose the Contractor's brief. The Planner's full emission
        // is read by the Contractor automatically through enrichContext;
        // we just frame the task and pass any Ruler-supplied nuance.
        const planText =
          `## Reasoning\n${planEmission.reasoning || ""}\n\n## Plan\n` +
          (planEmission.steps || []).map((s, i) => {
            if (s.type === "leaf") return `${i + 1}. [leaf] ${s.spec || ""}`;
            if (s.type === "branch") {
              const subs = (s.branches || []).map((b) => `   - ${b.name}: ${b.spec || ""}`).join("\n");
              return `${i + 1}. [branch] ${s.rationale || ""}\n${subs}`;
            }
            return "";
          }).filter(Boolean).join("\n\n");

        const contractorMessage =
          `The Ruler at this scope approved this plan:\n\n${planText}\n\n` +
          (briefing ? `Ruler's additional briefing:\n${briefing}\n\n` : "") +
          `Draft contracts shaped around the approved plan. Identify shared ` +
          `vocabulary (events, storage keys, dom ids, message types, function ` +
          `signatures) the named sub-domains must agree on. Emit via ` +
          `governing-emit-contracts. Validate scope authority against the LCA ` +
          `of named consumers; the dispatcher rejects contracts whose scope ` +
          `exceeds the LCA.`;

        log.info("Governing",
          `📜 Ruler hiring Contractor at ${String(ruler._id).slice(0, 8)} ` +
          `(plan emission-${planEmission.ordinal})`);

        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);
        const { spawnRoleAsChainstep } = await import("../tree-orchestrator/ruling.js");
        const contractorAnswer = await spawnRoleAsChainstep({
          modeKey: "tree:governing-contractor",
          message: contractorMessage,
          userId,
          username,
          rootId: rootId || null,
          nodeId: String(ruler._id),
          parentChatId: chatId || null,
          parentSessionId: sessionId || null,
          signal: callerSignal,
          socket: callerSocket,
          source: "ruler-spawned-contractor",
        });

        let emission = null;
        try {
          if (governing?.readActiveContractsEmission) {
            emission = await governing.readActiveContractsEmission(ruler._id);
          }
        } catch {}

        const summary = formatContractorSpawnSummary(emission);
        if (!summary.ok) {
          return text(JSON.stringify({
            ok: false,
            decision: "hire-contractor",
            contractorAnswerPreview: typeof contractorAnswer === "string"
              ? contractorAnswer.slice(0, 240)
              : null,
            note:
              "Contractor ran but no contracts emission detected. Either " +
              "the Contractor judged no contracts needed (legitimate for " +
              "trivial plans with no sub-domain coordination), or " +
              "substrate bug. Synthesize honestly for the user.",
          }, null, 2));
        }

        setRulerDecision(visitorId, {
          kind: "hire-contractor",
          briefing: briefing || null,
          emissionId: summary.emissionId,
        });

        return text(JSON.stringify({
          decision: "hire-contractor",
          briefing: briefing || null,
          ...summary,
          note:
            "Contracts ratified. Lifecycle now awaiting:dispatch (Stage 2 " +
            "tooling). For now, synthesize a brief response naming the " +
            "ratified contracts and that the next step is dispatch. If " +
            "the contracts shape looks wrong (missing critical seams, " +
            "scope violations), the user may want to revise the plan; " +
            "consider revise-plan in that case.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-route-to-foreman
    //
    // Active execution exists. The user's message is about it — status
    // question, retry intent, pause/resume, failure inquiry, etc. The
    // Foreman wakes with the user's message + execution state and
    // decides.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-route-to-foreman",
      description:
        "Spawn the Foreman as a chainstep child of your turn to make " +
        "an execution-judgment decision. The Foreman runs in its own " +
        "LLM call (own context — call-stack snapshot of execution " +
        "state), reads the wakeup reason + user message, decides retry " +
        "/ mark-failed / freeze / pause / escalate / respond-directly, " +
        "and exits. Tool returns the Foreman's exit text. You read it " +
        "and synthesize a final response to the user.\n\n" +
        "Use when execution is in progress and the user's message is " +
        "about it (status, retry, pause, resume, failure questions). " +
        "Args: wakeupReason — short label (\"user-status-query\", " +
        "\"user-retry-request\", \"user-pause-request\", etc.).",
      schema: {
        wakeupReason: z.string().describe(
          "Short label for why you're routing to the Foreman. The Foreman " +
          "reads this alongside the user message to focus its judgment.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, userId, username, nodeId, rootId, chatId, sessionId } = args;
        const wakeupReason = typeof args.wakeupReason === "string" ? args.wakeupReason.trim() : "";
        if (!wakeupReason) return text("governing-route-to-foreman: wakeupReason is required.");
        if (!visitorId) return text("governing-route-to-foreman: missing visitorId; substrate bug.");
        if (!userId) return text("governing-route-to-foreman: missing userId; substrate bug.");

        const ruler = await resolveRulerScope(nodeId);
        if (!ruler) {
          return text(
            "governing-route-to-foreman: no Ruler scope resolvable. " +
            "Surface as substrate bug.",
          );
        }

        log.info("Governing",
          `🔧 Ruler routing to Foreman at ${String(ruler._id).slice(0, 8)} ` +
          `(reason=${wakeupReason})`);

        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);
        const { spawnRoleAsChainstep } = await import("../tree-orchestrator/ruling.js");
        const foremanAnswer = await spawnRoleAsChainstep({
          modeKey: "tree:governing-foreman",
          // Foreman's "user message" is the wakeup reason + payload.
          // The Foreman mode prompt reads ctx.foremanWakeup separately
          // for richer context; for the plain message field, this
          // works as the conversational entry-point.
          message: `Wakeup: ${wakeupReason}\n\n` +
                   "Read the execution-stack snapshot in your prompt and decide.",
          userId,
          username,
          rootId: rootId || null,
          nodeId: String(ruler._id),
          parentChatId: chatId || null,
          parentSessionId: sessionId || null,
          signal: callerSignal,
          socket: callerSocket,
          source: "ruler-spawned-foreman",
        });

        // The Foreman's exit text (from foreman-respond-directly or
        // foreman-escalate-to-ruler) IS the answer flowing back. The
        // Ruler reads it and synthesizes for the user.
        const foremanText = typeof foremanAnswer === "string" && foremanAnswer.trim()
          ? foremanAnswer.trim()
          : "(Foreman did not produce exit text — surface as substrate bug if execution state didn't change either.)";

        setRulerDecision(visitorId, { kind: "route-to-foreman", wakeupReason });

        return text(JSON.stringify({
          decision: "route-to-foreman",
          wakeupReason,
          foremanAnswer: foremanText.length > 1500
            ? foremanText.slice(0, 1500) + "…"
            : foremanText,
          note: "Foreman's response above. Synthesize a brief reply to the " +
                "user that frames what the Foreman judged. If the Foreman " +
                "escalated (returned an escalation summary instead of a " +
                "direct response), consider whether YOU need to take further " +
                "action — revise-plan, archive-plan, etc.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-respond-directly
    //
    // The user asked something the Ruler can answer from current
    // state without changing anything: a question, a clarification,
    // an acknowledgement. The response string is what the user sees.
    // No other roles run.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-respond-directly",
      description:
        "Respond to the user yourself, without invoking other roles. " +
        "Use for questions, clarifications, status reports the Ruler " +
        "can answer from current state, acknowledgements, gentle " +
        "redirections. Args: response — what the user will see.",
      schema: {
        response: z.string().describe(
          "The user-facing reply. Direct, useful, grounded in the state " +
          "you just read in your prompt. Don't pretend to do work you " +
          "didn't do; if the user is asking for work, hire a Planner instead.",
        ),
      },
      annotations: { readOnlyHint: true },
      async handler(args) {
        const { visitorId } = args;
        const response = typeof args.response === "string" ? args.response.trim() : "";
        if (!response) {
          return text("governing-respond-directly: response is required.");
        }
        if (response.length > RESPONSE_CAP) {
          return text(`governing-respond-directly: response exceeds ${RESPONSE_CAP} chars; trim.`);
        }
        if (!visitorId) {
          return text("governing-respond-directly: missing visitorId; substrate bug — surface.");
        }
        setRulerDecision(visitorId, { kind: "respond-directly", response });
        return text(JSON.stringify({
          ok: true,
          decision: "respond-directly",
          responsePreview: response.length > 240 ? response.slice(0, 240) + "…" : response,
          message: "Response recorded. Exit your turn now.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-revise-plan
    //
    // An active plan exists; the user is asking for changes to it
    // (or the Ruler judges the current plan inadequate). Archive the
    // active plan, hire the Planner with a revision briefing.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-revise-plan",
      description:
        "Archive the currently-approved plan and hire a Planner to " +
        "draft a replacement. Use when the user describes changes to " +
        "an existing plan, when execution surfaced that the plan was " +
        "wrong, or when contracts ratified under the plan reveal a " +
        "better decomposition. Args: revisionReason — what changed.",
      schema: {
        revisionReason: z.string().describe(
          "Why you're revising. The Planner reads this when drafting the new plan.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, userId, username, nodeId, rootId, chatId, sessionId } = args;
        const revisionReason = typeof args.revisionReason === "string" ? args.revisionReason.trim() : "";
        if (!revisionReason) return text("governing-revise-plan: revisionReason is required.");
        if (revisionReason.length > REASON_CAP) {
          return text(`governing-revise-plan: revisionReason exceeds ${REASON_CAP} chars; trim.`);
        }
        if (!visitorId) return text("governing-revise-plan: missing visitorId; substrate bug.");
        if (!userId) return text("governing-revise-plan: missing userId; substrate bug.");

        const ruler = await resolveRulerScope(nodeId);
        if (!ruler) {
          return text("governing-revise-plan: no Ruler scope resolvable. Surface as substrate bug.");
        }

        // Archive the prior emission via the Ruler's plan approval
        // ledger. The next Planner emission will supersede it.
        const { getExtension } = await import("../loader.js");
        const governing = getExtension("governing")?.exports;
        try {
          if (governing?.readActivePlanApproval && governing?.appendPlanApproval) {
            const prior = await governing.readActivePlanApproval(ruler._id);
            if (prior?.planRef) {
              await governing.appendPlanApproval({
                rulerNodeId: ruler._id,
                planNodeId: prior.planRef.split(":")[0],
                status: "archived",
                supersedes: prior.planRef,
                reason: `revise: ${revisionReason}`.slice(0, 500),
              });
            }
          }
        } catch (err) {
          log.debug("Governing", `revise-plan: archive prior approval skipped: ${err.message}`);
        }

        // Spawn Planner with revision briefing.
        log.info("Governing",
          `🧭 Ruler revising plan at ${String(ruler._id).slice(0, 8)} ` +
          `(reason: ${revisionReason.slice(0, 80)})`);

        const briefing =
          `The Ruler is revising the prior plan at this scope. Reason:\n\n` +
          `${revisionReason}\n\n` +
          `Draft a new plan addressing the revision while honoring contracts ` +
          `already ratified at this scope (visible in your enrichContext block).`;

        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);
        const { spawnRoleAsChainstep } = await import("../tree-orchestrator/ruling.js");
        const plannerAnswer = await spawnRoleAsChainstep({
          modeKey: "tree:governing-planner",
          message: briefing,
          userId,
          username,
          rootId: rootId || null,
          nodeId: String(ruler._id),
          parentChatId: chatId || null,
          parentSessionId: sessionId || null,
          signal: callerSignal,
          socket: callerSocket,
          source: "ruler-revise-planner",
        });

        let emission = null;
        try {
          if (governing?.readActivePlanEmission) {
            emission = await governing.readActivePlanEmission(ruler._id);
          }
        } catch {}

        const summary = formatPlannerSpawnSummary(emission);
        if (!summary.ok) {
          return text(JSON.stringify({
            ok: false,
            decision: "revise-plan",
            revisionReason,
            plannerAnswerPreview: typeof plannerAnswer === "string" ? plannerAnswer.slice(0, 240) : null,
            note: "Revision Planner ran but no new emission detected. Surface as substrate bug or try again.",
          }, null, 2));
        }

        // Emit the updated plan card. version increments via
        // emission.ordinal; the dashboard supersedes the prior card.
        await emitPlanCard({ visitorId, ruler, emission, isRevision: true });

        setRulerDecision(visitorId, { kind: "revise-plan", revisionReason, emissionId: summary.emissionId });

        return text(JSON.stringify({
          decision: "revise-plan",
          revisionReason,
          ...summary,
          note: "Revised plan emitted, prior archived. Plan card updated " +
                "for the user. Synthesize a brief response naming what " +
                "changed and pointing the user at the updated card.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-dispatch-execution
    //
    // The plan is approved and contracts are ratified. Now run the
    // execution. This tool spawns the dispatch flow as a chainstep:
    //   - Foreman primitives create the execution-record.
    //   - Worker (in the user's domain mode like tree:code-plan)
    //     writes the Ruler's own leaf steps at this scope.
    //   - swarm.runBranchSwarm dispatches sub-Ruler turns recursively.
    //   - On completion, Foreman wakes for the swarm-completed
    //     judgment (freeze record terminal status).
    //
    // For non-trivial plans this can be minutes to hours of work
    // (each sub-Ruler runs its own Planner / Contractor / Worker
    // pipeline recursively). The tool synchronously awaits the whole
    // dispatch and returns a summary. The user sees streaming events
    // (BRANCH_STARTED, BRANCH_COMPLETE, etc.) during the run and a
    // final summary at exit.
    //
    // Use when lifecycle.awaiting === "dispatch" — your snapshot
    // shows plan ratified, contracts ratified, execution absent. The
    // user's message indicating they want to proceed is the cue.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-dispatch-execution",
      description:
        "Dispatch the approved plan + ratified contracts to execution. " +
        "Spawns the full dispatch flow as a chainstep child of your " +
        "turn: execution-record created, Ruler-own integration runs " +
        "(Worker writes leaf-step files at this scope), sub-Ruler " +
        "turns recursively dispatch each branch step, and the Foreman " +
        "judges the terminal status when work completes.\n\n" +
        "Use when your snapshot shows lifecycle.awaiting === 'dispatch' " +
        "— a plan exists, contracts are ratified, no execution has " +
        "started yet. Args: none (the tool reads the active plan and " +
        "contracts emissions directly).\n\n" +
        "This can take significant time for large plans (each sub-" +
        "Ruler runs its own pipeline recursively). The user sees " +
        "streaming events during. The tool returns a summary when " +
        "everything settles.",
      schema: {},
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, userId, username, nodeId, rootId, chatId, sessionId } = args;
        if (!visitorId) return text("governing-dispatch-execution: missing visitorId; substrate bug.");
        if (!userId) return text("governing-dispatch-execution: missing userId; substrate bug.");

        const ruler = await resolveRulerScope(nodeId);
        if (!ruler) {
          return text("governing-dispatch-execution: no Ruler scope resolvable. Surface as substrate bug.");
        }

        // Verify preconditions: plan + contracts must exist. Without
        // them, dispatch has nothing to run and the Ruler should
        // route to hire-planner or hire-contractor first.
        const { getExtension } = await import("../loader.js");
        const governing = getExtension("governing")?.exports;
        const planEmission = governing?.readActivePlanEmission
          ? await governing.readActivePlanEmission(ruler._id)
          : null;
        if (!planEmission) {
          return text(JSON.stringify({
            ok: false,
            decision: "dispatch-execution",
            note:
              "No active plan emission. Hire a Planner first " +
              "(governing-hire-planner) — dispatch needs a plan to dispatch.",
          }, null, 2));
        }
        const contractsEmission = governing?.readActiveContractsEmission
          ? await governing.readActiveContractsEmission(ruler._id)
          : null;
        if (!contractsEmission) {
          return text(JSON.stringify({
            ok: false,
            decision: "dispatch-execution",
            note:
              "No active contracts emission. Hire a Contractor first " +
              "(governing-hire-contractor) — sub-Rulers need shared " +
              "vocabulary before dispatch.",
          }, null, 2));
        }

        // Build branch list from the plan emission's branch steps.
        // Each entry maps to a sub-Ruler dispatch in swarm.runBranchSwarm.
        const branches = [];
        for (const step of (planEmission.steps || [])) {
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

        log.info("Governing",
          `🚀 Ruler dispatching execution at ${String(ruler._id).slice(0, 8)} ` +
          `(plan emission-${planEmission.ordinal}, ` +
          `contracts emission-${contractsEmission.ordinal}, ` +
          `${branches.length} branches)`);

        // Resolve workspace mode for Ruler-own integration phase.
        // The user's tree may be a code-workspace, book-workspace,
        // etc. Use the persisted workspace mode at this scope (or
        // default to tree:code-plan).
        let stashedModeKey = "tree:code-plan";
        try {
          const Node = (await import("../../seed/models/node.js")).default;
          const scopeNode = await Node.findById(ruler._id).select("metadata").lean();
          const meta = scopeNode?.metadata instanceof Map
            ? Object.fromEntries(scopeNode.metadata)
            : (scopeNode?.metadata || {});
          // Look for a workspace mode hint in tree metadata; if any
          // workspace extension installed at this scope, use its
          // -plan mode.
          if (meta?.modes?.plan) stashedModeKey = meta.modes.plan;
        } catch {}

        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);

        // Invoke the refactored dispatch flow. dispatchSwarmPlan still
        // exists in tree-orchestrator/dispatch.js but its Contractor
        // step (Step 1) has been removed (Stage 1 moved that to the
        // hire-contractor tool). What remains: execution-record, Ruler-
        // own integration, swarm dispatch, Foreman freeze.
        let dispatchSummary = "";
        try {
          const { dispatchSwarmPlan, getActiveRequest } = await Promise.all([
            import("../tree-orchestrator/dispatch.js"),
            import("../tree-orchestrator/state.js"),
          ]).then(([d, s]) => ({
            dispatchSwarmPlan: d.dispatchSwarmPlan,
            getActiveRequest: s.getActiveRequest,
          }));
          const activeRequest = getActiveRequest(visitorId) || {};
          const planData = {
            branches,
            contracts: contractsEmission.contracts || [],
            projectNodeId: String(ruler._id),
            projectName: ruler.name || null,
            userRequest: "",
            architectChatId: chatId || null,
            rootChatId: chatId || null,
            rootId: rootId || null,
            modeKey: stashedModeKey,
            targetNodeId: String(ruler._id),
            cleanedAnswer: "",
            emission: planEmission,
          };
          const runtimeCtx = {
            visitorId,
            userId,
            username,
            rootId: rootId || null,
            sessionId: sessionId || null,
            signal: callerSignal,
            slot: activeRequest.slot || null,
            socket: activeRequest.socket || null,
            onToolLoopCheckpoint: activeRequest.onToolLoopCheckpoint || null,
            rt: activeRequest.rt || null,
            rootChatId: chatId || null,
          };
          dispatchSummary = await dispatchSwarmPlan(planData, runtimeCtx);
        } catch (err) {
          log.warn("Governing",
            `dispatch-execution: dispatchSwarmPlan failed: ${err.message}`);
          return text(JSON.stringify({
            ok: false,
            decision: "dispatch-execution",
            error: err.message,
            note: "Dispatch failed. Synthesize an honest report to the user.",
          }, null, 2));
        }

        // Read back execution-record state for the summary.
        let execStatus = "unknown";
        let execStepCounts = null;
        try {
          if (governing?.readActiveExecutionRecord) {
            const record = await governing.readActiveExecutionRecord(ruler._id);
            execStatus = record?.status || "unknown";
            const counts = { done: 0, failed: 0, blocked: 0, pending: 0, running: 0 };
            for (const s of (record?.stepStatuses || [])) {
              counts[s?.status] = (counts[s?.status] || 0) + 1;
            }
            execStepCounts = counts;
          }
        } catch {}

        setRulerDecision(visitorId, {
          kind: "dispatch-execution",
          planEmissionId: planEmission._emissionNodeId,
          contractsEmissionId: contractsEmission._emissionNodeId,
        });

        return text(JSON.stringify({
          decision: "dispatch-execution",
          executionStatus: execStatus,
          stepCounts: execStepCounts,
          dispatchSummary: typeof dispatchSummary === "string" && dispatchSummary.length > 1500
            ? dispatchSummary.slice(0, 1500) + "…"
            : dispatchSummary,
          note:
            "Dispatch completed. Synthesize a brief response naming what " +
            "was built (or what failed) and pointing at the user's tree.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-archive-plan
    //
    // Discard the active plan (and execution if any) without
    // immediately replacing. Use when the user is dropping the work
    // entirely or the Ruler has decided no decomposition is needed
    // here at all (the plan was a mistake).
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-archive-plan",
      description:
        "Archive the active plan (and freeze any active execution) " +
        "without immediately replacing. Use when the user is dropping " +
        "this work, or when you've decided the plan is wrong and you " +
        "want clean state before any next move. Args: reason.",
      schema: {
        reason: z.string().describe("Why you're archiving."),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId } = args;
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason) return text("governing-archive-plan: reason is required.");
        if (!visitorId) return text("governing-archive-plan: missing visitorId; substrate bug.");
        setRulerDecision(visitorId, { kind: "archive-plan", reason });
        return text(JSON.stringify({ ok: true, decision: "archive-plan", reason }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-pause-execution
    //
    // Active execution-record flips to "paused"; sub-Rulers halt
    // dispatch. Resumes via governing-resume-execution.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-pause-execution",
      description:
        "Pause the active execution at this scope. Sub-Rulers halt; " +
        "no further branches dispatch until you call resume. Use when " +
        "you need to wait on the user, court, or external information " +
        "before letting work continue. Args: reason.",
      schema: {
        reason: z.string().describe("Why you're pausing."),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId } = args;
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason) return text("governing-pause-execution: reason is required.");
        if (!visitorId) return text("governing-pause-execution: missing visitorId; substrate bug.");
        setRulerDecision(visitorId, { kind: "pause-execution", reason });
        return text(JSON.stringify({ ok: true, decision: "pause-execution", reason }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-resume-execution
    //
    // Un-pause. Foreman wakes up to decide what's next given the
    // execution-record's current state.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-resume-execution",
      description:
        "Resume execution after a pause. Spawns the Foreman as a " +
        "chainstep to decide next steps given the execution-record's " +
        "current state (the Foreman reads what's pending, what failed " +
        "before pause, etc., and chooses retry/freeze/escalate). The " +
        "tool clears pause markers first, then spawns the Foreman, " +
        "then returns the Foreman's exit text. Args: reason.",
      schema: {
        reason: z.string().describe("Why you're resuming."),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, userId, username, nodeId, rootId, chatId, sessionId } = args;
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason) return text("governing-resume-execution: reason is required.");
        if (!visitorId) return text("governing-resume-execution: missing visitorId; substrate bug.");
        if (!userId) return text("governing-resume-execution: missing userId; substrate bug.");

        const ruler = await resolveRulerScope(nodeId);
        if (!ruler) {
          return text("governing-resume-execution: no Ruler scope resolvable.");
        }

        const { getExtension } = await import("../loader.js");
        const governing = getExtension("governing")?.exports;

        // Clear pause markers via direct metadata write so the
        // Foreman wakes to a non-paused record.
        try {
          if (governing?.readActiveExecutionRecord) {
            const record = await governing.readActiveExecutionRecord(ruler._id);
            if (record?._recordNodeId && record.status === "paused") {
              const NodeModel = (await import("../../seed/models/node.js")).default;
              const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
              const recNode = await NodeModel.findById(record._recordNodeId);
              if (recNode) {
                const meta = recNode.metadata instanceof Map
                  ? recNode.metadata.get("governing")
                  : recNode.metadata?.governing;
                const exec = meta?.execution || {};
                await setExtMeta(recNode, "governing", {
                  ...(meta || {}),
                  execution: {
                    ...exec, status: "running", completedAt: null,
                    pausedAtStepIndex: null, pausedReason: null, pausedAt: null,
                    pendingPauseAt: null, pendingPauseReason: null,
                    resumedAt: new Date().toISOString(),
                    resumeReason: reason.slice(0, 500),
                  },
                });
              }
            }
          }
        } catch (err) {
          log.debug("Governing", `resume-execution: pause-clear skipped: ${err.message}`);
        }

        log.info("Governing",
          `▶️ Ruler resuming execution at ${String(ruler._id).slice(0, 8)} (reason: ${reason.slice(0, 80)})`);

        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);
        const { spawnRoleAsChainstep } = await import("../tree-orchestrator/ruling.js");
        const foremanAnswer = await spawnRoleAsChainstep({
          modeKey: "tree:governing-foreman",
          message: `Wakeup: resume-requested\n\nReason: ${reason}\n\n` +
                   "Read the execution-stack snapshot, decide what's next given the unpaused state.",
          userId,
          username,
          rootId: rootId || null,
          nodeId: String(ruler._id),
          parentChatId: chatId || null,
          parentSessionId: sessionId || null,
          signal: callerSignal,
          socket: callerSocket,
          source: "ruler-resume-foreman",
        });

        const foremanText = typeof foremanAnswer === "string" && foremanAnswer.trim()
          ? foremanAnswer.trim()
          : "(Foreman did not produce exit text on resume.)";

        setRulerDecision(visitorId, { kind: "resume-execution", reason });

        return text(JSON.stringify({
          decision: "resume-execution",
          reason,
          foremanAnswer: foremanText.length > 1500 ? foremanText.slice(0, 1500) + "…" : foremanText,
          note: "Pause cleared, Foreman ran and returned the response above. Synthesize for user.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-read-plan-detail
    //
    // The Ruler's snapshot only carries plan summaries. Use this to
    // pull the full active plan emission when the snapshot is
    // insufficient — e.g., before deciding revise-plan vs respond-
    // directly, or before briefing the Planner.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-read-plan-detail",
      description:
        "Read the FULL active plan emission at this scope (reasoning " +
        "+ every step including leaves and branch rationales). Use when " +
        "your snapshot summary isn't enough and you need to see the full " +
        "plan before deciding. Returns the structured emission. Does NOT " +
        "end your turn — call another tool after.",
      schema: {},
      annotations: { readOnlyHint: true },
      async handler(args) {
        const { nodeId } = args;
        if (!nodeId) return text("governing-read-plan-detail: missing nodeId.");
        try {
          const { getExtension } = await import("../loader.js");
          const governing = getExtension("governing")?.exports;
          if (!governing?.readActivePlanEmission) {
            return text("governing-read-plan-detail: governing.readActivePlanEmission unavailable.");
          }
          const emission = await governing.readActivePlanEmission(nodeId);
          if (!emission) {
            return text(JSON.stringify({ ok: true, emission: null, message: "No active plan emission at this scope." }));
          }
          return text(JSON.stringify({ ok: true, emission }, null, 2));
        } catch (err) {
          return text(`governing-read-plan-detail: read failed: ${err.message}`);
        }
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-convene-court (Pass 2 stub)
    //
    // Pass 1 substrate doesn't have court hearings. The slot exists
    // because the Ruler having "convene a court" as part of its
    // decision surface makes the architecture honest — the Ruler's
    // judgment includes recognizing when judgment exceeds its own
    // capacity. Today the tool writes a court-pending marker, fires
    // governing:courtConvened, and tells the user honestly that Pass
    // 2 court reasoning lands later.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-convene-court",
      description:
        "Convene a court hearing. Use when conditions are ambiguous " +
        "enough that judgment exceeds your own capacity — contract " +
        "conflicts between sub-Rulers, repeated unexplained failures, " +
        "an operator escalation, evidence that work was done in bad " +
        "faith. Pass 1 substrate marks the court as pending and " +
        "surfaces to the operator; Pass 2 will populate the hearing's " +
        "reasoning surface. Args: reason — the dispute as you see it.",
      schema: {
        reason: z.string().describe(
          "What the dispute is. Be specific about which sub-Rulers, " +
          "which contracts, which evidence. Pass 2 courts will read this verbatim.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, nodeId } = args;
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason) return text("governing-convene-court: reason is required.");
        if (!visitorId) return text("governing-convene-court: missing visitorId; substrate bug.");

        // Write a court-pending marker on the Ruler scope (durable —
        // courts are part of the audit trail). Doesn't replace the
        // decision register; the register still records the Ruler's
        // turn-level choice.
        try {
          if (nodeId) {
            const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
            const node = await Node.findById(nodeId);
            if (node) {
              const meta = node.metadata instanceof Map
                ? node.metadata.get("governing")
                : node.metadata?.governing;
              const existingPending = Array.isArray(meta?.courtPending) ? meta.courtPending : [];
              await setExtMeta(node, "governing", {
                ...(meta || {}),
                courtPending: [
                  ...existingPending,
                  { reason, convenedAt: new Date().toISOString(), status: "pending-pass2" },
                ],
              });
            }
          }
          const { hooks } = await import("../../seed/hooks.js");
          hooks.run("governing:courtConvened", {
            rulerNodeId: nodeId ? String(nodeId) : null,
            reason,
          }).catch(() => {});
        } catch (err) {
          log.warn("Governing", `convene-court marker write failed: ${err.message}`);
        }

        setRulerDecision(visitorId, { kind: "convene-court", reason });
        return text(JSON.stringify({
          ok: true,
          decision: "convene-court",
          message:
            "Court convened (Pass 1 marker written; Pass 2 reasoning surface " +
            "lands later). The orchestrator will surface this to the operator.",
        }));
      },
    },
  ];
}
