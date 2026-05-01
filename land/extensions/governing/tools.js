// governing tools.
//
// Phase 2 prototype: governing-emit-plan. The Planner emits the
// structured plan for this Ruler scope via a single tool call. The
// args carry the full plan structure (reasoning, typed steps, branch
// rationale); the server materializes a plan-emission child node
// under the plan trio member and records a planApproval entry on the
// Ruler. This replaces the [[BRANCHES]] text-and-parser path for
// plans, but only the EMISSION half — dispatch still reads
// metadata.plan.steps[] this round (phase 2 main swaps the dispatch
// source).
//
// Validation here is strict: the structured shape is the contract
// between Planner and Ruler. A malformed emission is rejected with a
// structured error message that tells the model how to fix the call,
// so the kernel's tool retry loop can recover without prose drift.

import { z } from "zod";
import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";

const SPEC_CAP = 500;          // hard cap per step's spec
const REASONING_CAP = 800;     // hard cap on top-level reasoning
const RATIONALE_CAP = 400;     // hard cap on per-step rationale
const NAME_CAP = 60;           // sub-domain branch name cap
const MIN_BRANCH_SIBLINGS = 2; // branch step requires 2+ sub-domains

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

/**
 * Validate the structured plan args. Returns { ok: true, value } on
 * success, { ok: false, errors: [string] } on failure. Errors are
 * phrased as instructions the model can act on directly: "branch step
 * at index 2 has only 1 sibling; either reframe as leaf or add a
 * second branch."
 */
function validatePlanArgs(args) {
  const errors = [];
  if (!args || typeof args !== "object") {
    return { ok: false, errors: ["args must be an object with `reasoning` and `steps`"] };
  }

  const reasoning = typeof args.reasoning === "string" ? args.reasoning.trim() : "";
  if (!reasoning) errors.push("`reasoning` is required (2-6 sentences explaining why this plan takes this shape)");
  else if (reasoning.length > REASONING_CAP) errors.push(`\`reasoning\` exceeds ${REASONING_CAP} chars (got ${reasoning.length}); compress to 2-6 sentences of architectural reasoning`);

  const steps = Array.isArray(args.steps) ? args.steps : null;
  if (!steps || steps.length === 0) errors.push("`steps` must be a non-empty array");

  const seenBranchNames = new Set();
  if (steps) {
    steps.forEach((step, idx) => {
      const where = `step at index ${idx}`;
      if (!step || typeof step !== "object") {
        errors.push(`${where} must be an object with \`type\` and \`spec\` (or \`branches\`)`);
        return;
      }
      const type = step.type;
      if (type !== "leaf" && type !== "branch") {
        errors.push(`${where} has \`type\`=${JSON.stringify(type)}; must be "leaf" or "branch"`);
        return;
      }

      if (type === "leaf") {
        const spec = typeof step.spec === "string" ? step.spec.trim() : "";
        if (!spec) errors.push(`${where} (leaf) requires \`spec\` (one concrete sentence describing the work)`);
        else if (spec.length > SPEC_CAP) errors.push(`${where} (leaf) \`spec\` exceeds ${SPEC_CAP} chars (got ${spec.length}); compress or split into smaller leaf steps`);
        if (step.rationale != null) {
          const r = String(step.rationale).trim();
          if (r.length > RATIONALE_CAP) errors.push(`${where} (leaf) \`rationale\` exceeds ${RATIONALE_CAP} chars; trim to 1-2 sentences`);
        }
      }

      if (type === "branch") {
        const rationale = typeof step.rationale === "string" ? step.rationale.trim() : "";
        if (!rationale) errors.push(`${where} (branch) REQUIRES \`rationale\` — explain why these are sibling sub-domains and not a single delegation`);
        else if (rationale.length > RATIONALE_CAP) errors.push(`${where} (branch) \`rationale\` exceeds ${RATIONALE_CAP} chars; trim to 2-3 sentences`);

        const branches = Array.isArray(step.branches) ? step.branches : null;
        if (!branches) {
          errors.push(`${where} (branch) requires a \`branches\` array of 2+ sub-domains`);
        } else if (branches.length < MIN_BRANCH_SIBLINGS) {
          errors.push(`${where} (branch) has only ${branches.length} sub-domain(s); branch steps require ${MIN_BRANCH_SIBLINGS}+ sibling sub-domains. If only one delegation is needed, reframe as a leaf step with a domain-shaped spec — the worker can self-promote if the work compounds.`);
        } else {
          branches.forEach((b, bidx) => {
            const bWhere = `${where} branch ${bidx}`;
            const name = typeof b?.name === "string" ? b.name.trim() : "";
            const spec = typeof b?.spec === "string" ? b.spec.trim() : "";
            if (!name) errors.push(`${bWhere} requires \`name\``);
            else if (name.length > NAME_CAP) errors.push(`${bWhere} \`name\` exceeds ${NAME_CAP} chars`);
            else if (seenBranchNames.has(name.toLowerCase())) errors.push(`${bWhere} duplicate branch name "${name}"; sub-domain names must be unique within a plan emission`);
            else seenBranchNames.add(name.toLowerCase());
            if (!spec) errors.push(`${bWhere} requires \`spec\` (one concrete sentence describing what this sub-domain owns)`);
            else if (spec.length > SPEC_CAP) errors.push(`${bWhere} \`spec\` exceeds ${SPEC_CAP} chars; compress or push detail into the sub-Ruler's own plan`);
          });
        }
      }
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { reasoning, steps } };
}

/**
 * Resolve the Ruler scope to anchor this plan emission. Caller's
 * currentNode is the natural anchor: in the prototype, the Planner
 * runs at the Ruler scope, so the current node IS the Ruler. Defensive:
 * if the current node lacks the ruler role, walk up via findRulerScope.
 */
async function resolveRuler(nodeId) {
  if (!nodeId) return null;
  const direct = await Node.findById(nodeId).select("_id name parent metadata").lean();
  if (!direct) return null;
  const meta = direct.metadata instanceof Map
    ? Object.fromEntries(direct.metadata)
    : (direct.metadata || {});
  if (meta?.governing?.role === "ruler") return direct;

  // Walk up.
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (governing?.findRulerScope) {
      return await governing.findRulerScope(nodeId);
    }
  } catch {}
  return null;
}

/**
 * Find the plan trio member under a Ruler. Phase 1 stamps governing
 * role "plan" on this node, so the probe is direct: type=plan child
 * with that role. Returns null if absent (caller should call
 * governing.ensurePlanAtScope first; the Ruler cycle does this in
 * runRulerCycle).
 */
async function findPlanTrioMember(rulerNodeId) {
  return Node.findOne({
    parent: rulerNodeId,
    type: "plan",
  }).select("_id name parent type children metadata").lean();
}

/**
 * Compute the next emission ordinal for naming the child node
 * "emission-N". Counts existing plan-emission children and increments.
 */
async function nextEmissionOrdinal(planNodeId) {
  const count = await Node.countDocuments({
    parent: planNodeId,
    type: "plan-emission",
  });
  return count + 1;
}

/**
 * Create the plan-emission child node under the plan trio member.
 * Carries the structured emission in metadata.governing.emission.
 * Returns the created node.
 */
async function createPlanEmission({ planNodeId, ordinal, payload, userId, core }) {
  const name = `emission-${ordinal}`;

  let created = null;
  try {
    if (core?.tree?.createNode) {
      created = await core.tree.createNode({
        parentId: String(planNodeId),
        name,
        type: "plan-emission",
        userId,
        wasAi: true,
      });
    }
  } catch (err) {
    log.debug("Governing", `core.tree.createNode failed for plan-emission: ${err.message}; falling back to direct insert`);
  }

  if (!created) {
    const { default: NodeModel } = await import("../../seed/models/node.js");
    const { v4: uuid } = await import("uuid");
    created = await NodeModel.create({
      _id: uuid(),
      name,
      type: "plan-emission",
      parent: planNodeId,
      children: [],
      contributors: [],
      status: "active",
    });
    await NodeModel.updateOne(
      { _id: planNodeId },
      { $addToSet: { children: created._id } },
    );
  }

  // Stamp governing role + the structured emission. Role marker makes
  // this node structural for the kernel's beforeNodeDelete guard. The
  // structured plan nests up to 7 levels (governing → emission →
  // steps[] → step → branches[] → branch); kernel default depth cap
  // is 8 to accommodate this and similar coordination shapes.
  try {
    const { setExtMeta: kernelSetExtMeta } = await import("../../seed/tree/extensionMetadata.js");
    const node = await Node.findById(created._id);
    if (node) {
      const existingMeta = node.metadata instanceof Map
        ? node.metadata.get("governing")
        : node.metadata?.governing;
      await kernelSetExtMeta(node, "governing", {
        ...(existingMeta || {}),
        role: "plan-emission",
        emission: payload,
        ordinal: payload.ordinal,
        emittedAt: payload.emittedAt,
        stepsCount: payload.steps.length,
      });
    }
  } catch (err) {
    log.warn("Governing", `failed to stamp plan-emission metadata: ${err.message}`);
  }

  return created;
}

// Resolve a list of consumer scope names (the strings the Contractor
// uses inside scope tags, e.g. "frontend", "backend") to the matching
// child node ids under the Ruler scope. Names match either by exact
// node name (case-insensitive) or by the legacy swarm `path` field
// when the branch was dispatched with a custom path. Returns an array
// the same length as `names` with nullable entries for unresolved.
async function resolveConsumerNodeIds(rulerNodeId, names) {
  if (!Array.isArray(names) || !names.length) return [];
  const kids = await Node.find({ parent: rulerNodeId })
    .select("_id name metadata")
    .lean();
  const lookup = new Map();
  for (const k of kids) {
    const md = k.metadata instanceof Map
      ? Object.fromEntries(k.metadata)
      : (k.metadata || {});
    if (k.name) lookup.set(String(k.name).toLowerCase(), String(k._id));
    const swarmPath = md.swarm?.path;
    if (typeof swarmPath === "string" && swarmPath) {
      lookup.set(swarmPath.toLowerCase(), String(k._id));
    }
  }
  return names.map((n) => {
    const key = String(n || "").trim().toLowerCase();
    return key ? (lookup.get(key) || null) : null;
  });
}

/**
 * Validate the structured contracts args. Mirrors validatePlanArgs:
 * strict shape check, errors phrased as instructions the model can
 * act on directly.
 */
const CONTRACT_DETAILS_CAP = 800;
const CONTRACT_RATIONALE_CAP = 400;
const CONTRACT_NAME_CAP = 80;
const CONTRACT_KIND_CAP = 40;

const VALID_SCOPE_TYPES = new Set(["global"]);

function validateContractsArgs(args) {
  const errors = [];
  if (!args || typeof args !== "object") {
    return { ok: false, errors: ["args must be an object with `reasoning` and `contracts`"] };
  }

  const reasoning = typeof args.reasoning === "string" ? args.reasoning.trim() : "";
  if (!reasoning) errors.push("`reasoning` is required (2-6 sentences explaining why this contract set takes this shape)");
  else if (reasoning.length > REASONING_CAP) errors.push(`\`reasoning\` exceeds ${REASONING_CAP} chars (got ${reasoning.length}); compress to high-level rationale for the contract SET`);

  const contracts = Array.isArray(args.contracts) ? args.contracts : null;
  if (!contracts || contracts.length === 0) errors.push("`contracts` must be a non-empty array. If no contracts are needed, do not call this tool — exit instead.");

  const seenNames = new Set();
  if (contracts) {
    contracts.forEach((c, i) => {
      const where = `contract at index ${i}`;
      if (!c || typeof c !== "object") {
        errors.push(`${where} must be an object with kind/name/scope/details/rationale`);
        return;
      }
      const kind = typeof c.kind === "string" ? c.kind.trim() : "";
      if (!kind) errors.push(`${where} requires \`kind\` (e.g. "event-name", "storage-key", "method-signature", "dom-id", "message-type", "module-export")`);
      else if (kind.length > CONTRACT_KIND_CAP) errors.push(`${where} \`kind\` exceeds ${CONTRACT_KIND_CAP} chars`);

      const name = typeof c.name === "string" ? c.name.trim() : "";
      if (!name) errors.push(`${where} requires \`name\` (the canonical identifier consumers use verbatim)`);
      else if (name.length > CONTRACT_NAME_CAP) errors.push(`${where} \`name\` exceeds ${CONTRACT_NAME_CAP} chars`);
      else {
        const dedupeKey = `${kind}:${name}`.toLowerCase();
        if (seenNames.has(dedupeKey)) errors.push(`${where} duplicate ${dedupeKey}; emit each contract once per Contractor invocation`);
        else seenNames.add(dedupeKey);
      }

      const scope = c.scope;
      if (scope === "global") {
        // ok
      } else if (scope && typeof scope === "object" && !Array.isArray(scope)) {
        const hasShared = Array.isArray(scope.shared);
        const hasLocal = typeof scope.local === "string" || Array.isArray(scope.local);
        if (hasShared) {
          if (scope.shared.length < 2) errors.push(`${where} \`scope.shared\` requires 2+ named consumers; for a single consumer use \`scope: { local: "<name>" }\``);
          else {
            scope.shared.forEach((s, idx) => {
              if (typeof s !== "string" || !s.trim()) errors.push(`${where} \`scope.shared[${idx}]\` must be a non-empty consumer name`);
            });
          }
        } else if (hasLocal) {
          const localNames = Array.isArray(scope.local) ? scope.local : [scope.local];
          if (!localNames.length || !localNames[0]) errors.push(`${where} \`scope.local\` must be a non-empty consumer name`);
        } else {
          errors.push(`${where} \`scope\` object must be { shared: [...] } or { local: "..." }`);
        }
      } else {
        errors.push(`${where} \`scope\` must be "global" or { shared: [A, B, ...] } or { local: "<name>" }`);
      }

      const details = typeof c.details === "string" ? c.details.trim() : "";
      if (!details) errors.push(`${where} requires \`details\` (the contract content — schema, signatures, payload shapes, etc.)`);
      else if (details.length > CONTRACT_DETAILS_CAP) errors.push(`${where} \`details\` exceeds ${CONTRACT_DETAILS_CAP} chars; compress to canonical shape, push examples elsewhere`);

      const rationale = typeof c.rationale === "string" ? c.rationale.trim() : "";
      if (!rationale) errors.push(`${where} REQUIRES \`rationale\` — explain WHY this contract specifically exists (1-3 sentences). Pass 2 courts read this when adjudicating contract conformance.`);
      else if (rationale.length > CONTRACT_RATIONALE_CAP) errors.push(`${where} \`rationale\` exceeds ${CONTRACT_RATIONALE_CAP} chars; trim to 1-3 sentences`);
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { reasoning, contracts } };
}

/**
 * Build the prototype tool list. Phase 2 prototype scope: emission only.
 * Dispatch / sub-Ruler context / re-invocation triggers are deferred to
 * phase 2 main.
 */
export default function getGoverningTools(core) {
  return [
    {
      name: "governing-emit-plan",
      description:
        "Emit the structured plan for this Ruler scope. Use ONCE per Planner invocation. " +
        "Args carry the full plan: a top-level `reasoning` field (2-6 sentences explaining " +
        "why this decomposition), then a `steps` array where each step is `type: \"leaf\"` " +
        "(work this scope's Worker executes directly, with a concrete one-sentence `spec`) " +
        "or `type: \"branch\"` (delegation to 2+ sibling sub-Rulers, with a `rationale` " +
        "explaining the decomposition and a `branches` array of `{name, spec}` entries). " +
        "Single-branch is rejected — if only one delegation is needed, use a leaf with a " +
        "domain-shaped spec and let the worker self-promote if it compounds. Spec cap 500 " +
        "chars; reasoning cap 800; rationale cap 400. The server materializes a plan-emission " +
        "child node under this Ruler's plan node and records a planApproval entry. Returns " +
        "{ok, emissionId, planRef}. After this tool succeeds, you are done — exit.",
      schema: {
        reasoning: z.string().describe(
          "2-6 sentences. Why this plan takes this shape. What constraints from the tree state, " +
          "available extensions, and the request shaped the decomposition. Name the trade-offs " +
          "considered. Reasoning is what the Ruler approves, not just step names.",
        ),
        steps: z.array(z.object({
          type: z.enum(["leaf", "branch"]).describe(
            "leaf = Worker at this scope executes directly. branch = 2+ sibling sub-Rulers each get their own scope and Planner.",
          ),
          spec: z.string().optional().describe(
            "Required for leaf steps. One concrete sentence describing the work. Cap 500 chars.",
          ),
          rationale: z.string().optional().describe(
            "Optional for leaf (1-2 sentences for non-obvious leaves). REQUIRED for branch (why these sub-domains, not one). Cap 400.",
          ),
          branches: z.array(z.object({
            name: z.string().describe("Sub-domain name. Becomes the directory/node name. Lowercase-kebab preferred."),
            spec: z.string().describe("One concrete sentence describing what this sub-domain owns end-to-end. Cap 500 chars."),
          })).optional().describe(
            "Required for branch steps. 2+ entries. Each entry becomes a sub-Ruler.",
          ),
        })).describe(
          "Ordered numbered sequence. Each step executes in order. Leaf steps run at this scope; branch steps create sub-Rulers as siblings of the plan/contracts trio members.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        // The MCP HTTP layer injects userId, rootId, nodeId, chatId,
        // sessionId into `args` on every call (loader's passthrough
        // schema wrapping preserves them). `core` comes from this
        // closure, not from args. Match code-workspace tools.js.
        const { userId, nodeId } = args;

        // Validate the structured shape strictly.
        const validation = validatePlanArgs(args);
        if (!validation.ok) {
          return text(
            `governing-emit-plan rejected:\n  - ${validation.errors.join("\n  - ")}\n\n` +
            `Re-emit with the listed corrections. Args echoed for debugging: ` +
            `${JSON.stringify({ reasoningLen: args?.reasoning?.length || 0, stepsCount: args?.steps?.length || 0 })}`,
          );
        }

        // Resolve the Ruler.
        const ruler = await resolveRuler(nodeId);
        if (!ruler) {
          return text(
            `governing-emit-plan: no Ruler scope resolvable from current node ${String(nodeId).slice(0, 8)}. ` +
            `The Ruler should self-promote before the Planner is dispatched; if you see this from inside ` +
            `a Planner cycle, it is a substrate bug — surface it.`,
          );
        }

        // Locate the plan trio member.
        const planNode = await findPlanTrioMember(ruler._id);
        if (!planNode) {
          return text(
            `governing-emit-plan: Ruler ${String(ruler._id).slice(0, 8)} ("${ruler.name}") has no plan trio member. ` +
            `Phase 1's runRulerCycle should ensure the plan node before the Planner runs; if missing, ` +
            `surface as substrate bug.`,
          );
        }

        // Materialize the emission.
        const emittedAt = new Date().toISOString();
        const ordinal = await nextEmissionOrdinal(planNode._id);
        const payload = {
          ordinal,
          emittedAt,
          reasoning: validation.value.reasoning,
          steps: validation.value.steps,
        };

        // Diagnostic: surface the validated emission shape before the
        // stamp so we can verify in logs what the model actually
        // emitted (vs. what landed on the node). If the stamp throws
        // silently, this log is the only record of the model's intent.
        const branchStepCount = payload.steps.filter((s) => s.type === "branch").length;
        const leafStepCount = payload.steps.filter((s) => s.type === "leaf").length;
        const branchNames = payload.steps
          .filter((s) => s.type === "branch")
          .flatMap((s) => (s.branches || []).map((b) => b.name))
          .join(", ");
        log.info("Governing",
          `🧭 governing-emit-plan validated: ` +
          `ordinal=${ordinal}, leaves=${leafStepCount}, branches=${branchStepCount}` +
          (branchNames ? ` (${branchNames})` : "") +
          `, reasoning=${payload.reasoning.length}c`);

        const emissionNode = await createPlanEmission({
          planNodeId: planNode._id,
          ordinal,
          payload,
          userId,
          core,
        });

        // Verify the stamp actually landed by re-reading the node.
        // If the kernel's depth guard rejected it (still happening
        // despite the cap bump?), we surface that explicitly here.
        try {
          const verify = await Node.findById(emissionNode._id).select("_id metadata").lean();
          const verifyMeta = verify?.metadata instanceof Map
            ? Object.fromEntries(verify.metadata)
            : (verify?.metadata || {});
          const stampedSteps = verifyMeta?.governing?.emission?.steps?.length;
          if (typeof stampedSteps !== "number") {
            log.warn("Governing",
              `⚠️  emission-${ordinal} stamp NOT visible after write at ${String(emissionNode._id).slice(0, 8)}; ` +
              `metadata.governing keys=${Object.keys(verifyMeta?.governing || {}).join(",") || "(none)"}`);
          } else {
            log.info("Governing",
              `✅ emission-${ordinal} stamped at ${String(emissionNode._id).slice(0, 8)} ` +
              `(${stampedSteps} steps in metadata.governing.emission)`);
          }
        } catch (verifyErr) {
          log.debug("Governing", `emission stamp verify skipped: ${verifyErr.message}`);
        }

        // Append planApproval on the Ruler with the new emissionId-
        // shaped planRef. Supersedes the prior active approval if any.
        let planRef = `${planNode._id}:${emissionNode._id}`;
        try {
          const { getExtension } = await import("../loader.js");
          const governing = getExtension("governing")?.exports;
          if (governing?.appendPlanApproval) {
            const prior = governing.readActivePlanApproval
              ? await governing.readActivePlanApproval(ruler._id)
              : null;
            // Override the Phase 1 buildPlanRef shape (which reads
            // _writeSeq) with the emissionId-shaped ref. Done by
            // writing the ref directly via a small post-write update;
            // simpler to extend appendPlanApproval to accept an
            // override but for the prototype the inline shape works.
            await governing.appendPlanApproval({
              rulerNodeId: ruler._id,
              planNodeId: emissionNode._id,  // ref points at the emission child, not the workspace
              status: "approved",
              supersedes: prior?.planRef || null,
              reason: prior ? "re-plan supersedes prior emission" : null,
            });
            // Re-read the just-written entry to surface the actual ref
            // the kernel built (writeSeq-shaped) so the response stays
            // accurate. Phase 2 main will swap appendPlanApproval to
            // accept an explicit ref.
            const active = governing.readActivePlanApproval
              ? await governing.readActivePlanApproval(ruler._id)
              : null;
            if (active?.planRef) planRef = active.planRef;
          }
        } catch (err) {
          log.warn("Governing", `governing-emit-plan: planApproval append failed: ${err.message}`);
        }

        return text(JSON.stringify({
          ok: true,
          emissionId: String(emissionNode._id),
          planRef,
          rulerNodeId: String(ruler._id),
          planNodeId: String(planNode._id),
          ordinal,
          stepsCount: payload.steps.length,
          emittedAt,
        }));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // governing-emit-contracts (symmetric to governing-emit-plan)
    //
    // The Contractor calls this ONCE after the Ruler has approved the
    // Planner's plan. Args carry the full contract set the Ruler will
    // ratify: top-level `reasoning` (high-level explanation of the
    // contract set as a whole), then a `contracts[]` array where each
    // entry is a single contract with kind/name/scope/details/rationale.
    // Server validates the shape, resolves `scope.shared`/`scope.local`
    // names to consumer node IDs (for LCA validation), and persists via
    // governing.setContracts which writes the contracts node and the
    // Ruler's contractApprovals ledger atomically.
    //
    // Idempotent: if every emitted contract is structurally identical
    // to an existing active contract, the persistence is a no-op (no
    // new approvals appended). This protects against double-write when
    // dispatch synthesizes a [[CONTRACTS]] block downstream.
    // ─────────────────────────────────────────────────────────────────
    {
      name: "governing-emit-contracts",
      description:
        "Emit the contract set for this Ruler scope. Use ONCE per Contractor invocation. " +
        "Args carry the full set: a top-level `reasoning` field (2-6 sentences explaining " +
        "the contract set as a whole), then a `contracts[]` array where each entry has " +
        "`kind` (e.g. 'event-name', 'storage-key', 'method-signature', 'dom-id', " +
        "'message-type', 'module-export'), `name` (the canonical identifier consumers use " +
        "verbatim), `scope` ('global' OR { shared: ['A', 'B', ...] } OR { local: '<name>' }), " +
        "`details` (the contract content — schema, signatures, payload shapes; cap 800 chars), " +
        "and `rationale` (1-3 sentences on why THIS contract specifically exists; cap 400). " +
        "scope.shared requires 2+ named consumers; if only one scope cares, use scope.local. " +
        "LCA validation runs server-side: a contract whose scope reaches outside this Ruler's " +
        "domain is rejected. Server persists to the Ruler's contracts trio member and appends " +
        "approval entries to contractApprovals. Returns {ok, accepted, rejected, skipped, " +
        "contractsNodeId, rulerNodeId}. After this tool succeeds, you are done — exit.",
      schema: {
        reasoning: z.string().describe(
          "2-6 sentences. Why this contract set takes this shape. What shared vocabulary the " +
          "approved plan implies, what coordination concerns drove which contracts. Cap 800.",
        ),
        contracts: z.array(z.object({
          kind: z.string().describe(
            "Contract category. Examples: event-name, storage-key, method-signature, dom-id, " +
            "message-type, module-export.",
          ),
          name: z.string().describe(
            "Canonical identifier. The actual string consumers will use in code. e.g. 'onScore' " +
            "for an event name, 'gameState' for a storage key.",
          ),
          scope: z.union([
            z.literal("global"),
            z.object({ shared: z.array(z.string()) }),
            z.object({ local: z.union([z.string(), z.array(z.string())]) }),
          ]).describe(
            "'global' = every scope under this Ruler. { shared: [A, B] } = ONLY these scopes " +
            "(2+ required). { local: 'X' } = private to one scope, declared for discoverability.",
          ),
          details: z.string().describe(
            "The contract content. Schema, function signatures, payload shapes, valid values. " +
            "Cap 800 chars.",
          ),
          rationale: z.string().describe(
            "1-3 sentences explaining why THIS contract exists. Pass 2 courts read this when " +
            "adjudicating contract conformance. Cap 400.",
          ),
        })).describe(
          "Array of contracts the Ruler ratifies. Each is one piece of shared vocabulary " +
          "scopes must agree on. If no contracts are needed for this plan, do not call the " +
          "tool — exit instead.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { userId, nodeId } = args;

        const validation = validateContractsArgs(args);
        if (!validation.ok) {
          return text(
            `governing-emit-contracts rejected:\n  - ${validation.errors.join("\n  - ")}\n\n` +
            `Re-emit with the listed corrections.`,
          );
        }

        const ruler = await resolveRuler(nodeId);
        if (!ruler) {
          return text(
            `governing-emit-contracts: no Ruler scope resolvable from current node ${String(nodeId).slice(0, 8)}. ` +
            `Surface as substrate bug.`,
          );
        }

        // Translate structured contracts → setContracts shape. Resolve
        // scope.shared / scope.local consumer names to node ids so LCA
        // validation runs in setContracts. For scope: "global" no
        // resolution needed.
        const incoming = [];
        for (const c of validation.value.contracts) {
          let consumerNames = [];
          if (c.scope && typeof c.scope === "object") {
            if (Array.isArray(c.scope.shared)) consumerNames = c.scope.shared;
            else if (typeof c.scope.local === "string") consumerNames = [c.scope.local];
            else if (Array.isArray(c.scope.local)) consumerNames = c.scope.local;
          }
          const consumerNodeIds = consumerNames.length
            ? (await resolveConsumerNodeIds(ruler._id, consumerNames)).filter(Boolean)
            : [];

          incoming.push({
            kind: c.kind,
            namespace: c.kind,
            name: c.name,
            scope: c.scope,
            details: c.details,
            rationale: c.rationale,
            consumerNodeIds,
          });
        }

        const sharedCount = incoming.filter((c) => c.scope && typeof c.scope === "object" && Array.isArray(c.scope.shared)).length;
        const globalCount = incoming.filter((c) => c.scope === "global").length;
        const localCount = incoming.length - sharedCount - globalCount;
        log.info("Governing",
          `📜 governing-emit-contracts validated: ` +
          `${incoming.length} contract${incoming.length === 1 ? "" : "s"} ` +
          `(${globalCount} global, ${sharedCount} shared, ${localCount} local), ` +
          `reasoning=${validation.value.reasoning.length}c`);

        let result = null;
        try {
          const { getExtension } = await import("../loader.js");
          const governing = getExtension("governing")?.exports;
          if (!governing?.setContracts) {
            return text(`governing-emit-contracts: setContracts unavailable (substrate misconfigured).`);
          }
          result = await governing.setContracts({
            scopeNodeId: ruler._id,
            contracts: incoming,
            userId,
            systemSpec: validation.value.reasoning.slice(0, 200),
            core,
          });
        } catch (err) {
          log.warn("Governing", `governing-emit-contracts persistence failed: ${err.message}`);
          return text(`governing-emit-contracts: persistence error: ${err.message}`);
        }

        const accepted = result?.accepted || [];
        const rejected = result?.rejected || [];
        const skipped = result?.skipped || [];

        if (rejected.length > 0) {
          const rejectionLines = rejected
            .map((r) => `  - ${r.kind}/${r.name}: ${r._rejectionReason}`)
            .join("\n");
          log.warn("Governing",
            `📜 governing-emit-contracts: ${rejected.length} contract(s) rejected at ` +
            `${String(ruler._id).slice(0, 8)} ("${ruler.name}"):\n${rejectionLines}`);
        }
        log.info("Governing",
          `📜 governing-emit-contracts persisted at ${String(ruler._id).slice(0, 8)}: ` +
          `${accepted.length} accepted, ${rejected.length} rejected, ${skipped.length} skipped`);

        return text(JSON.stringify({
          ok: rejected.length === 0,
          rulerNodeId: String(ruler._id),
          contractsNodeId: result?.contractsNode?._id ? String(result.contractsNode._id) : null,
          accepted: accepted.map((c) => ({ id: c.id, kind: c.kind, name: c.name, scope: c.scope })),
          rejected: rejected.map((r) => ({
            kind: r.kind || r.namespace,
            name: r.name,
            scope: r.scope,
            reason: r._rejectionReason,
          })),
          skipped: skipped.map((s) => ({
            kind: s.kind || s.namespace,
            name: s.name,
            existingId: s._existingId,
          })),
        }));
      },
    },
  ];
}
