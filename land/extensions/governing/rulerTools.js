// Ruler tool surface.
//
// Two tool shapes, matched to what the tool actually does:
//
// DISPATCH — emits a SUMMON to another being's inbox and returns
//   immediately ("status: spawned"). The receiving being runs its
//   own role.summon in parallel via the per-being scheduler; when
//   it finishes, it replies via emitReplyToAsker which lands in
//   this Ruler's inbox and wakes its next turn. Tools: hire-planner,
//   hire-contractor, revise-plan, route-to-foreman, dispatch-execution,
//   resume-execution, ratify-plan.
//
// STATE-WRITE — writes metadata or fires a lifecycle hook, no LLM
//   spawn. Tools: archive-plan, pause-execution, convene-court,
//   respond-directly.
//
// INSPECTION — read-only utility that does NOT end the turn. The
//   Ruler can call it before deciding. Tools: read-plan-detail.
//
// Architecture: "the Ruler is the addressable being." Each role runs
// in its own LLM call (own mode, own context). The Ruler emits
// SUMMONs that fan work out across the substrate; replies fan back
// in via the inbox. No central dispatcher; no chainstep nesting.
// Each role's full output lives in metadata; only a concise summary
// reaches the Ruler's next turn.

import { z } from "zod";
import log from "../../seed/system/log.js";
import Space from "../../seed/models/space.js";
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
// emitPlanCard was the legacy direct-socket card emitter (called from
// hire-planner's old chainstep path). Retired in Slice 7: the plan card
// is now a reply-SUMMON from the Ruler to its delegateToHigherBeing
// (or chain-initial caller), and rendering happens client-side via the
// `ibp:summon` listener on the user-being's room. No direct
// socket emit, no helper function. See memory `card-is-a-summon`.

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

// Resolve the Ruler scope from the calling tool's spaceId. Used by
// spawn-and-await tools to anchor the Planner/Foreman/etc. at the
// right scope. Walks up via governing.findRulerScope.
async function resolveRulerScope(spaceId) {
  if (!spaceId) return null;
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (!governing?.findRulerScope) return null;
    return await governing.findRulerScope(spaceId);
  } catch {
    return null;
  }
}

// Caller signal/socket lookups retired 2026-05-18. SUMMON-based dispatch
// is fire-and-forget — cancellation routes through high-priority SUMMON
// + scheduler.abortByRootCorrelations, and the spawned being communicates
// via its own being-room broadcast (`io.to('being:'+beingId)`), not via
// the caller's socket. Hook payloads no longer carry `socket`/`signal`.

export default function getRulerTools(core) {
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
      verb: "summon",
      description:
        "Hire a Planner to decompose the work at this scope. Spawns " +
        "the Planner via SUMMON (fire-and-forget) — it runs in " +
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
        const { beingId, username, spaceId, rootId, summonId, sessionId } = args;
        const briefing = typeof args.briefing === "string" ? args.briefing.trim() : "";
        if (!briefing) return text("governing-hire-planner: briefing is required.");
        if (briefing.length > BRIEFING_CAP) {
          return text(`governing-hire-planner: briefing exceeds ${BRIEFING_CAP} chars; trim or push detail into your reasoning.`);
        }
        if (!beingId) return text("governing-hire-planner: missing beingId; substrate bug.");

        // Resolve the Ruler scope (the scope where the Planner anchors).
        const ruler = await resolveRulerScope(spaceId);
        if (!ruler) {
          return text(
            "governing-hire-planner: no Ruler scope resolvable from current node. " +
            "runRulerTurn should promote before tool calls reach here; surface as substrate bug.",
          );
        }

        // Hire the Planner via SUMMON. The chainstep mechanism is
        // retired; this tool now:
        //   1. Ensures the Plan trio + Planner being exist (eager —
        //      the SUMMON needs a concrete addressee).
        //   2. Appends the briefing to the Planner's inbox at the
        //      Ruler scope and wakes the per-being scheduler.
        //   3. Registers a handoff that re-fires the existing
        //      `governing:plannerCompleted` hook when the Planner
        //      replies — preserving the orchestrator's hook-driven
        //      Ruler wakeup path until Slice 7 retires the orchestrator.
        // The visible behavior is unchanged from the chainstep era:
        // tool returns "spawned" immediately; the Planner runs through
        // the bridge being's runChat under the scheduler; when
        // it finishes, the Ruler wakes for synthesis.
        log.info("Governing",
          `🧭 Ruler hiring Planner at ${String(ruler._id).slice(0, 8)} ` +
          `(briefing length: ${briefing.length}c)`);

        // In-flight guard: refuse a duplicate hire-planner if one is
        // already running at this scope. Still useful — same hire
        // tool firing twice (MCP retry, double-click) shouldn't open
        // two SUMMONs to the same Planner.
        const claim = tryClaimSpawn({
          rulerNodeId: ruler._id,
          kind: "hire-planner",
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

        // 1. Materialize the Plan trio + Planner being now (used to be
        //    deferred to the first governing-emit-plan call). SUMMON
        //    needs a concrete addressee with a unique username, so
        //    creation moves earlier in the lifecycle.
        const { ensurePlanAtScope } = await import("./state/planSpace.js");
        const planSpace = await ensurePlanAtScope({
          scopeNodeId: String(ruler._id),
          beingId,
          summonId,
          sessionId,
          core: _core,
        });
        if (!planSpace) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "hire-planner",
            error: "ensure-plan-failed",
            note: "Could not materialize the plan trio. Substrate bug.",
          }, null, 2));
        }

        // 2. Resolve the Planner being and its addressable username.
        //    Username is the canonical SUMMON qualifier; the role
        //    shorthand `@planner` would also work at the plan node but
        //    the per-instance username is unambiguous regardless of
        //    addressing position.
        const Space = (await import("../../seed/models/space.js")).default;
        const Being = (await import("../../seed/models/being.js")).default;
        const planNodeFull = await Space.findById(planSpace._id)
          .select("metadata").lean();
        const planBeings = planNodeFull?.metadata instanceof Map
          ? planNodeFull.metadata.get("beings")
          : planNodeFull?.metadata?.beings;
        const plannerBeingId = planBeings?.planner?.beingId || null;
        if (!plannerBeingId) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "hire-planner",
            error: "planner-being-missing",
            note: "Plan trio exists but Planner being unresolved. Substrate bug.",
          }, null, 2));
        }
        const planner = await Being.findById(plannerBeingId)
          .select("name").lean();
        const plannerUsername = planner?.name;
        if (!plannerUsername) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "hire-planner",
            error: "planner-username-missing",
          }, null, 2));
        }

        // 3. Resolve the Ruler being's username for the SUMMON `from`
        //    stance. The Ruler's wake-up path requires a real being on
        //    both sides; fall back to "ruler" as a defensive default
        //    if metadata is somehow incomplete (shouldn't happen — the
        //    governing extension's promote path stamps it).
        const rulerNodeFull = await Space.findById(ruler._id)
          .select("metadata").lean();
        const rulerBeings = rulerNodeFull?.metadata instanceof Map
          ? rulerNodeFull.metadata.get("beings")
          : rulerNodeFull?.metadata?.beings;
        const rulerBeingIdAtScope = rulerBeings?.ruler?.beingId || null;
        const rulerBeing = rulerBeingIdAtScope
          ? await Being.findById(rulerBeingIdAtScope).select("name").lean()
          : null;
        const rulerUsername = rulerBeing?.name || "ruler";

        // 4. Build stances. Path uses UUID for stability across renames.
        const { getLandDomain } = await import("../../seed/ibp/address.js");
        const landDomain = getLandDomain();
        const stancePath = `${landDomain}/${ruler._id}`;
        const rulerStance = `${stancePath}@${rulerUsername}`;
        const plannerStance = `${stancePath}@${plannerUsername}`;

        // 5. Build SUMMON envelope. rootCorrelation propagates the
        //    originating user message so a later cancel-by-root sweep
        //    can find every entry in the same chain.
        const { randomUUID } = await import("crypto");
        const correlation = randomUUID();
        const rootCorrelation = args.rootSummonId || summonId || correlation;
        const message = {
          from:            rulerStance,
          content:         briefing,
          correlation,
          rootCorrelation,
          priority:        3, // INTERACTIVE — user-initiated, ahead of background
          sentAt:          new Date().toISOString(),
        };

        // 6. Append + handoff + wake. The handoff carries the human's
        //    identity so the bridge being's runChat sees beingIn
        //    = the human (matches chainstep behavior); responseFromStance
        //    is the Planner stance for the reply's `from` field. The
        //    response handler re-fires the existing governing hook so
        //    the Ruler wakeup path stays unchanged.
        const { appendToInbox } = await import("../../seed/cognition/inbox.js");
        const { attachHandoff, wake } = await import("../../seed/cognition/scheduler.js");
        const { hooks } = await import("../../seed/system/hooks.js");
        const startMs = Date.now();

        try {
          await appendToInbox(String(ruler._id), plannerBeingId, message);
        } catch (err) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "hire-planner",
            error: "appendToInbox failed: " + (err?.message || String(err)),
          }, null, 2));
        }

        attachHandoff(plannerBeingId, correlation, {
          identity:           { beingId, username },
          resolved:           { being: "planner", spaceId: String(ruler._id), zone: "tree" },
          responseFromStance: plannerStance,
          onResponse: async (responseEntry) => {
            try { releaseSpawn(claim.key); } catch {}
            try {
              await hooks.fire("governing:plannerCompleted", {
                spawnId:         correlation,
                rulerNodeId:     String(ruler._id),
                beingId,
                username,
                rootId:          rootId || null,
                kind:            "hire-planner",
                briefing,
                exitText:        responseEntry?.content || null,
                durationMs:      Date.now() - startMs,
                error:           null,
                parentSummonId:  summonId || null,
                parentSessionId: sessionId || null,
              });
            } catch (err) {
              log.warn("Governing", `plannerCompleted hook fire failed: ${err.message}`);
            }
          },
          onError: async (err) => {
            try { releaseSpawn(claim.key); } catch {}
            try {
              await hooks.fire("governing:plannerCompleted", {
                spawnId:         correlation,
                rulerNodeId:     String(ruler._id),
                beingId,
                username,
                rootId:          rootId || null,
                kind:            "hire-planner",
                briefing,
                exitText:        null,
                durationMs:      Date.now() - startMs,
                error:           err?.message || String(err),
                parentSummonId:  summonId || null,
                parentSessionId: sessionId || null,
              });
            } catch (hookErr) {
              log.warn("Governing", `plannerCompleted (error path) hook fire failed: ${hookErr.message}`);
            }
          },
        });
        wake(plannerBeingId, String(ruler._id));

        return text(JSON.stringify({
          status: "spawned",
          decision: "hire-planner",
          spawnId: correlation,
          rulerNodeId: String(ruler._id),
          plannerStance,
          briefing: briefing.slice(0, 200),
          note:
            "Planner SUMMON sent. This turn ends now. " +
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
      verb: "summon",
      description:
        "Hire a Contractor to draft contracts shaped around the active " +
        "plan. Spawns the Contractor via SUMMON (fire-and-forget) " +
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
        const { beingId, username, spaceId, rootId, summonId, sessionId } = args;
        if (!beingId) return text("governing-hire-contractor: missing beingId; substrate bug.");

        const briefing = typeof args.briefing === "string" ? args.briefing.trim() : "";
        if (briefing.length > BRIEFING_CAP) {
          return text(`governing-hire-contractor: briefing exceeds ${BRIEFING_CAP} chars; trim.`);
        }

        const ruler = await resolveRulerScope(spaceId);
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

        // 1. Materialize contracts trio + Contractor being. SUMMON
        //    requires a concrete addressee with a unique username.
        const { ensureContractsNode } = await import("./state/contractsSpace.js");
        const contractsSpace = await ensureContractsNode({
          scopeNodeId: String(ruler._id),
          beingId,
          summonId,
          sessionId,
          core: _core,
        });
        if (!contractsSpace) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "hire-contractor",
            error: "ensure-contracts-failed",
            note: "Could not materialize the contracts trio. Substrate bug.",
          }, null, 2));
        }

        // 2. Resolve Contractor being + username at the contracts node.
        const Space = (await import("../../seed/models/space.js")).default;
        const Being = (await import("../../seed/models/being.js")).default;
        const contractsNodeFull = await Space.findById(contractsSpace._id)
          .select("metadata").lean();
        const contractBeings = contractsNodeFull?.metadata instanceof Map
          ? contractsNodeFull.metadata.get("beings")
          : contractsNodeFull?.metadata?.beings;
        const contractorBeingId = contractBeings?.contractor?.beingId || null;
        if (!contractorBeingId) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "hire-contractor",
            error: "contractor-being-missing",
            note: "Contracts trio exists but Contractor being unresolved. Substrate bug.",
          }, null, 2));
        }
        const contractor = await Being.findById(contractorBeingId)
          .select("name").lean();
        const contractorUsername = contractor?.name;
        if (!contractorUsername) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "hire-contractor",
            error: "contractor-username-missing",
          }, null, 2));
        }

        // 3. Resolve Ruler being's username for the SUMMON `from` stance.
        const rulerNodeFull = await Space.findById(ruler._id)
          .select("metadata").lean();
        const rulerBeings = rulerNodeFull?.metadata instanceof Map
          ? rulerNodeFull.metadata.get("beings")
          : rulerNodeFull?.metadata?.beings;
        const rulerBeingIdAtScope = rulerBeings?.ruler?.beingId || null;
        const rulerBeing = rulerBeingIdAtScope
          ? await Being.findById(rulerBeingIdAtScope).select("name").lean()
          : null;
        const rulerUsername = rulerBeing?.name || "ruler";

        // 4. Build stances + SUMMON envelope.
        const { getLandDomain } = await import("../../seed/ibp/address.js");
        const landDomain = getLandDomain();
        const stancePath = `${landDomain}/${ruler._id}`;
        const rulerStance = `${stancePath}@${rulerUsername}`;
        const contractorStance = `${stancePath}@${contractorUsername}`;

        const { randomUUID } = await import("crypto");
        const correlation = randomUUID();
        const rootCorrelation = args.rootSummonId || summonId || correlation;
        const message = {
          from:            rulerStance,
          content:         contractorMessage,
          correlation,
          rootCorrelation,
          priority:        3, // INTERACTIVE
          sentAt:          new Date().toISOString(),
        };

        // 5. Append + handoff + wake. Handoff onResponse re-fires the
        //    existing governing:contractorCompleted hook so the Ruler
        //    wake-up path stays unchanged.
        const { appendToInbox } = await import("../../seed/cognition/inbox.js");
        const { attachHandoff, wake } = await import("../../seed/cognition/scheduler.js");
        const { hooks } = await import("../../seed/system/hooks.js");
        const startMs = Date.now();

        try {
          await appendToInbox(String(ruler._id), contractorBeingId, message);
        } catch (err) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "hire-contractor",
            error: "appendToInbox failed: " + (err?.message || String(err)),
          }, null, 2));
        }

        attachHandoff(contractorBeingId, correlation, {
          identity:           { beingId, username },
          resolved:           { being: "contractor", spaceId: String(ruler._id), zone: "tree" },
          responseFromStance: contractorStance,
          onResponse: async (responseEntry) => {
            try { releaseSpawn(claim.key); } catch {}
            try {
              await hooks.fire("governing:contractorCompleted", {
                spawnId:         correlation,
                rulerNodeId:     String(ruler._id),
                beingId,
                username,
                rootId:          rootId || null,
                kind:            "hire-contractor",
                briefing:        briefing || null,
                exitText:        responseEntry?.content || null,
                durationMs:      Date.now() - startMs,
                error:           null,
                parentSummonId:  summonId || null,
                parentSessionId: sessionId || null,
              });
            } catch (err) {
              log.warn("Governing", `contractorCompleted hook fire failed: ${err.message}`);
            }
          },
          onError: async (err) => {
            try { releaseSpawn(claim.key); } catch {}
            try {
              await hooks.fire("governing:contractorCompleted", {
                spawnId:         correlation,
                rulerNodeId:     String(ruler._id),
                beingId,
                username,
                rootId:          rootId || null,
                kind:            "hire-contractor",
                briefing:        briefing || null,
                exitText:        null,
                durationMs:      Date.now() - startMs,
                error:           err?.message || String(err),
                parentSummonId:  summonId || null,
                parentSessionId: sessionId || null,
              });
            } catch (hookErr) {
              log.warn("Governing", `contractorCompleted (error path) hook fire failed: ${hookErr.message}`);
            }
          },
        });
        wake(contractorBeingId, String(ruler._id));

        return text(JSON.stringify({
          status: "spawned",
          decision: "hire-contractor",
          spawnId: correlation,
          rulerNodeId: String(ruler._id),
          contractorStance,
          note:
            "Contractor SUMMON sent. This turn ends now. " +
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
      verb: "summon",
      description:
        "Spawn the Foreman via SUMMON (fire-and-forget) to make " +
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
        const { beingId, username, spaceId, rootId, summonId, sessionId } = args;
        const wakeupReason = typeof args.wakeupReason === "string" ? args.wakeupReason.trim() : "";
        if (!wakeupReason) return text("governing-route-to-foreman: wakeupReason is required.");
        if (!beingId) return text("governing-route-to-foreman: missing beingId; substrate bug.");

        const ruler = await resolveRulerScope(spaceId);
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

        // 1. Materialize execution trio + Foreman being. SUMMON
        //    requires a concrete addressee with a unique username.
        const { ensureExecutionNode } = await import("./state/executionSpace.js");
        const executionSpace = await ensureExecutionNode({
          scopeNodeId: String(ruler._id),
          beingId,
          summonId,
          sessionId,
          core: _core,
        });
        if (!executionSpace) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "route-to-foreman",
            error: "ensure-execution-failed",
          }, null, 2));
        }

        // 2. Resolve Foreman being + username.
        const Space = (await import("../../seed/models/space.js")).default;
        const Being = (await import("../../seed/models/being.js")).default;
        const executionNodeFull = await Space.findById(executionSpace._id)
          .select("metadata").lean();
        const execBeings = executionNodeFull?.metadata instanceof Map
          ? executionNodeFull.metadata.get("beings")
          : executionNodeFull?.metadata?.beings;
        const foremanBeingId = execBeings?.foreman?.beingId || null;
        if (!foremanBeingId) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "route-to-foreman",
            error: "foreman-being-missing",
          }, null, 2));
        }
        const foreman = await Being.findById(foremanBeingId)
          .select("name").lean();
        const foremanUsername = foreman?.name;
        if (!foremanUsername) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "route-to-foreman",
            error: "foreman-username-missing",
          }, null, 2));
        }

        // 3. Resolve Ruler being's username for the `from` stance.
        const rulerNodeFull = await Space.findById(ruler._id)
          .select("metadata").lean();
        const rulerBeings = rulerNodeFull?.metadata instanceof Map
          ? rulerNodeFull.metadata.get("beings")
          : rulerNodeFull?.metadata?.beings;
        const rulerBeingIdAtScope = rulerBeings?.ruler?.beingId || null;
        const rulerBeing = rulerBeingIdAtScope
          ? await Being.findById(rulerBeingIdAtScope).select("name").lean()
          : null;
        const rulerUsername = rulerBeing?.name || "ruler";

        // 4. Build stances + SUMMON envelope.
        const { getLandDomain } = await import("../../seed/ibp/address.js");
        const landDomain = getLandDomain();
        const stancePath = `${landDomain}/${ruler._id}`;
        const rulerStance = `${stancePath}@${rulerUsername}`;
        const foremanStance = `${stancePath}@${foremanUsername}`;

        const { randomUUID } = await import("crypto");
        const correlation = randomUUID();
        const rootCorrelation = args.rootSummonId || summonId || correlation;
        const foremanMessage =
          `Wakeup: ${wakeupReason}\n\n` +
          "Read the execution-stack snapshot in your prompt and decide.";
        const message = {
          from:            rulerStance,
          content:         foremanMessage,
          correlation,
          rootCorrelation,
          priority:        3, // INTERACTIVE
          sentAt:          new Date().toISOString(),
        };

        // 5. Append + handoff + wake. Handoff onResponse re-fires the
        //    existing governing:foremanRouted hook so the Ruler wake-up
        //    path stays unchanged.
        const { appendToInbox } = await import("../../seed/cognition/inbox.js");
        const { attachHandoff, wake } = await import("../../seed/cognition/scheduler.js");
        const { hooks } = await import("../../seed/system/hooks.js");
        const startMs = Date.now();

        try {
          await appendToInbox(String(ruler._id), foremanBeingId, message);
        } catch (err) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "route-to-foreman",
            error: "appendToInbox failed: " + (err?.message || String(err)),
          }, null, 2));
        }

        attachHandoff(foremanBeingId, correlation, {
          identity:           { beingId, username },
          resolved:           { being: "foreman", spaceId: String(ruler._id), zone: "tree" },
          responseFromStance: foremanStance,
          onResponse: async (responseEntry) => {
            try { releaseSpawn(claim.key); } catch {}
            try {
              await hooks.fire("governing:foremanRouted", {
                spawnId:         correlation,
                rulerNodeId:     String(ruler._id),
                beingId,
                username,
                rootId:          rootId || null,
                kind:            "route-to-foreman",
                wakeupReason,
                exitText:        responseEntry?.content || null,
                durationMs:      Date.now() - startMs,
                error:           null,
                parentSummonId:  summonId || null,
                parentSessionId: sessionId || null,
              });
            } catch (err) {
              log.warn("Governing", `foremanRouted hook fire failed: ${err.message}`);
            }
          },
          onError: async (err) => {
            try { releaseSpawn(claim.key); } catch {}
            try {
              await hooks.fire("governing:foremanRouted", {
                spawnId:         correlation,
                rulerNodeId:     String(ruler._id),
                beingId,
                username,
                rootId:          rootId || null,
                kind:            "route-to-foreman",
                wakeupReason,
                exitText:        null,
                durationMs:      Date.now() - startMs,
                error:           err?.message || String(err),
                parentSummonId:  summonId || null,
                parentSessionId: sessionId || null,
              });
            } catch (hookErr) {
              log.warn("Governing", `foremanRouted (error path) hook fire failed: ${hookErr.message}`);
            }
          },
        });
        wake(foremanBeingId, String(ruler._id));

        return text(JSON.stringify({
          status: "spawned",
          decision: "route-to-foreman",
          spawnId: correlation,
          rulerNodeId: String(ruler._id),
          foremanStance,
          wakeupReason,
          note:
            "Foreman SUMMON sent. This turn ends now. " +
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
      verb: "summon",
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
                const response = typeof args.response === "string" ? args.response.trim() : "";
        if (!response) {
          return text("governing-respond-directly: response is required.");
        }
        if (response.length > RESPONSE_CAP) {
          return text(`governing-respond-directly: response exceeds ${RESPONSE_CAP} chars; trim.`);
        }
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
      verb: "summon",
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
        const { beingId, username, spaceId, rootId, summonId, sessionId } = args;
        const revisionReason = typeof args.revisionReason === "string" ? args.revisionReason.trim() : "";
        if (!revisionReason) return text("governing-revise-plan: revisionReason is required.");
        if (revisionReason.length > REASON_CAP) {
          return text(`governing-revise-plan: revisionReason exceeds ${REASON_CAP} chars; trim.`);
        }
        if (!beingId) return text("governing-revise-plan: missing beingId; substrate bug.");

        const ruler = await resolveRulerScope(spaceId);
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
                core: _core,
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

        // SUMMON the Planner via inbox. Same pattern as hire-planner:
        //   1. Ensure the plan trio is materialized (idempotent — exists already on revise).
        //   2. Resolve Planner being's username for the SUMMON stance.
        //   3. Append briefing to the Planner's inbox at the Ruler scope.
        //   4. Handoff releases the spawn claim and fires
        //      `governing:planRevised` for dashboard SSE on settle.
        //   5. wake() the per-being scheduler.
        //
        // The reply path is substrate-based: plannerRole.summon calls
        // emitReplyToAsker, which wakes the Ruler with the revision
        // emission visible in its next snapshot.
        const { ensurePlanAtScope } = await import("./state/planSpace.js");
        const planSpace = await ensurePlanAtScope({
          scopeNodeId: String(ruler._id),
          beingId,
          summonId,
          sessionId,
          core: _core,
        });
        if (!planSpace) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "revise-plan",
            error: "ensure-plan-failed",
            note: "Could not materialize the plan trio for revision. Substrate bug.",
          }, null, 2));
        }
        const NodeModel = (await import("../../seed/models/space.js")).default;
        const BeingModel = (await import("../../seed/models/being.js")).default;
        const planNodeFull = await NodeModel.findById(planSpace._id).select("metadata").lean();
        const planBeings = planNodeFull?.metadata instanceof Map
          ? planNodeFull.metadata.get("beings")
          : planNodeFull?.metadata?.beings;
        const plannerBeingId = planBeings?.planner?.beingId || null;
        if (!plannerBeingId) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "revise-plan",
            error: "planner-being-missing",
          }, null, 2));
        }
        const planner = await BeingModel.findById(plannerBeingId).select("name").lean();
        const plannerUsername = planner?.name;
        if (!plannerUsername) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "revise-plan",
            error: "planner-username-missing",
          }, null, 2));
        }
        const rulerNodeFull = await NodeModel.findById(ruler._id).select("metadata").lean();
        const rulerBeings = rulerNodeFull?.metadata instanceof Map
          ? rulerNodeFull.metadata.get("beings")
          : rulerNodeFull?.metadata?.beings;
        const rulerBeingIdAtScope = rulerBeings?.ruler?.beingId || null;
        const rulerBeing = rulerBeingIdAtScope
          ? await BeingModel.findById(rulerBeingIdAtScope).select("name").lean()
          : null;
        const rulerUsername = rulerBeing?.name || "ruler";

        const { getLandDomain } = await import("../../seed/ibp/address.js");
        const landDomain = getLandDomain();
        const stancePath = `${landDomain}/${ruler._id}`;
        const rulerStance = `${stancePath}@${rulerUsername}`;

        const { randomUUID } = await import("crypto");
        const correlation = randomUUID();
        const rootCorrelation = args.rootSummonId || summonId || correlation;
        const message = {
          from:            rulerStance,
          content:         briefing,
          correlation,
          rootCorrelation,
          activeRole:      "planner",
          priority:        3, // INTERACTIVE
          sentAt:          new Date().toISOString(),
        };

        const { appendToInbox } = await import("../../seed/cognition/inbox.js");
        const { attachHandoff, wake } = await import("../../seed/cognition/scheduler.js");
        const { hooks } = await import("../../seed/system/hooks.js");
        const startMs = Date.now();
        try {
          await appendToInbox(String(ruler._id), plannerBeingId, message);
        } catch (err) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "revise-plan",
            error: "appendToInbox failed: " + (err?.message || String(err)),
          }, null, 2));
        }
        attachHandoff(plannerBeingId, correlation, {
          identity:   { beingId, username },
          resolved:   { being: "planner", spaceId: String(ruler._id), zone: "tree" },
          onResponse: async (responseEntry) => {
            try { releaseSpawn(claim.key); } catch {}
            try {
              await hooks.fire("governing:planRevised", {
                spawnId:         correlation,
                rulerNodeId:     String(ruler._id),
                beingId,
                username,
                rootId:          rootId || null,
                kind:            "revise-plan",
                revisionReason,
                exitText:        responseEntry?.content || null,
                durationMs:      Date.now() - startMs,
                error:           null,
                parentSummonId:  summonId || null,
                parentSessionId: sessionId || null,
              });
            } catch (err) {
              log.warn("Governing", `planRevised hook fire failed: ${err.message}`);
            }
          },
          onError: async (err) => {
            try { releaseSpawn(claim.key); } catch {}
            try {
              await hooks.fire("governing:planRevised", {
                spawnId:         correlation,
                rulerNodeId:     String(ruler._id),
                beingId,
                username,
                rootId:          rootId || null,
                kind:            "revise-plan",
                revisionReason,
                exitText:        null,
                durationMs:      Date.now() - startMs,
                error:           err?.message || String(err),
                parentSummonId:  summonId || null,
                parentSessionId: sessionId || null,
              });
            } catch (hookErr) {
              log.warn("Governing", `planRevised (error path) hook fire failed: ${hookErr.message}`);
            }
          },
        });
        wake(plannerBeingId, String(ruler._id));

        return text(JSON.stringify({
          status: "spawned",
          decision: "revise-plan",
          spawnId: correlation,
          rulerNodeId: String(ruler._id),
          revisionReason,
          priorArchived: archived,
          note:
            "Prior plan archived. Revision Planner SUMMON sent. " +
            "This turn ends now. Synthesize 'Plan revision in progress.' and " +
            "stop. When the Planner emits the revised plan, you wake via " +
            "reply-SUMMON with the new emission visible in your snapshot.",
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
    //     role per leaf via governing.lookupWorkerRole.
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
      verb: "summon",
      description:
        "Dispatch the approved plan + ratified contracts to execution. " +
        "Emits a SUMMON to the Foreman for dispatch coordination. Each plan step becomes a sub-Ruler dispatched in parallel via the substrate scheduler (fire-and-forget) from your " +
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
        const { beingId, username, spaceId, rootId, summonId, sessionId } = args;
        if (!beingId) return text("governing-dispatch-execution: missing beingId; substrate bug.");

        const ruler = await resolveRulerScope(spaceId);
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

        // Collect plan steps. Slice 7 retires the branch-vs-leaf
        // distinction at dispatch level: EVERY step becomes a sub-Ruler.
        // The sub-Ruler at narrower scope reads its substrate and decides
        // whether it needs to plan further or just hire Foreman/Worker
        // directly. See memory `recursive-sub-ruler-dispatch` for the
        // architectural commitment, and `card-is-a-summon` for the reply
        // mechanism that bubbles results back up through the chain.
        const steps = Array.isArray(planEmission.steps) ? planEmission.steps : [];
        if (!steps.length) {
          return text(JSON.stringify({
            ok: false,
            decision: "dispatch-execution",
            error: "empty-plan",
            note: "Plan emission has no steps to dispatch.",
          }, null, 2));
        }

        log.info("Governing",
          `🚀 Ruler dispatching execution at ${String(ruler._id).slice(0, 8)} ` +
          `(plan emission-${planEmission.ordinal}, ` +
          `contracts emission-${contractsEmission.ordinal}, ` +
          `${steps.length} step${steps.length === 1 ? "" : "s"})`);

        // In-flight guard. dispatch-execution still claims so a
        // duplicate fire doesn't double-spawn the sub-Rulers.
        const claim = tryClaimSpawn({
          rulerNodeId: ruler._id,
          kind: "dispatch-execution",
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

        const spawnId = `spawn_${Date.now().toString(36)}_dispatch`;
        const startedAt = Date.now();

        // LIFECYCLE_ACTIVE start. Lets the UI surface "dispatch in
        // progress" across socket reloads. The clear-event fires
        // when all sub-Ruler chains settle (Phase 2 work — for now
        // the chip stays on until manual clearance / sub-Ruler reply
        // chain reaches the parent).
        if (beingId) {
          try {
            // `core.websocket.emitToBeing` auto-namespaces the event
            // name to "governing:lifecycleActive" via the loader's
            // scoped-core binding — extensions never type their own
            // prefix.
            core.websocket.emitToBeing(String(beingId), "lifecycleActive", {
              active: true,
              rulerNodeId: String(ruler._id),
              rootId: rootId || null,
              phase: "dispatch-execution",
              spawnId,
              stepCount: steps.length,
              at: new Date().toISOString(),
            });
          } catch (err) {
            log.debug("Governing", `LIFECYCLE_ACTIVE emit (dispatch start) skipped: ${err.message}`);
          }
        }

        // Resolve the parent Ruler's being username for the SUMMON
        // `from` stance. Sub-Rulers will reply UP through emitReplyToAsker
        // which reads message.from on their incoming SUMMON.
        const NodeModel = (await import("../../seed/models/space.js")).default;
        const BeingModel = (await import("../../seed/models/being.js")).default;
        const rulerNodeFull = await NodeModel.findById(ruler._id).select("metadata name").lean();
        const rulerBeings = rulerNodeFull?.metadata instanceof Map
          ? rulerNodeFull.metadata.get("beings")
          : rulerNodeFull?.metadata?.beings;
        const rulerBeingIdAtScope = rulerBeings?.ruler?.beingId || null;
        const rulerBeing = rulerBeingIdAtScope
          ? await BeingModel.findById(rulerBeingIdAtScope).select("name").lean()
          : null;
        const rulerUsername = rulerBeing?.name || "ruler";
        const { getLandDomain } = await import("../../seed/ibp/address.js");
        const landDomain = getLandDomain();
        const rulerStance = `${landDomain}/${ruler._id}@${rulerUsername}`;

        // For each plan step, create a child node at this Ruler's
        // scope, promote it to a sub-Ruler (which creates the sub-
        // Ruler being via promoteToRuler), and SUMMON the sub-Ruler
        // with the step's spec as the briefing. Contracts inheritance
        // is automatic via the parent-walk substrate reads; no
        // explicit pass needed.
        const { promoteToRuler, PROMOTED_FROM } = await import("./state/role.js");
        const { appendToInbox } = await import("../../seed/cognition/inbox.js");
        const { wake } = await import("../../seed/cognition/scheduler.js");
        const { writeLineage } = await import("./state/lineage.js");
        const { randomUUID } = await import("crypto");
        const rootCorrelation = args.rootSummonId || summonId || `${spawnId}-root`;

        const dispatched = [];
        const failures = [];
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i] || {};
          const stepName = (step.name && String(step.name).slice(0, 60))
            || (step.spec && String(step.spec).split("\n")[0].slice(0, 60))
            || `step-${i + 1}`;
          const stepBody = step.spec || step.name || JSON.stringify(step);
          try {
            const childSpace = new NodeModel({
              name: stepName,
              type: "ruler",
              parent: ruler._id,
            });
            await childSpace.save();

            await promoteToRuler({
              spaceId: String(childSpace._id),
              promotedFrom: PROMOTED_FROM.BRANCH_DISPATCH,
              reason: `dispatched by ${rulerUsername} for: ${stepName}`,
              // Sub-Ruler is a being-child of THIS Ruler. parentBeingId
              // here pins the being-tree edge; without it the promote
              // would fall back to identity or the tree's rootOwner.
              parentBeingId: rulerBeingIdAtScope,
              core: _core,
            });

            // Lineage: record parent Ruler + parent step index so the
            // sub-Ruler's snapshot/enrichContext can surface where it
            // sits in the parent's decomposition.
            try {
              await writeLineage({
                subRulerNodeId:  String(childSpace._id),
                parentRulerId:   String(ruler._id),
                parentStepIndex: i + 1,
                core: _core,
              });
            } catch (linErr) {
              log.debug("Governing", `lineage write skipped for step ${i + 1}: ${linErr.message}`);
            }

            // Resolve the new sub-Ruler being.
            const childFull = await NodeModel.findById(childSpace._id).select("metadata").lean();
            const childBeings = childFull?.metadata instanceof Map
              ? childFull.metadata.get("beings")
              : childFull?.metadata?.beings;
            const subRulerBeingId = childBeings?.ruler?.beingId || null;
            if (!subRulerBeingId) {
              failures.push({ stepName, error: "sub-ruler-being-missing" });
              continue;
            }

            const correlation = randomUUID();
            const briefing =
              `You are a sub-Ruler dispatched by ${rulerUsername} to handle one step of a larger plan.\n\n` +
              `Your assigned step (${i + 1} of ${steps.length}): ${stepName}\n\n` +
              `Spec:\n${stepBody}\n\n` +
              `Read your snapshot for the parent's plan + contracts. Decide whether to plan further ` +
              `(governing-hire-planner), draft contracts (governing-hire-contractor), or dispatch ` +
              `execution (governing-dispatch-execution). Reply when your work settles.`;

            await appendToInbox(String(childSpace._id), String(subRulerBeingId), {
              from:            rulerStance,
              content:         briefing,
              correlation,
              rootCorrelation,
              activeRole:      "ruler",
              priority:        3, // INTERACTIVE
              sentAt:          new Date().toISOString(),
            });
            wake(String(subRulerBeingId), String(childSpace._id));

            dispatched.push({
              subRulerNodeId: String(childSpace._id),
              subRulerBeingId: String(subRulerBeingId),
              stepName,
              stepIndex: i + 1,
              correlation,
            });
            log.info("Governing",
              `🌱 sub-Ruler "${stepName}" dispatched at ${String(childSpace._id).slice(0, 8)} ` +
              `(${i + 1}/${steps.length})`);
          } catch (err) {
            log.warn("Governing",
              `dispatch step ${i + 1} ("${stepName}") failed: ${err.message}`);
            failures.push({ stepName, error: err.message });
          }
        }

        releaseSpawn(claim.key);

        // Fire dashboard SSE so the governance panel re-renders.
        try {
          const { hooks } = await import("../../seed/system/hooks.js");
          hooks.run("governing:swarmDispatched", {
            spawnId,
            rulerNodeId: String(ruler._id),
            rootId: rootId || null,
            beingId: beingId || null,
            username: username || null,
            parentSummonId: summonId || null,
            parentSessionId: sessionId || null,
            source: "ruler-dispatch-execution",
            dispatchSummary: `dispatched ${dispatched.length}/${steps.length} sub-Rulers`,
            error: failures.length ? `${failures.length} step(s) failed to dispatch` : null,
            durationMs: Date.now() - startedAt,
            planEmissionId: planEmission._emissionNodeId,
            contractsEmissionId: contractsEmission._emissionNodeId,
          }).catch(() => {});
        } catch (hookErr) {
          log.debug("Governing", `governing:swarmDispatched fire skipped: ${hookErr.message}`);
        }

        return text(JSON.stringify({
          status: "spawned",
          decision: "dispatch-execution",
          spawnId,
          rulerNodeId: String(ruler._id),
          dispatchedCount: dispatched.length,
          dispatched,
          failures,
          note:
            `Dispatched ${dispatched.length}/${steps.length} sub-Rulers. Each runs its own ` +
            `cycle in parallel via its own scheduler. This turn ends now. ` +
            `Synthesize one short sentence — 'Dispatch started across ${dispatched.length} sub-Ruler${dispatched.length === 1 ? "" : "s"}.' — ` +
            `and stop. When sub-Rulers reply via the substrate inbox (emitReplyToAsker), ` +
            `you wake and see their progress in your snapshot.`,
        }, null, 2));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-ratify-plan
    //
    // The Ruler's delegate (typically the user-being at entry-scope)
    // approved the pending plan. Flip the pending ledger entry to
    // status="approved" so the lifecycle advances. The Ruler calls this
    // when its current SUMMON came from its delegate AND the content
    // signals approval (e.g., "yes", "approve", "looks good").
    //
    // Phase 1.5: this is the entry-scope ratification primitive. The
    // sub-scope path doesn't need it — sub-Ruler plans auto-approve at
    // emit time because the parent's dispatch is implicit ratification.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-ratify-plan",
      verb: "do",
      description:
        "Ratify a pending plan. Use when your snapshot shows " +
        "`awaiting: \"delegate-decision\"` AND the message just received " +
        "from your delegate (the user-being or parent Ruler at your " +
        "rulership level) signals approval. Flips the pending plan to " +
        "approved status; the lifecycle then advances to " +
        "`awaiting: \"contracts\"` and you can call hire-contractor.\n\n" +
        "Args: reason — short note for the audit trail (e.g., the " +
        "user's exact phrasing).",
      schema: {
        reason: z.string().describe(
          "Short note for the audit trail — e.g., the delegate's exact phrasing.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { beingId, spaceId } = args;
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason) return text("governing-ratify-plan: reason is required for audit.");
        if (reason.length > REASON_CAP) {
          return text(`governing-ratify-plan: reason exceeds ${REASON_CAP} chars; trim.`);
        }
        if (!beingId) return text("governing-ratify-plan: missing beingId; substrate bug.");

        const ruler = await resolveRulerScope(spaceId);
        if (!ruler) {
          return text("governing-ratify-plan: no Ruler scope resolvable.");
        }

        const { getExtension } = await import("../loader.js");
        const governing = getExtension("governing")?.exports;
        if (!governing?.readLatestPlanApproval || !governing?.appendPlanApproval) {
          return text("governing-ratify-plan: governing.readLatestPlanApproval / appendPlanApproval unavailable; substrate bug.");
        }

        const latest = await governing.readLatestPlanApproval(ruler._id);
        if (!latest) {
          return text(JSON.stringify({
            ok: false,
            decision: "ratify-plan",
            error: "no-plan-approval",
            note: "No plan approval ledger entry at this Ruler scope. Nothing to ratify.",
          }, null, 2));
        }
        if (latest.status === "approved") {
          return text(JSON.stringify({
            ok: true,
            decision: "ratify-plan",
            note: "Plan is already approved. No-op.",
            planRef: latest.planRef,
          }, null, 2));
        }
        if (latest.status !== "pending") {
          return text(JSON.stringify({
            ok: false,
            decision: "ratify-plan",
            error: "unexpected-status",
            currentStatus: latest.status,
            note: `Latest plan approval is "${latest.status}" — not in a state that ratifies.`,
          }, null, 2));
        }

        // Parse the pending ref to recover the emission node, then
        // append an "approved" entry that supersedes the pending one.
        // The latest-non-superseded after this write is the new approved
        // entry, so readActivePlanApproval / readActivePlanEmission
        // surface it on the next snapshot read.
        const { parsePlanRef } = await import("./state/planApprovals.js");
        const parsed = parsePlanRef(latest.planRef);
        if (!parsed) {
          return text(JSON.stringify({
            ok: false,
            decision: "ratify-plan",
            error: "unparseable-planRef",
            planRef: latest.planRef,
          }, null, 2));
        }
        try {
          await governing.appendPlanApproval({
            rulerNodeId: ruler._id,
            planNodeId: parsed.planNodeId,
            status: "approved",
            supersedes: latest.planRef,
            reason: `ratified: ${reason}`.slice(0, 500),
            core: _core,
          });
        } catch (err) {
          return text(JSON.stringify({
            ok: false,
            decision: "ratify-plan",
            error: "append-failed: " + (err?.message || String(err)),
          }, null, 2));
        }

        log.info("Governing",
          `✅ Plan ratified at ${String(ruler._id).slice(0, 8)} ` +
          `(reason: ${reason.slice(0, 80)})`);

        return text(JSON.stringify({
          status: "ratified",
          decision: "ratify-plan",
          rulerNodeId: String(ruler._id),
          priorRef: latest.planRef,
          reason,
          note:
            "Plan ratified. Lifecycle advanced to `awaiting: \"contracts\"`. " +
            "Synthesize 'Plan approved. Drafting contracts.' and call " +
            "governing-hire-contractor next turn.",
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
      verb: "do",
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
        const { spaceId } = args;
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason) return text("governing-archive-plan: reason is required.");

        const ruler = await resolveRulerScope(spaceId);
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
                core: _core,
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
                  core: _core,
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
      verb: "do",
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
                const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason) return text("governing-pause-execution: reason is required.");
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
      verb: "summon",
      description:
        "Resume execution after a pause. Emits a SUMMON to the Foreman " +
        "(fire-and-forget) to decide next steps given the execution-record's " +
        "current state (the Foreman reads what's pending, what failed " +
        "before pause, etc., and chooses retry/freeze/escalate). The " +
        "tool clears pause markers first, then SUMMONs the Foreman, " +
        "returns 'spawned' immediately. The Foreman's reply lands in " +
        "your inbox and wakes your next turn. Args: reason.",
      schema: {
        reason: z.string().describe("Why you're resuming."),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { beingId, username, spaceId, rootId, summonId, sessionId } = args;
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason) return text("governing-resume-execution: reason is required.");
        if (!beingId) return text("governing-resume-execution: missing beingId; substrate bug.");

        const ruler = await resolveRulerScope(spaceId);
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
              const NodeModel = (await import("../../seed/models/space.js")).default;
              const recSpace = await NodeModel.findById(record._recordNodeId);
              if (recSpace) {
                const meta = recSpace.metadata instanceof Map
                  ? recSpace.metadata.get("governing")
                  : recSpace.metadata?.governing;
                const exec = meta?.execution || {};
                // Phase 3 migration: verb-surface write, atomic merge.
                await _core.do(recSpace, "set-meta", {
                  namespace: "governing",
                  data: {
                    execution: {
                      ...exec, status: "running", completedAt: null,
                      pausedAtStepIndex: null, pausedReason: null, pausedAt: null,
                      pendingPauseAt: null, pendingPauseReason: null,
                      resumedAt: new Date().toISOString(),
                      resumeReason: reason.slice(0, 500),
                    },
                  },
                  merge: true,
                }, { identity: { beingId, name: username } });
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

        // SUMMON the Foreman via inbox. Same pattern as route-to-foreman:
        // ensure execution node + Foreman being, build stances, append
        // to inbox, attach handoff that releases the claim and fires
        // `governing:foremanRouted` for dashboard SSE on settle.
        const { ensureExecutionNode } = await import("./state/executionSpace.js");
        const executionSpace = await ensureExecutionNode({
          scopeNodeId: String(ruler._id),
          beingId,
          summonId,
          sessionId,
          core: _core,
        });
        if (!executionSpace) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "resume-execution",
            error: "ensure-execution-failed",
          }, null, 2));
        }
        const NodeModel = (await import("../../seed/models/space.js")).default;
        const BeingModel = (await import("../../seed/models/being.js")).default;
        const execNodeFull = await NodeModel.findById(executionSpace._id).select("metadata").lean();
        const execBeings = execNodeFull?.metadata instanceof Map
          ? execNodeFull.metadata.get("beings")
          : execNodeFull?.metadata?.beings;
        const foremanBeingId = execBeings?.foreman?.beingId || null;
        if (!foremanBeingId) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "resume-execution",
            error: "foreman-being-missing",
          }, null, 2));
        }
        const rulerNodeFull = await NodeModel.findById(ruler._id).select("metadata").lean();
        const rulerBeings = rulerNodeFull?.metadata instanceof Map
          ? rulerNodeFull.metadata.get("beings")
          : rulerNodeFull?.metadata?.beings;
        const rulerBeingIdAtScope = rulerBeings?.ruler?.beingId || null;
        const rulerBeing = rulerBeingIdAtScope
          ? await BeingModel.findById(rulerBeingIdAtScope).select("name").lean()
          : null;
        const rulerUsername = rulerBeing?.name || "ruler";

        const { getLandDomain } = await import("../../seed/ibp/address.js");
        const landDomain = getLandDomain();
        const rulerStance = `${landDomain}/${ruler._id}@${rulerUsername}`;

        const { randomUUID } = await import("crypto");
        const correlation = randomUUID();
        const rootCorrelation = args.rootSummonId || summonId || correlation;
        const message = {
          from:            rulerStance,
          content:         `Wakeup: resume-requested\n\nReason: ${reason}\n\n` +
                           "Read the execution-stack snapshot, decide what's next given the unpaused state.",
          correlation,
          rootCorrelation,
          activeRole:      "foreman",
          priority:        3,
          sentAt:          new Date().toISOString(),
        };

        const { appendToInbox } = await import("../../seed/cognition/inbox.js");
        const { attachHandoff, wake } = await import("../../seed/cognition/scheduler.js");
        const { hooks } = await import("../../seed/system/hooks.js");
        const startMs = Date.now();
        try {
          await appendToInbox(String(ruler._id), foremanBeingId, message);
        } catch (err) {
          releaseSpawn(claim.key);
          return text(JSON.stringify({
            ok: false,
            decision: "resume-execution",
            error: "appendToInbox failed: " + (err?.message || String(err)),
          }, null, 2));
        }
        attachHandoff(foremanBeingId, correlation, {
          identity:   { beingId, username },
          resolved:   { being: "foreman", spaceId: String(ruler._id), zone: "tree" },
          onResponse: async (responseEntry) => {
            try { releaseSpawn(claim.key); } catch {}
            try {
              await hooks.fire("governing:foremanRouted", {
                spawnId:         correlation,
                rulerNodeId:     String(ruler._id),
                beingId,
                username,
                rootId:          rootId || null,
                kind:            "resume-execution",
                wakeupReason:    "resume-requested",
                resumeReason:    reason,
                exitText:        responseEntry?.content || null,
                durationMs:      Date.now() - startMs,
                error:           null,
                parentSummonId:  summonId || null,
                parentSessionId: sessionId || null,
              });
            } catch (err) {
              log.warn("Governing", `foremanRouted hook fire failed: ${err.message}`);
            }
          },
          onError: async (err) => {
            try { releaseSpawn(claim.key); } catch {}
            try {
              await hooks.fire("governing:foremanRouted", {
                spawnId:         correlation,
                rulerNodeId:     String(ruler._id),
                beingId,
                username,
                rootId:          rootId || null,
                kind:            "resume-execution",
                wakeupReason:    "resume-requested",
                resumeReason:    reason,
                exitText:        null,
                durationMs:      Date.now() - startMs,
                error:           err?.message || String(err),
                parentSummonId:  summonId || null,
                parentSessionId: sessionId || null,
              });
            } catch (hookErr) {
              log.warn("Governing", `foremanRouted (error path) hook fire failed: ${hookErr.message}`);
            }
          },
        });
        wake(foremanBeingId, String(ruler._id));

        return text(JSON.stringify({
          status: "spawned",
          decision: "resume-execution",
          spawnId: correlation,
          rulerNodeId: String(ruler._id),
          reason,
          note:
            "Pause cleared. Foreman SUMMON sent to decide next steps from the " +
            "unpaused state. This turn ends now. Synthesize one short sentence — " +
            "'Execution resumed. Foreman judging next move.' — and stop.",
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
      verb: "see",
      description:
        "Read the FULL active plan emission at this scope (reasoning " +
        "+ every step including leaves and branch rationales). Use when " +
        "your snapshot summary isn't enough and you need to see the full " +
        "plan before deciding. Returns the structured emission. Does NOT " +
        "end your turn — call another tool after.",
      schema: {},
      annotations: { readOnlyHint: true },
      async handler(args) {
        const { spaceId } = args;
        if (!spaceId) return text("governing-read-plan-detail: missing spaceId.");
        try {
          const { getExtension } = await import("../loader.js");
          const governing = getExtension("governing")?.exports;
          if (!governing?.readActivePlanEmission) {
            return text("governing-read-plan-detail: governing.readActivePlanEmission unavailable.");
          }
          const emission = await governing.readActivePlanEmission(spaceId);
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
      verb: "summon",
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
        const { spaceId, beingId, username } = args;
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason) return text("governing-convene-court: reason is required.");

        // Write a court-pending marker on the Ruler scope (durable —
        // courts are part of the audit trail). Doesn't replace the
        // decision register; the register still records the Ruler's
        // turn-level choice.
        try {
          if (spaceId) {
            const node = await Space.findById(spaceId);
            if (node) {
              const meta = node.metadata instanceof Map
                ? node.metadata.get("governing")
                : node.metadata?.governing;
              const existingPending = Array.isArray(meta?.courtPending) ? meta.courtPending : [];
              // Phase 3 migration: verb-surface merge, atomic.
              await _core.do(node, "set-meta", {
                namespace: "governing",
                data: {
                  courtPending: [
                    ...existingPending,
                    { reason, convenedAt: new Date().toISOString(), status: "pending-pass2" },
                  ],
                },
                merge: true,
              }, { identity: { beingId, name: username } });
            }
          }
          const { hooks } = await import("../../seed/system/hooks.js");
          hooks.run("governing:courtConvened", {
            rulerNodeId: spaceId ? String(spaceId) : null,
            reason,
          }).catch(() => {});
        } catch (err) {
          log.warn("Governing", `convene-court marker write failed: ${err.message}`);
        }
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
