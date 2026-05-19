// Intent Job
//
// The autonomous intent engine. Slice 6c converted this from a
// setInterval-driven background job into the `@intent` Mode 1 being
// (see intentEmbodiment.js). The work — observing trees, generating
// intents, executing them — is unchanged; what shifted is the
// trigger: schedule registry emits a scheduled-wake SUMMON to the
// @intent being on cadence; the being calls `runCycle` here.
//
// OrchestratorRuntime stays inside per-tree processing for now — it
// manages session lifecycle, lock management, abort signal, and step
// tracking for the multi-LLM-call cycle. A future pass decomposes
// each cycle into multiple smaller SUMMONs (one per tree, one per
// intent) which makes the orchestrator usage unnecessary; for now the
// being wraps the existing pipeline.
//
// The intent cycle:
// 1. Find trees with metadata.intent.enabled = true
// 2. For each tree, collect state from all installed signal sources
// 3. Send the state to the AI via rt.runStep with the intent generation prompt
// 4. Parse the returned intents (JSON array)
// 5. For each intent, rt.runStep at the target node
// 6. Log each execution as a Did (action: "intent:executed")
// 7. Write results to .intent node as artifacts

import log from "../../seed/log.js";
import { collectTreeState, formatStateForPrompt } from "./stateCollector.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";
import { OrchestratorRuntime } from "../../seed/orchestrators/runtime.js";
import { getLandConfigValue } from "../../seed/landConfig.js";

let LLM_PRIORITY;
try {
  ({ LLM_PRIORITY } = await import("../../seed/llm/conversation.js"));
} catch {
  LLM_PRIORITY = { BACKGROUND: 4 };
}

let Node = null;
let Being = null;
let logDid = null;
let useEnergy = async () => ({ energyUsed: 0 });
let _metadata = null;

export function setServices({ models, contributions, energy, metadata }) {
  Node = models.Node;
  Being = models.Being;
  logDid = contributions.logDid;
  if (energy?.useEnergy) useEnergy = energy.useEnergy;
  if (metadata) _metadata = metadata;
}

let _running = false;

export function getIntervalMs() {
  return Number(getLandConfigValue("intentIntervalMs")) || 30 * 60 * 1000; // 30 min default
}

function getMaxIntentsPerCycle() {
  return Number(getLandConfigValue("intentMaxPerCycle")) || 5;
}

// Legacy lifecycle hooks. Kept as no-ops so existing job-list wiring
// doesn't break during the Slice 6c rollout. The @intent being's
// scheduled wake replaces these; setInterval is gone.
export function startIntentJob() { /* no-op — schedule registry drives now */ }
export function stopIntentJob()  { /* no-op — unschedule via core.ibp.unschedule("intent:cycle") */ }

// ─────────────────────────────────────────────────────────────────────────
// INTENT GENERATION PROMPT
// ─────────────────────────────────────────────────────────────────────────

const GENERATION_PROMPT = `You are the intent engine for this tree. You observe its health, patterns, contradictions, gaps, and user behavior. Generate actions the tree should take on its own.

Rules:
- Only generate intents justified by the data below
- Never generate intents matching the rejected patterns listed
- Priority: health > contradictions > maintenance > nudges
- Max {maxIntents} intents per cycle
- Each intent must name a specific nodeId and specific tools to use
- Never generate delete actions. The tree can create, write, compress, alert. It cannot delete.
- Do not invent work. If the state looks healthy with no issues, return an empty array.

Return a JSON array of intents. Each intent:
{
  "action": "short description of what to do",
  "reason": "why this is justified by the current state",
  "targetNodeId": "the node ID to act on",
  "priority": "high" | "medium" | "low",
  "tools": ["tool-names", "to-use"],
  "mode": "tree:respond" (or whichever mode is appropriate)
}

If nothing needs attention, return: []

Current tree state:
- {stateText}`;

// ─────────────────────────────────────────────────────────────────────────
// CYCLE
// ─────────────────────────────────────────────────────────────────────────

// Public entry point. Called by intentEmbodiment.summon when @intent
// is summoned (scheduled or manual). Returns a brief summary the
// being uses as its response content.
//
// `opts.signal` is the per-summon AbortController signal threaded
// from the scheduler. Long cycles check it between trees so cancel
// SUMMONs can interrupt mid-cycle.
export async function runCycle({ signal } = {}) {
  if (_running) {
    log.debug("Intent", "runCycle re-entered while already running; skipping overlap");
    return { skipped: true, reason: "already-running", treesProcessed: 0, intentsExecuted: 0 };
  }
  _running = true;

  let treesProcessed = 0;
  let intentsExecuted = 0;
  try {
    // Find all trees opted in for autonomous intent
    const roots = await Node.find({
      rootOwner: { $nin: [null, "SYSTEM"] },
      "metadata.intent.enabled": true,
    }).select("_id name rootOwner metadata").lean();

    if (roots.length === 0) {
      return { treesProcessed: 0, intentsExecuted: 0, text: "no trees opted in" };
    }

    log.verbose("Intent", `Intent cycle: ${roots.length} tree(s) opted in`);

    for (const root of roots) {
      if (signal?.aborted) {
        log.info("Intent", `runCycle aborted at tree ${root._id} (signal aborted)`);
        break;
      }
      try {
        // Check if paused
        const intentMeta = _metadata.getExtMeta(root, "intent");
        if (intentMeta.paused) continue;

        const count = await processTree(root, { signal });
        treesProcessed++;
        if (Number.isFinite(count)) intentsExecuted += count;
      } catch (err) {
        log.warn("Intent", `Intent cycle failed for tree ${root.name} (${root._id}): ${err.message}`);
      }
    }
    return { treesProcessed, intentsExecuted };
  } catch (err) {
    log.error("Intent", `Intent cycle error: ${err.message}`);
    return { treesProcessed, intentsExecuted, error: err.message };
  } finally {
    _running = false;
  }
}

async function processTree(root, { signal } = {}) {
  const rootId = root._id.toString();
  const beingId = root.rootOwner?.toString();
  if (!beingId) return 0;

  const user = await Being.findById(beingId).select("username").lean();
  if (!user) return;

  // Tree-scoped intent lane — successive intent cycles on the same tree
  // chain so the AI remembers prior proposals and their outcomes.
  const rt = new OrchestratorRuntime({
    rootId,
    beingId,
    username: user.username,
    scope: "tree",
    purpose: "intent",
    sessionType: "INTENT",
    description: `Intent cycle for tree ${root.name}`,
    modeKeyForLlm: "tree:respond",
    slot: "intent",
    lockNamespace: "intent",
    lockKey: `intent:${rootId}`,
    llmPriority: LLM_PRIORITY?.BACKGROUND || 4,
  });

  const ok = await rt.init("Starting intent cycle");
  if (!ok) {
    log.debug("Intent", `Intent cycle already running for ${root.name}. Skipping.`);
    return;
  }

  try {
    // 1. Collect state
    const state = await collectTreeState(rootId, root, { Node });
    const stateText = formatStateForPrompt(state);

    if (!stateText) {
      log.debug("Intent", `No observable state for ${root.name}. Skipping.`);
      rt.setResult("No observable state", "tree:respond");
      return;
    }

    rt.trackStep("tree:respond", {
      input: { phase: "state-collection", rootId },
      output: { sectionsCollected: stateText.split("\n").length },
      startTime: Date.now(),
      endTime: Date.now(),
    });

    if (rt.aborted) {
      rt.setError("Intent cycle cancelled", "tree:respond");
      return;
    }

    // 2. Energy check for generation
    try {
      await useEnergy({ beingId, action: "intentGenerate" });
    } catch {
      log.debug("Intent", `Insufficient energy for intent generation on ${root.name}`);
      rt.setResult("Insufficient energy", "tree:respond");
      return;
    }

    // 3. Generate intents via AI (through runStep)
    const maxIntents = getMaxIntentsPerCycle();
    const prompt = GENERATION_PROMPT
      .replace("{maxIntents}", String(maxIntents))
      .replace("{stateText}", stateText);

    let parsed = null;
    try {
      const result = await rt.runStep("tree:respond", {
        prompt,
      });
      parsed = result?.parsed;
    } catch (err) {
      log.warn("Intent", `Intent generation LLM call failed for ${root.name}: ${err.message}`);
      rt.setError(err.message, "tree:respond");
      return;
    }

    if (!Array.isArray(parsed)) {
      log.debug("Intent", `Intent generation returned non-array for ${root.name}`);
      rt.setResult("No intents generated (non-array response)", "tree:respond");
      return;
    }

    const intents = parsed
      .filter(i => i && typeof i === "object" && i.action && i.targetNodeId)
      .slice(0, maxIntents);

    if (intents.length === 0) {
      log.debug("Intent", `No intents generated for ${root.name}. Tree is healthy.`);
      rt.setResult("No intents needed", "tree:respond");
      return;
    }

    log.verbose("Intent", `Generated ${intents.length} intent(s) for ${root.name}`);

    // 4. Ensure .intent node exists
    const intentNodeId = await ensureIntentNode(rootId);

    // 5. Execute each intent (each is a runStep at the target node)
    const recentExecutions = [];

    for (const intent of intents) {
      if (rt.aborted) {
        log.debug("Intent", "Intent cycle aborted between executions");
        break;
      }

      try {
        const execResult = await executeIntent(rt, intent, rootId, beingId, user.username, intentNodeId);
        recentExecutions.push({
          action: intent.action,
          reason: intent.reason,
          result: execResult?.slice(0, 200) || "completed",
          executedAt: new Date().toISOString(),
        });
      } catch (err) {
        log.warn("Intent", `Intent execution failed: ${intent.action}: ${err.message}`);
        await writeIntentResult(intentNodeId, intent, null, err.message);
      }
    }

    // 6. Write recent executions to metadata for enrichContext
    try {
      const rootNode = await Node.findById(rootId);
      if (rootNode) {
        const meta = _metadata.getExtMeta(rootNode, "intent") || {};
        meta.recentExecutions = [
          ...recentExecutions,
          ...(meta.recentExecutions || []),
        ].slice(0, 20);
        await _metadata.setExtMeta(rootNode, "intent", meta);
      }
    } catch (err) {
      log.debug("Intent", `Failed to write recent executions to metadata: ${err.message}`);
    }

    rt.setResult(`Executed ${recentExecutions.length} intent(s)`, "tree:respond");
    return recentExecutions.length;
  } catch (err) {
    rt.setError(err.message, "tree:respond");
    throw err;
  } finally {
    await rt.cleanup();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// EXECUTION
// ─────────────────────────────────────────────────────────────────────────

async function executeIntent(rt, intent, rootId, beingId, username, intentNodeId) {
  // Energy check per execution
  try {
    await useEnergy({ beingId, action: "intentExecute" });
  } catch {
    log.debug("Intent", `Insufficient energy for intent execution: ${intent.action}`);
    return null;
  }

  // Verify target node exists and is in this tree
  const targetNode = await Node.findById(intent.targetNodeId).select("_id name rootOwner").lean();
  if (!targetNode) {
    log.debug("Intent", `Intent target node not found: ${intent.targetNodeId}`);
    return null;
  }

  // Build the intent message. This becomes the AI's instruction.
  const message =
    `[Autonomous intent, priority: ${intent.priority || "medium"}] ` +
    `${intent.action}. ` +
    `Reason: ${intent.reason || "observed state change"}. ` +
    `Use tools: ${(intent.tools || []).join(", ") || "as needed"}.`;

  log.verbose("Intent", `Executing: "${intent.action}" at node ${targetNode.name || intent.targetNodeId}`);

  const mode = intent.mode || "tree:respond";

  // Execute through the runtime's runStep
  let resultText = null;
  try {
    const { raw } = await rt.runStep(mode, {
      prompt: message,
      treeContext: { nodeId: intent.targetNodeId },
    });
    resultText = raw || "completed";
  } catch (err) {
    await writeIntentResult(intentNodeId, intent, null, err.message);
    throw err;
  }

  // Log as contribution
  await logDid({
    beingId,
    nodeId: intent.targetNodeId,
    action: "intent:executed",
    extensionData: {
      intent: {
        action: intent.action,
        reason: intent.reason,
        priority: intent.priority,
        targetNodeId: intent.targetNodeId,
        tools: intent.tools,
        result: resultText?.slice(0, 500) || null,
      },
    },
  });

  // Write result to .intent node
  await writeIntentResult(intentNodeId, intent, resultText, null);
  return resultText;
}

// ─────────────────────────────────────────────────────────────────────────
// .INTENT NODE
// ─────────────────────────────────────────────────────────────────────────

async function ensureIntentNode(rootId) {
  // Find or create the .intent node under the tree root
  let intentNode = await Node.findOne({
    parent: rootId,
    name: ".intent",
  }).select("_id").lean();

  if (!intentNode) {
    const { createSystemNode } = await import("../../seed/tree/treeManagement.js");
    intentNode = await createSystemNode({ name: ".intent", parentId: rootId });
    log.verbose("Intent", `Created .intent node for tree ${rootId}`);
  }

  return intentNode._id.toString();
}

async function writeIntentResult(intentNodeId, intent, result, error) {
  try {
    const { createArtifact } = await import("../../seed/tree/artifacts.js");
    const content = error
      ? `[FAILED] ${intent.action}\nReason: ${intent.reason}\nError: ${error}`
      : `[${intent.priority || "medium"}] ${intent.action}\nReason: ${intent.reason}\nResult: ${(result || "completed").slice(0, 2000)}`;

    await createArtifact({
      nodeId: intentNodeId,
      content,
      origin: "ibp",
      beingId: "SYSTEM",
    });
  } catch (err) {
    log.debug("Intent", `Failed to write intent result note: ${err.message}`);
  }
}
