// Intent Job
//
// The background job that makes the tree autonomous. Runs on a configurable
// interval. For each opted-in tree, collects state, generates intents
// through the AI, then executes each intent as a real AI interaction
// at the target node.
//
// The intent cycle:
// 1. Find trees with metadata.intent.enabled = true
// 2. For each tree, collect state from all installed signal sources
// 3. Send the state to the AI with the intent generation prompt
// 4. Parse the returned intents (JSON array)
// 5. For each intent, call runChat at the target node
// 6. Log each execution as a contribution (action: "intent:executed")
// 7. Write results to .intent node as notes

import log from "../../seed/log.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";
import { collectTreeState, formatStateForPrompt } from "./stateCollector.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";
import { getLandConfigValue } from "../../seed/landConfig.js";

let Node = null;
let User = null;
let runChat = null;
let logContribution = null;
let useEnergy = async () => ({ energyUsed: 0 });

export function setServices({ models, llm, contributions, energy }) {
  Node = models.Node;
  User = models.User;
  runChat = llm.runChat;
  logContribution = contributions.logContribution;
  if (energy?.useEnergy) useEnergy = energy.useEnergy;
}

let _timer = null;
let _running = false;

function getIntervalMs() {
  return Number(getLandConfigValue("intentIntervalMs")) || 30 * 60 * 1000; // 30 min default
}

function getMaxIntentsPerCycle() {
  return Number(getLandConfigValue("intentMaxPerCycle")) || 5;
}

export function startIntentJob() {
  if (_timer) return;
  const interval = getIntervalMs();
  _timer = setInterval(runCycle, interval);
  if (_timer.unref) _timer.unref();
  log.info("Intent", `Intent job started (checking every ${Math.round(interval / 60000)}m)`);
}

export function stopIntentJob() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

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

async function runCycle() {
  if (_running) return; // prevent overlap
  _running = true;

  try {
    // Find all trees opted in for autonomous intent
    const roots = await Node.find({
      rootOwner: { $nin: [null, "SYSTEM"] },
      "metadata.intent.enabled": true,
    }).select("_id name rootOwner metadata").lean();

    if (roots.length === 0) {
      _running = false;
      return;
    }

    log.verbose("Intent", `Intent cycle: ${roots.length} tree(s) opted in`);

    for (const root of roots) {
      try {
        // Check if paused
        const intentMeta = getExtMeta(root, "intent");
        if (intentMeta.paused) continue;

        await processTree(root);
      } catch (err) {
        log.warn("Intent", `Intent cycle failed for tree ${root.name} (${root._id}): ${err.message}`);
      }
    }
  } catch (err) {
    log.error("Intent", `Intent cycle error: ${err.message}`);
  } finally {
    _running = false;
  }
}

async function processTree(root) {
  const rootId = root._id.toString();
  const userId = root.rootOwner?.toString();
  if (!userId) return;

  const user = await User.findById(userId).select("username").lean();
  if (!user) return;

  // 1. Collect state
  const state = await collectTreeState(rootId, root, { Node });
  const stateText = formatStateForPrompt(state);

  if (!stateText) {
    log.debug("Intent", `No observable state for ${root.name}. Skipping.`);
    return;
  }

  // 2. Energy check for generation
  try {
    await useEnergy({ userId, action: "intentGenerate" });
  } catch {
    log.debug("Intent", `Insufficient energy for intent generation on ${root.name}`);
    return;
  }

  // 3. Generate intents via AI
  const maxIntents = getMaxIntentsPerCycle();
  const prompt = GENERATION_PROMPT
    .replace("{maxIntents}", String(maxIntents))
    .replace("{stateText}", stateText);

  let answer;
  try {
    const result = await runChat({
      userId,
      username: user.username,
      message: prompt,
      mode: "tree:respond",
      rootId,
    });
    answer = result?.answer;
  } catch (err) {
    log.warn("Intent", `Intent generation LLM call failed for ${root.name}: ${err.message}`);
    return;
  }

  if (!answer) return;

  // 4. Parse intents
  const parsed = parseJsonSafe(answer);
  if (!Array.isArray(parsed)) {
    log.debug("Intent", `Intent generation returned non-array for ${root.name}`);
    return;
  }

  const intents = parsed
    .filter(i => i && typeof i === "object" && i.action && i.targetNodeId)
    .slice(0, maxIntents);

  if (intents.length === 0) {
    log.debug("Intent", `No intents generated for ${root.name}. Tree is healthy.`);
    return;
  }

  log.verbose("Intent", `Generated ${intents.length} intent(s) for ${root.name}`);

  // 5. Ensure .intent node exists
  const intentNodeId = await ensureIntentNode(rootId);

  // 6. Execute each intent
  for (const intent of intents) {
    try {
      await executeIntent(intent, rootId, userId, user.username, intentNodeId);
    } catch (err) {
      log.warn("Intent", `Intent execution failed: ${intent.action}: ${err.message}`);
      // Log the failure on .intent
      await writeIntentResult(intentNodeId, intent, null, err.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// EXECUTION
// ─────────────────────────────────────────────────────────────────────────

async function executeIntent(intent, rootId, userId, username, intentNodeId) {
  // Energy check per execution
  try {
    await useEnergy({ userId, action: "intentExecute" });
  } catch {
    log.debug("Intent", `Insufficient energy for intent execution: ${intent.action}`);
    return;
  }

  // Verify target node exists and is in this tree
  const targetNode = await Node.findById(intent.targetNodeId).select("_id name rootOwner").lean();
  if (!targetNode) {
    log.debug("Intent", `Intent target node not found: ${intent.targetNodeId}`);
    return;
  }

  const mode = intent.mode || "tree:respond";

  // Build the intent message. This becomes the AI's instruction.
  const message =
    `[Autonomous intent, priority: ${intent.priority || "medium"}] ` +
    `${intent.action}. ` +
    `Reason: ${intent.reason || "observed state change"}. ` +
    `Use tools: ${(intent.tools || []).join(", ") || "as needed"}.`;

  log.verbose("Intent", `Executing: "${intent.action}" at node ${targetNode.name || intent.targetNodeId}`);

  // Execute as a real AI interaction at the target node
  let result;
  try {
    result = await runChat({
      userId,
      username,
      message,
      mode,
      rootId,
      nodeId: intent.targetNodeId,
    });
  } catch (err) {
    await writeIntentResult(intentNodeId, intent, null, err.message);
    throw err;
  }

  // Log as contribution
  await logContribution({
    userId,
    nodeId: intent.targetNodeId,
    wasAi: true,
    action: "intent:executed",
    extensionData: {
      intent: {
        action: intent.action,
        reason: intent.reason,
        priority: intent.priority,
        targetNodeId: intent.targetNodeId,
        tools: intent.tools,
        result: result?.answer?.slice(0, 500) || null,
      },
    },
  });

  // Write result to .intent node
  await writeIntentResult(intentNodeId, intent, result?.answer, null);
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
    const { v4: uuidv4 } = await import("uuid");
    intentNode = new Node({
      _id: uuidv4(),
      name: ".intent",
      parent: rootId,
      children: [],
      contributors: [],
      metadata: {},
    });
    await intentNode.save();

    // Add to root's children
    await Node.updateOne(
      { _id: rootId },
      { $addToSet: { children: intentNode._id } },
    );

    log.verbose("Intent", `Created .intent node for tree ${rootId}`);
  }

  return intentNode._id.toString();
}

async function writeIntentResult(intentNodeId, intent, result, error) {
  try {
    const { createNote } = await import("../../seed/tree/notes.js");
    const content = error
      ? `[FAILED] ${intent.action}\nReason: ${intent.reason}\nError: ${error}`
      : `[${intent.priority || "medium"}] ${intent.action}\nReason: ${intent.reason}\nResult: ${(result || "completed").slice(0, 2000)}`;

    await createNote({
      nodeId: intentNodeId,
      content,
      contentType: "text",
      userId: "SYSTEM",
    });
  } catch (err) {
    log.debug("Intent", `Failed to write intent result note: ${err.message}`);
  }
}
