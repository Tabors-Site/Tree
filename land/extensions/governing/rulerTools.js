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
import {
  tryClaim as tryClaimSpawn,
  release as releaseSpawn,
  buildPendingResponse as buildSpawnPending,
} from "./state/inFlightSpawns.js";

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

// Emit the plan card upward via governingPlanProposed (or
// governingPlanUpdated for revisions). The card carries the
// structured emission so the translation layer (chat panel + future
// surfaces) renders reasoning + steps + branches and presents a
// ratification gate. Ratification flows back as a normal instruction
// → next Ruler turn reads lifecycle.awaiting === "contracts" and
// calls hire-contractor.
//
// IMPORTANT: cards are emitted ONLY for entry-scope Rulers (no parent
// Ruler in their lineage). Sub-Rulers chain forward through their
// lifecycle in one turn — the authority above a sub-Ruler is its
// parent's cycle, which already ratified the parent plan and
// implicitly ratifies the sub-plan. Emitting a card at a sub-Ruler
// scope would surface a phantom gate that doesn't exist
// architecturally.
//
// Future: Rulers may want to escalate explicit questions to the
// authority above ("two valid decompositions, pick one"). That
// mechanism doesn't exist yet; when it does, it'll be an explicit
// ask-above tool, not a side-effect of hire-planner.
//
// Event names live in governing/wsEvents.js. The legacy swarm
// equivalents (swarmPlanProposed/Updated) are also fired during the
// transition so existing translation-layer code paths that haven't
// migrated keep working — drop the dual emit once all listeners are
// updated.
//
// Returns true if emit succeeded, false if skipped (sub-Ruler, no
// socket, or no emission).
async function emitPlanCard({ visitorId, ruler, emission, isRevision }) {
  if (!visitorId || !emission) return false;

  // Entry-scope vs sub-Ruler detection. Sub-Rulers have a parentRulerId
  // in their lineage; entry-scope Rulers (the scope where the
  // instruction-chain first landed) don't.
  try {
    const { readLineage } = await import("./state/lineage.js");
    const lineage = ruler?._id ? await readLineage(ruler._id) : null;
    if (lineage?.parentRulerId) {
      log.info("Governing",
        `🎴 Plan card skipped at sub-Ruler ${String(ruler._id).slice(0, 8)} ` +
        `(parent=${String(lineage.parentRulerId).slice(0, 8)}); ` +
        `parent cycle implicitly ratifies — no external gate at this scope`);
      return false;
    }
  } catch (err) {
    // If lineage read fails, fall through and emit the card — better
    // to over-show than under-show during a transient read failure.
    log.debug("Governing", `emitPlanCard lineage check skipped: ${err.message}`);
  }

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
    // the Planner emits, the plan is presented for ratification —
    // either explicitly at entry scope or implicitly via the parent
    // cycle at sub-Ruler scope. The Ruler's prompt is uniform across
    // both cases; the translation layer handles surface rendering.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-hire-planner",
      description:
        "Hire a Planner to decompose the work at this scope. Spawns " +
        "the Planner as a chainstep child of your turn — it runs in " +
        "its own LLM call (own context, own prompt), emits a structured " +
        "plan to metadata, and the plan card is emitted upward for " +
        "ratification. The tool returns a concise summary (emission " +
        "ordinal, reasoning headline, leaf/branch counts, branch names). " +
        "You read the summary, decide whether the plan looks reasonable " +
        "(call revise-plan if not — rare), then synthesize an " +
        "instruction-completion-report about what was drafted.\n\n" +
        "Use when the instruction from above describes new work or " +
        "new structure needing decomposition. Args: briefing (your " +
        "instructions to the Planner — what frame, what constraints, " +
        "what to consider). The Planner reads this alongside the " +
        "original instruction from above.",
      schema: {
        briefing: z.string().describe(
          "What you want the Planner to focus on. Frame the work, name " +
          "the constraints, point at relevant tree state. The Planner " +
          "reads this alongside the original instruction from above.",
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

        // In-flight guard: refuse a duplicate hire-planner if one is
        // already running at this scope. Combines with fire-and-forget
        // below: the guard prevents the retry race; fire-and-forget
        // prevents the MCP timeout that causes the retry.
        const claim = tryClaimSpawn({
          rulerNodeId: ruler._id,
          kind: "hire-planner",
          visitorId,
          briefing,
        });
        if (!claim.ok) {
          log.info("Governing",
            `⏳ Ruler hire-planner at ${String(ruler._id).slice(0, 8)} ` +
            `refused: already in-flight (${claim.since})`);
          return text(JSON.stringify(
            buildSpawnPending({ existing: claim.existing, kind: "hire-planner" }),
            null, 2,
          ));
        }

        // Fire-and-forget. The Planner spawns in the background; this
        // handler returns immediately. When the Planner finishes, the
        // governing:plannerCompleted hook fires (with the result, the
        // in-flight slot release, and a Ruler wake-up). The Ruler's
        // next turn reads the new plan emission from its snapshot and
        // proceeds.
        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);
        const { spawnRoleAsChainstepAsync } = await import("../tree-orchestrator/ruling.js");
        const spawn = spawnRoleAsChainstepAsync({
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
          kind: "hire-planner",
          completionHookName: "governing:plannerCompleted",
          hookPayload: { briefing },
          releaseClaimKey: claim.key,
        });
        if (!spawn?.spawnId) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "hire-planner",
            error: "spawn-failed-to-start",
            note: "Planner spawn could not be initiated. Substrate bug.",
          }, null, 2));
        }

        setRulerDecision(visitorId, {
          kind: "hire-planner",
          briefing,
          spawnId: spawn.spawnId,
        });

        return text(JSON.stringify({
          status: "spawned",
          decision: "hire-planner",
          spawnId: spawn.spawnId,
          rulerNodeId: String(ruler._id),
          briefing: briefing.slice(0, 200),
          note:
            "Planner spawn started in the background. This turn ends now. " +
            "Synthesize one short sentence — 'Planner hired. Awaiting emission.' — " +
            "and stop. Do NOT call another spawn-tool this turn. Do NOT pretend " +
            "the plan is available. When the Planner finishes its work, the " +
            "governing:plannerCompleted hook wakes you in a fresh turn; you'll " +
            "see the new plan in your snapshot then and proceed (typically by " +
            "calling hire-contractor).",
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
        "and synthesize an instruction-completion-report for above.\n\n" +
        "Use when your snapshot shows lifecycle.awaiting === 'contracts' " +
        "— a plan is ratified at this scope but no contracts have been " +
        "emitted yet. Args: briefing (optional context for the " +
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
              "are drafted around a ratified plan; without one, the " +
              "Contractor has nothing to shape contracts against. " +
              "Hire a Planner first (governing-hire-planner) or, if " +
              "the instruction from above is a question rather than work, " +
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
          `Draft contracts and emit ONCE via governing-emit-contracts.\n\n` +
          `ROOT scope: always emit substantive contracts. Root names are ` +
          `project-level vocabulary every reader, sub-Ruler, future ` +
          `revision, and Pass 2 court will reference. Even a flat plan ` +
          `commits at root: file path, exported component or function ` +
          `names, DOM ids the artifact creates, state-type names, ` +
          `storage keys. Use scope: local:[<this-scope>] for these.\n\n` +
          `CHILD scope: read parent contracts (visible above this ` +
          `briefing) first. Three outcomes:\n` +
          `  1. Plan introduces new vocabulary the parent didn't cover ` +
          `→ emit substantive contracts for the new names with scope ` +
          `local:[<this-scope>] or shared:[A,B] for cross-sub coordination.\n` +
          `  2. Plan entirely inherits — every name is already in parent ` +
          `contracts → emit an INHERITANCE DECLARATION with inheritsFrom: ` +
          `<parent-ruler-id>, parentContractsApplied: [<refs>], and ` +
          `contracts: []. This is a real ratified state, not the absence ` +
          `of one. Pass 2 reads it as a signed inheritance commitment.\n` +
          `  3. Mix of new + inherited → emit substantive contracts for ` +
          `the new names; inherited names are implicit (not re-emitted).\n\n` +
          `Validate scope authority against the LCA of named consumers; ` +
          `contracts whose scope exceeds the LCA are rejected. There is ` +
          `no exit path without emitting — empty contracts arrays are ` +
          `rejected unless paired with an inheritance declaration.`;

        log.info("Governing",
          `📜 Ruler hiring Contractor at ${String(ruler._id).slice(0, 8)} ` +
          `(plan emission-${planEmission.ordinal})`);

        // In-flight guard.
        const claim = tryClaimSpawn({
          rulerNodeId: ruler._id,
          kind: "hire-contractor",
          visitorId,
          briefing,
        });
        if (!claim.ok) {
          log.info("Governing",
            `⏳ Ruler hire-contractor at ${String(ruler._id).slice(0, 8)} ` +
            `refused: already in-flight (${claim.since})`);
          return text(JSON.stringify(
            buildSpawnPending({ existing: claim.existing, kind: "hire-contractor" }),
            null, 2,
          ));
        }

        // Fire-and-forget. Contractor runs in background; this handler
        // returns immediately. governing:contractorCompleted fires when
        // the Contractor settles; the Ruler wakes on that hook in a
        // fresh turn and reads the new contracts emission.
        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);
        const { spawnRoleAsChainstepAsync } = await import("../tree-orchestrator/ruling.js");
        const spawn = spawnRoleAsChainstepAsync({
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
          kind: "hire-contractor",
          completionHookName: "governing:contractorCompleted",
          hookPayload: { briefing: briefing || null },
          releaseClaimKey: claim.key,
        });
        if (!spawn?.spawnId) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "hire-contractor",
            error: "spawn-failed-to-start",
            note: "Contractor spawn could not be initiated. Substrate bug.",
          }, null, 2));
        }

        setRulerDecision(visitorId, {
          kind: "hire-contractor",
          briefing: briefing || null,
          spawnId: spawn.spawnId,
        });

        return text(JSON.stringify({
          status: "spawned",
          decision: "hire-contractor",
          spawnId: spawn.spawnId,
          rulerNodeId: String(ruler._id),
          note:
            "Contractor spawn started in the background. This turn ends now. " +
            "Synthesize one short sentence — 'Contractor hired. Awaiting contracts.' — " +
            "and stop. Do NOT call another spawn-tool this turn. When the " +
            "Contractor finishes, governing:contractorCompleted wakes you; " +
            "you'll see the new contracts in your snapshot and typically " +
            "proceed with dispatch-execution.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-route-to-foreman
    //
    // Active execution exists. The instruction from above concerns it
    // — status question, retry intent, pause/resume, failure inquiry,
    // etc. The Foreman wakes with the wakeup reason + execution state
    // and decides.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-route-to-foreman",
      description:
        "Spawn the Foreman as a chainstep child of your turn to make " +
        "an execution-judgment decision. The Foreman runs in its own " +
        "LLM call (own context — call-stack snapshot of execution " +
        "state), reads the wakeup reason and the instruction from " +
        "above, decides retry / mark-failed / freeze / pause / escalate " +
        "/ respond-directly, and exits. Tool returns the Foreman's exit " +
        "text. You read it and synthesize an instruction-completion-" +
        "report for the authority above.\n\n" +
        "Use when execution is in progress and the instruction from " +
        "above concerns it (status, retry, pause, resume, failure " +
        "questions). Args: wakeupReason — short label " +
        "(\"status-query\", \"retry-request\", \"pause-request\", etc.).",
      schema: {
        wakeupReason: z.string().describe(
          "Short label for why you're routing to the Foreman. The Foreman " +
          "reads this alongside the instruction context to focus its judgment.",
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

        // In-flight guard.
        const claim = tryClaimSpawn({
          rulerNodeId: ruler._id,
          kind: "route-to-foreman",
          visitorId,
          briefing: wakeupReason,
        });
        if (!claim.ok) {
          log.info("Governing",
            `⏳ Ruler route-to-foreman at ${String(ruler._id).slice(0, 8)} ` +
            `refused: already in-flight (${claim.since})`);
          return text(JSON.stringify(
            buildSpawnPending({ existing: claim.existing, kind: "route-to-foreman" }),
            null, 2,
          ));
        }

        // Fire-and-forget. Foreman runs in background; governing:
        // foremanRouted fires when it settles. The Ruler wakes in a
        // fresh turn and reads execution state — which the Foreman
        // may have mutated (freeze, retry, mark-failed, etc.).
        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);
        const { spawnRoleAsChainstepAsync } = await import("../tree-orchestrator/ruling.js");
        const spawn = spawnRoleAsChainstepAsync({
          modeKey: "tree:governing-foreman",
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
          kind: "route-to-foreman",
          completionHookName: "governing:foremanRouted",
          hookPayload: { wakeupReason },
          releaseClaimKey: claim.key,
        });
        if (!spawn?.spawnId) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "route-to-foreman",
            error: "spawn-failed-to-start",
          }, null, 2));
        }

        setRulerDecision(visitorId, {
          kind: "route-to-foreman",
          wakeupReason,
          spawnId: spawn.spawnId,
        });

        return text(JSON.stringify({
          status: "spawned",
          decision: "route-to-foreman",
          spawnId: spawn.spawnId,
          rulerNodeId: String(ruler._id),
          wakeupReason,
          note:
            "Foreman spawn started in the background. This turn ends now. " +
            "Synthesize one short sentence — 'Foreman engaged on " +
            `${wakeupReason}.'` +
            " — and stop. Do NOT predict what the Foreman will do. When the " +
            "Foreman finishes, governing:foremanRouted wakes you in a fresh " +
            "turn; you'll read its exit text from the wakeup payload and " +
            "synthesize the actual instruction-completion-report THEN.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-respond-directly
    //
    // The instruction from above is something the Ruler can answer from
    // current state without changing anything: a question, a
    // clarification, an acknowledgement. The response string is the
    // report that goes above. No other roles run.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-respond-directly",
      description:
        "Respond above yourself, without invoking other roles. " +
        "Use for questions, clarifications, status reports the Ruler " +
        "can answer from current state, acknowledgements, gentle " +
        "redirections. Args: response — the instruction-completion-" +
        "report that goes above.",
      schema: {
        response: z.string().describe(
          "The report above. Direct, useful, grounded in the state " +
          "you just read in your prompt. Don't pretend to do work you " +
          "didn't do; if the instruction asks for work, hire a Planner instead.",
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
        "Archive the currently-ratified plan and hire a Planner to " +
        "draft a replacement. Use when the instruction from above " +
        "describes changes to an existing plan, when execution surfaced " +
        "that the plan was wrong, or when contracts ratified under the " +
        "plan reveal a better decomposition. Args: revisionReason — " +
        "what changed.",
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
        let archived = false;
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
              archived = true;
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

        // In-flight guard. revise-plan and hire-planner share the
        // same downstream work (spawn a Planner). Both use the
        // "hire-planner" claim key so a revise can't race a hire,
        // either direction.
        const claim = tryClaimSpawn({
          rulerNodeId: ruler._id,
          kind: "hire-planner",
          visitorId,
          briefing: revisionReason,
        });
        if (!claim.ok) {
          log.info("Governing",
            `⏳ Ruler revise-plan at ${String(ruler._id).slice(0, 8)} ` +
            `refused: planner already in-flight (${claim.since})`);
          return text(JSON.stringify(
            buildSpawnPending({ existing: claim.existing, kind: "revise-plan" }),
            null, 2,
          ));
        }

        // Fire-and-forget. The revision Planner runs in background;
        // when it settles, governing:planRevised fires and wakes the
        // Ruler in a fresh turn. The Ruler reads the new plan from
        // its snapshot and proceeds.
        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);
        const { spawnRoleAsChainstepAsync } = await import("../tree-orchestrator/ruling.js");
        const spawn = spawnRoleAsChainstepAsync({
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
          kind: "revise-plan",
          completionHookName: "governing:planRevised",
          hookPayload: { revisionReason },
          releaseClaimKey: claim.key,
        });
        if (!spawn?.spawnId) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "revise-plan",
            error: "spawn-failed-to-start",
            note: "Revision spawn could not be initiated.",
          }, null, 2));
        }

        setRulerDecision(visitorId, {
          kind: "revise-plan",
          revisionReason,
          spawnId: spawn.spawnId,
        });

        return text(JSON.stringify({
          status: "spawned",
          decision: "revise-plan",
          spawnId: spawn.spawnId,
          rulerNodeId: String(ruler._id),
          revisionReason,
          priorArchived: archived,
          note:
            "Prior plan archived. Revision Planner started in the background. " +
            "This turn ends now. Synthesize 'Plan revision in progress.' and " +
            "stop. When the revision settles, governing:planRevised wakes you; " +
            "you'll see the new emission in your snapshot.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-dispatch-execution
    //
    // The plan is approved and contracts are ratified. Now run the
    // execution. This tool spawns the dispatch flow as a chainstep:
    //   - Foreman primitives create the execution-record.
    //   - Typed Workers (build/refine/review/integrate) write the
    //     Ruler's own leaf steps at this scope. Dispatch picks the
    //     mode per leaf via governing.lookupWorkerMode.
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

        // In-flight guard. dispatch-execution is the longest-running
        // tool in the substrate — a 6-chapter book swarm can exceed
        // 30 minutes. Fire-and-forget below sidesteps the MCP timeout
        // entirely; the guard still catches duplicate dispatch calls
        // that the Ruler could accidentally emit (e.g., on transient
        // tool errors followed by retry).
        const claim = tryClaimSpawn({
          rulerNodeId: ruler._id,
          kind: "dispatch-execution",
          visitorId,
        });
        if (!claim.ok) {
          log.info("Governing",
            `⏳ Ruler dispatch-execution at ${String(ruler._id).slice(0, 8)} ` +
            `refused: already in-flight (${claim.since})`);
          return text(JSON.stringify(
            buildSpawnPending({ existing: claim.existing, kind: "dispatch-execution" }),
            null, 2,
          ));
        }

        // Worker dispatch is fully owned by governance's typed Worker
        // resolver now — dispatch.resolveWorkerModeForType picks the
        // mode per leaf based on the leaf's workerType + governing's
        // workspace registry. The legacy stashedModeKey (the workspace
        // plan mode the user originally invoked) is no longer threaded
        // through; dispatch infers the workspace from the registry.

        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);

        // Invoke the refactored dispatch flow. dispatchSwarmPlan still
        // exists in tree-orchestrator/dispatch.js but its Contractor
        // step (Step 1) has been removed (Stage 1 moved that to the
        // hire-contractor tool). What remains: execution-record, Ruler-
        // own integration, swarm dispatch, Foreman freeze.
        // Fire-and-forget dispatch. Returns immediately; the
        // recursive swarm runs in background. The Foreman's existing
        // swarm-completed wakeup (fired from inside dispatchSwarmPlan
        // when all branches settle) is what eventually drives the
        // Ruler to read terminal state and synthesize the user-facing
        // report. governing:swarmDispatched also fires here on settle
        // (success or failure) to wake the Ruler in a fresh turn.
        const { getActiveRequest } = await import("../tree-orchestrator/state.js");
        const { dispatchSwarmPlan } = await import("../tree-orchestrator/dispatch.js");
        const activeRequest = getActiveRequest(visitorId) || {};
        const spawnId = `spawn_${Date.now().toString(36)}_dispatch`;
        const planData = {
          branches,
          contracts: contractsEmission.contracts || [],
          projectNodeId: String(ruler._id),
          projectName: ruler.name || null,
          userRequest: "",
          architectChatId: chatId || null,
          rootChatId: chatId || null,
          rootId: rootId || null,
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
        const startedAt = Date.now();

        // LIFECYCLE_ACTIVE start. dispatch-execution is the longest
        // phase in any lifecycle and the most important one for the
        // user to see "still active" through. Fire via emitToUser so
        // the chip reaches every socket the user has open right now
        // (not just the one captured at request time — that one goes
        // stale during long dispatches and across page reloads).
        if (userId) {
          try {
            const { emitToUser } = await import("../../seed/ws/websocket.js");
            const { WS } = await import("../../seed/protocol.js");
            emitToUser(String(userId), WS.LIFECYCLE_ACTIVE, {
              active: true,
              rulerNodeId: String(ruler._id),
              rootId: rootId || null,
              phase: "dispatch-execution",
              spawnId,
              branchCount: branches.length,
              at: new Date().toISOString(),
            });
          } catch (err) {
            log.debug("Governing", `LIFECYCLE_ACTIVE emit (dispatch start) skipped: ${err.message}`);
          }
        }

        // Register a spawn-local AbortController so the stop button
        // can cancel the entire dispatch chain (sub-Rulers, Worker
        // batches, recursive sub-spawns). Without this, the stop
        // button can't halt fire-and-forget dispatches — the user's
        // only escape is killing the server.
        const dispatchAbort = new AbortController();
        if (callerSignal) {
          if (callerSignal.aborted) dispatchAbort.abort();
          else callerSignal.addEventListener("abort", () => dispatchAbort.abort(), { once: true });
        }
        let unregisterDispatchAbort = () => {};
        try {
          const { registerSpawnAbort } = await import("../tree-orchestrator/spawnAborts.js");
          unregisterDispatchAbort = registerSpawnAbort(String(userId), dispatchAbort, `dispatch:${spawnId.slice(0, 8)}`);
        } catch {}
        runtimeCtx.signal = dispatchAbort.signal;

        // Kick off the dispatch WITHOUT awaiting. On settle (success
        // or failure), release the claim + fire governing:swarmDispatched.
        (async () => {
          let dispatchSummary = "";
          let dispatchError = null;
          try {
            dispatchSummary = await dispatchSwarmPlan(planData, runtimeCtx);
          } catch (err) {
            dispatchError = String(err?.message || err);
            log.warn("Governing",
              `dispatch-execution: dispatchSwarmPlan failed: ${dispatchError}`);
          }
          releaseSpawn(claim.key);
          try { unregisterDispatchAbort(); } catch {}

          // LIFECYCLE_ACTIVE clear for dispatch via emitToUser so
          // it survives the user's request socket closing.
          if (userId) {
            try {
              const { emitToUser } = await import("../../seed/ws/websocket.js");
              const { WS } = await import("../../seed/protocol.js");
              emitToUser(String(userId), WS.LIFECYCLE_ACTIVE, {
                active: false,
                rulerNodeId: String(ruler._id),
                rootId: rootId || null,
                phase: "dispatch-execution",
                spawnId,
                error: dispatchError,
                durationMs: Date.now() - startedAt,
                at: new Date().toISOString(),
              });
            } catch (err) {
              log.debug("Governing", `LIFECYCLE_ACTIVE emit (dispatch clear) skipped: ${err.message}`);
            }
          }

          try {
            const { hooks } = await import("../../seed/hooks.js");
            hooks.run("governing:swarmDispatched", {
              spawnId,
              rulerNodeId: String(ruler._id),
              rootId: rootId || null,
              userId: userId || null,
              username: username || null,
              parentChatId: chatId || null,
              parentSessionId: sessionId || null,
              socket: activeRequest.socket || null,
              signal: callerSignal,
              source: "ruler-dispatch-execution",
              dispatchSummary: typeof dispatchSummary === "string"
                ? dispatchSummary.slice(0, 4000)
                : null,
              error: dispatchError,
              durationMs: Date.now() - startedAt,
              planEmissionId: planEmission._emissionNodeId,
              contractsEmissionId: contractsEmission._emissionNodeId,
            }).catch(() => {});
          } catch (hookErr) {
            log.debug("Governing",
              `governing:swarmDispatched fire skipped: ${hookErr.message}`);
          }
        })();

        setRulerDecision(visitorId, {
          kind: "dispatch-execution",
          spawnId,
          planEmissionId: planEmission._emissionNodeId,
          contractsEmissionId: contractsEmission._emissionNodeId,
        });

        return text(JSON.stringify({
          status: "spawned",
          decision: "dispatch-execution",
          spawnId,
          rulerNodeId: String(ruler._id),
          branchCount: branches.length,
          note:
            "Dispatch started in the background. This turn ends now. " +
            `Synthesize one short sentence — 'Dispatch started across ${branches.length} branch${branches.length === 1 ? "" : "es"}.' — ` +
            "and stop. The recursive swarm runs asynchronously; sub-Rulers " +
            "promote, plan, contract, dispatch their own work. When the " +
            "swarm settles, governing:swarmDispatched (and the Foreman's " +
            "swarm-completed wakeup) drive a fresh Ruler turn that synthesizes " +
            "the final report. Do NOT predict outcomes or pretend the work " +
            "is done.",
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-archive-plan
    //
    // Discard the active plan (and freeze any active execution) without
    // immediately replacing. Use when the instruction from above drops
    // the work entirely (Cancel button), or when the Ruler decides the
    // plan was wrong and wants clean state before any next move.
    //
    // Differs from governing-revise-plan: this DOES NOT spawn a new
    // Planner. The next Ruler turn sees no active plan and decides
    // afresh (hire-planner if work is still needed, ask the user above,
    // etc.). Cancel-without-replan is the canonical operator gesture
    // for "this plan was a mistake; let me think about what I actually
    // want."
    //
    // Wire requirement: the handler must write a real archive entry to
    // the plan-approval ledger AND freeze any active execution-record
    // as "cancelled" so the governing:executionCancelled hook fires
    // (distinct from Completed/Failed — courts read terminal-status
    // semantics for adjudication). A handler that only logged the
    // decision but didn't write state was the substrate-honesty bug
    // matched to the auto-mark-done bug; both classes belong together.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-archive-plan",
      description:
        "Archive the active plan (and freeze any active execution as " +
        "cancelled) without immediately replacing. Use when the " +
        "instruction from above drops this work, or when you've " +
        "decided the plan is wrong and you want clean state before " +
        "any next move. Next Ruler turn sees no active plan. " +
        "Args: reason.",
      schema: {
        reason: z.string().describe("Why you're archiving."),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { visitorId, nodeId } = args;
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason) return text("governing-archive-plan: reason is required.");
        if (!visitorId) return text("governing-archive-plan: missing visitorId; substrate bug.");

        const ruler = await resolveRulerScope(nodeId);
        if (!ruler) {
          return text("governing-archive-plan: no Ruler scope resolvable. Surface as substrate bug.");
        }

        const { getExtension } = await import("../loader.js");
        const governing = getExtension("governing")?.exports;

        // 1. Archive the prior plan-approval via the ledger. Same
        // mechanism revise-plan uses, minus the Planner spawn.
        let archived = false;
        let archivedRef = null;
        try {
          if (governing?.readActivePlanApproval && governing?.appendPlanApproval) {
            const prior = await governing.readActivePlanApproval(ruler._id);
            if (prior?.planRef) {
              archivedRef = prior.planRef;
              await governing.appendPlanApproval({
                rulerNodeId: ruler._id,
                planNodeId: prior.planRef.split(":")[0],
                status: "archived",
                supersedes: prior.planRef,
                reason: `archive: ${reason}`.slice(0, 500),
              });
              archived = true;
            }
          }
        } catch (err) {
          log.warn("Governing",
            `archive-plan: appendPlanApproval failed: ${err.message}`);
        }

        // 2. Freeze any active execution-record at this Ruler as
        // "cancelled" (not failed, not completed) so the
        // governing:executionCancelled hook fires. The distinct hook
        // matters: courts and Pass 2 adjudication read the terminal
        // status to know whether work tried-and-couldn't (failed),
        // succeeded (completed), or was deliberately stopped
        // (cancelled). Cancel is the right semantic for archive-plan.
        let executionCancelled = false;
        let cancelledRecordNodeId = null;
        try {
          if (governing?.readActiveExecutionRecord && governing?.freezeExecutionRecord) {
            const rec = await governing.readActiveExecutionRecord(ruler._id);
            if (rec?._recordNodeId) {
              const terminal = new Set(["completed", "failed", "cancelled", "superseded", "paused"]);
              if (!terminal.has(rec.status)) {
                cancelledRecordNodeId = rec._recordNodeId;
                await governing.freezeExecutionRecord({
                  recordNodeId: rec._recordNodeId,
                  nextStatus: "cancelled",
                });
                executionCancelled = true;
              }
            }
          }
        } catch (err) {
          log.warn("Governing",
            `archive-plan: freezeExecutionRecord failed: ${err.message}`);
        }

        log.info("Governing",
          `🗂  Ruler archive-plan at ${String(ruler._id).slice(0, 8)}: ` +
          `plan ${archived ? `archived (${archivedRef || "?"})` : "had no active approval"}, ` +
          `execution ${executionCancelled ? "cancelled" : "had no active record"}`);

        // 3. Audit-trail register (kept for parity with other Ruler
        // tools; the real state writes happened above).
        setRulerDecision(visitorId, { kind: "archive-plan", reason });

        return text(JSON.stringify({
          ok: true,
          decision: "archive-plan",
          reason,
          planArchived: archived,
          archivedPlanRef: archivedRef,
          executionCancelled,
          cancelledRecordNodeId,
          note: archived || executionCancelled
            ? "Archived. Next Ruler turn sees clean state — no active plan, no active execution."
            : "Nothing to archive — no active plan or execution at this Ruler scope.",
        }, null, 2));
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
        "you need to wait on the authority above, a court, or external " +
        "information before letting work continue. Args: reason.",
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

        // In-flight guard.
        const claim = tryClaimSpawn({
          rulerNodeId: ruler._id,
          kind: "resume-execution",
          visitorId,
          briefing: reason,
        });
        if (!claim.ok) {
          log.info("Governing",
            `⏳ Ruler resume-execution at ${String(ruler._id).slice(0, 8)} ` +
            `refused: already in-flight (${claim.since})`);
          return text(JSON.stringify(
            buildSpawnPending({ existing: claim.existing, kind: "resume-execution" }),
            null, 2,
          ));
        }

        // Fire-and-forget. Foreman wakes asynchronously; when its
        // decision settles, governing:foremanRouted fires (resume
        // uses the same hook as route-to-foreman — both spawn a
        // Foreman turn and the subsequent Ruler wake is the same
        // shape).
        const callerSignal = await getCallerAbortSignal(visitorId);
        const callerSocket = await getCallerSocket(visitorId);
        const { spawnRoleAsChainstepAsync } = await import("../tree-orchestrator/ruling.js");
        const spawn = spawnRoleAsChainstepAsync({
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
          kind: "resume-execution",
          completionHookName: "governing:foremanRouted",
          hookPayload: { wakeupReason: "resume-requested", resumeReason: reason },
          releaseClaimKey: claim.key,
        });
        if (!spawn?.spawnId) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "resume-execution",
            error: "spawn-failed-to-start",
          }, null, 2));
        }

        setRulerDecision(visitorId, {
          kind: "resume-execution",
          reason,
          spawnId: spawn.spawnId,
        });

        return text(JSON.stringify({
          status: "spawned",
          decision: "resume-execution",
          spawnId: spawn.spawnId,
          rulerNodeId: String(ruler._id),
          reason,
          note:
            "Pause cleared. Foreman spawn started in the background to decide " +
            "next steps from the unpaused state. This turn ends now. Synthesize " +
            "one short sentence — 'Execution resumed. Foreman judging next move.' — " +
            "and stop.",
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
        "an escalation from above this scope, evidence that work was " +
        "done in bad faith. Pass 1 substrate marks the court as pending " +
        "and surfaces it upward; Pass 2 will populate the hearing's " +
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
            "lands later). The orchestrator will surface this above the scope.",
        }));
      },
    },
  ];
}
