// graph.js
// Execution graph primitives: build, evaluate, and walk structured intent graphs.
//
// Three primitives:
//   DISPATCH  - run one mode (wraps runModeAndReturn)
//   SEQUENCE  - run steps in order (wraps runChain)
//   FORK      - evaluate condition, pick path (three-valued: true/false/unknown)
//   FANOUT    - set expansion (reserved, not built)
//
// The grammar compiles intent into graph nodes.
// The runtime walks the graph and executes.

import log from "../../seed/log.js";
import {
  resolveRootLlmForMode,
  getClientForUser,
} from "../../seed/llm/conversation.js";
import { getModesOwnedBy as _getModesOwnedBy } from "../../seed/tree/extensionScope.js";

// ─────────────────────────────────────────────────────────────────────────
// Phase A: Evaluate condition (pure)
// No knowledge of graph nodes, execution, or modes.
// Returns three-valued result with confidence.
// ─────────────────────────────────────────────────────────────────────────

const CONDITION_EVAL_PROMPT = `Evaluate a condition against data. Output ONLY this JSON, nothing else:
{"result":true,"confidence":0.9,"reasoning":"short sentence"}
or
{"result":false,"confidence":0.9,"reasoning":"short sentence"}
If data is missing, set confidence under 0.5. No thinking, no preamble, just JSON.`;

const CONDITION_CONFIDENCE_THRESHOLD = 0.7;

export function serializeContextForEval(context) {
  const parts = [];
  if (context.name) parts.push(`Node: ${context.name}`);
  if (context.status) parts.push(`Status: ${context.status}`);

  // Extension-injected data (enrichContext results)
  for (const [key, val] of Object.entries(context)) {
    if (["id", "name", "status", "isRoot", "dateCreated", "type", "noteCount", "notes", "parent", "children", "siblings"].includes(key)) continue;
    if (val === null || val === undefined) continue;
    if (typeof val === "object") {
      try { parts.push(`${key}: ${JSON.stringify(val)}`); } catch {}
    } else {
      parts.push(`${key}: ${val}`);
    }
  }
  return parts.join("\n");
}

export async function evaluateCondition(conditionText, { rootId, nodeId, userId, signal, slot }) {
  try {
    const { getContextForAi } = await import("../../seed/tree/treeFetch.js");
    const context = await getContextForAi(nodeId, { userId });
    const contextStr = serializeContextForEval(context);

    if (!contextStr || contextStr.length < 10) {
      return { result: "unknown", confidence: 0, reasoning: "no data available at this position" };
    }

    const { parseJsonSafe } = await import("../../seed/orchestrators/helpers.js");

    // Get LLM client (reuse existing resolution chain)
    const modeConnectionId = await resolveRootLlmForMode(rootId, "tree:librarian");
    const clientInfo = await getClientForUser(userId, slot, modeConnectionId);
    if (clientInfo.noLlm) {
      return { result: "unknown", confidence: 0, reasoning: "no LLM configured" };
    }

    const response = await clientInfo.client.chat.completions.create(
      {
        model: clientInfo.model,
        messages: [
          { role: "system", content: CONDITION_EVAL_PROMPT },
          { role: "user", content: `Data:\n${contextStr}\n\nCondition: "${conditionText}"\n\nOutput JSON now.` },
        ],
        max_tokens: 4000,
        response_format: { type: "json_object" },
      },
      signal ? { signal } : {},
    );

    const choice = response.choices?.[0];
    let raw = choice?.message?.content;

    // Reasoning model fallback: some models (qwen, deepseek-r1) put output in a
    // separate `reasoning` field if they didn't finish thinking. Try to extract JSON from there.
    if (!raw && choice?.message?.reasoning) {
      const reasoningText = choice.message.reasoning;
      const jsonMatch = reasoningText.match(/\{[^{}]*"result"[^{}]*\}/);
      if (jsonMatch) raw = jsonMatch[0];
    }

    if (!raw) {
      log.info("Grammar", `Condition eval empty. model=${clientInfo.model} finish_reason=${choice?.finish_reason} full_choice=${JSON.stringify(choice || {}).slice(0, 500)}`);
      return { result: "unknown", confidence: 0, reasoning: "empty LLM response" };
    }

    const parsed = parseJsonSafe(raw);
    if (!parsed || typeof parsed.result !== "boolean") {
      return { result: "unknown", confidence: 0, reasoning: "unparseable evaluation response" };
    }

    const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0.5));
    const reasoning = parsed.reasoning || "";

    // Three-valued: confidence below threshold -> unknown
    if (confidence < CONDITION_CONFIDENCE_THRESHOLD) {
      return { result: "unknown", confidence, reasoning: reasoning || "insufficient confidence" };
    }

    return { result: parsed.result ? "true" : "false", confidence, reasoning };
  } catch (err) {
    log.debug("Grammar", `Condition evaluation failed: ${err.message}`);
    return { result: "unknown", confidence: 0, reasoning: `evaluation error: ${err.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Phase B: Resolve fork (pure)
// No side effects. Pure branch selection.
// ─────────────────────────────────────────────────────────────────────────

export function resolveFork(forkNode, evaluation) {
  if (evaluation.result === "true") return forkNode.truePath;
  if (evaluation.result === "false") return forkNode.falsePath;
  return forkNode.unknownPath;
}

// ─────────────────────────────────────────────────────────────────────────
// Set resolver (for FANOUT)
// Resolves quantifier + domain into concrete items with enriched context.
// Extensions can override with exports.resolveSet for precision.
// ─────────────────────────────────────────────────────────────────────────

const MAX_FANOUT_ITEMS = 20;

export async function resolveSet({ extName, rootId, quantifier, temporalScope, nodeId, userId, message }) {
  try {
    // Check if extension provides a custom resolver.
    // The extension is the authority on what "all my X" means inside its domain.
    // We pass the message so the extension can inspect keywords and decide which
    // subtree, metadata bucket, or note collection represents the set.
    const { getExtension } = await import("../loader.js");
    const ext = extName ? getExtension(extName) : null;
    if (ext?.exports?.resolveSet) {
      const custom = await ext.exports.resolveSet({ quantifier, temporalScope, rootId, userId, message });
      if (custom?.length > 0) return custom.slice(0, MAX_FANOUT_ITEMS);
    }

    // Generic: get children of the extension's node in this tree
    const { getIndexForRoot } = await import("./routingIndex.js");
    const index = rootId ? getIndexForRoot(rootId) : null;
    const entry = extName && index ? index.get(extName) : null;
    const targetId = nodeId || entry?.nodeId;
    if (!targetId) return [];

    const Node = (await import("../../seed/models/node.js")).default;
    const parent = await Node.findById(targetId).select("children").lean();
    if (!parent?.children?.length) return [];

    const children = await Node.find({
      _id: { $in: parent.children },
      systemRole: null,
    }).select("_id name metadata").lean();

    if (children.length === 0) return [];

    // Enrich each child's context (runs enrichContext hooks, gets real data)
    const { getContextForAi } = await import("../../seed/tree/treeFetch.js");
    const items = [];
    for (const child of children.slice(0, MAX_FANOUT_ITEMS)) {
      try {
        const ctx = await getContextForAi(child._id, { userId });
        items.push({ nodeId: String(child._id), name: child.name, context: ctx });
      } catch {
        // Skip nodes that fail enrichment
        items.push({ nodeId: String(child._id), name: child.name, context: { name: child.name } });
      }
    }

    // Apply quantifier filter
    if (quantifier?.type === "numeric") {
      return items.slice(0, quantifier.count);
    }
    // universal, superlative, comparative: return all, let synthesis handle ranking
    return items;
  } catch (err) {
    log.debug("Grammar", `Set resolution failed: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Graph builder (pure)
// Takes parse results, returns graph node. No side effects, no LLM calls.
// ─────────────────────────────────────────────────────────────────────────

export function makeDispatch(mode, extName, targetNodeId, modifiers = {}) {
  return {
    type: "dispatch",
    mode: mode || "tree:converse",
    extName: extName || null,
    targetNodeId: targetNodeId || null,
    tense: modifiers.tense || "present",
    modifiers: {
      adjectives: modifiers.adjectives || null,
      quantifiers: modifiers.quantifiers || null,
      temporalScope: modifiers.temporalScope || null,
      voice: modifiers.voice || "active",
      readOnly: modifiers.readOnly || false,
      treeCapabilities: modifiers.treeCapabilities || null,
    },
  };
}

export function makeFanout(mode, extName, targetNodeId, modifiers = {}) {
  return {
    type: "fanout",
    mode: mode || "tree:converse",
    extName: extName || null,
    targetNodeId: targetNodeId || null,
    itemResolver: {
      extName: extName || null,
      quantifier: modifiers.quantifiers?.[0] || null,
      temporalScope: modifiers.temporalScope || null,
    },
    modifiers: {
      adjectives: modifiers.adjectives || null,
      temporalScope: modifiers.temporalScope || null,
      voice: modifiers.voice || "active",
      readOnly: true, // fanout is always read
      treeCapabilities: modifiers.treeCapabilities || null,
    },
  };
}

export function buildExecutionGraph({
  resolvedMode, tenseInfo, conditional, adjectives, quantifiers,
  temporalScope, voice, causal, classification, behavioral, currentNodeId, rootId,
  extName,
}) {
  const mods = {
    adjectives: adjectives?.length > 0 ? adjectives : null,
    quantifiers,
    temporalScope,
    voice,
    readOnly: behavioral === "query",
  };

  // Priority 1: Conditional -> FORK
  if (conditional) {
    // The action dispatch: what happens when the condition is met (if/when) or not met (unless)
    const actionDispatch = makeDispatch(resolvedMode, extName, classification?.targetNodeId || currentNodeId, {
      ...mods, tense: tenseInfo?.tense || "present",
    });

    // The alternative dispatch: coach mode for graceful handling.
    // Resolve via the mode registry (getModesOwnedBy) instead of
    // string-concatenating `${extName}-coach`. Extension name and mode
    // prefix don't always match -- code-workspace owns tree:code-coach,
    // not tree:code-workspace-coach. Asking the registry for the
    // extension's modes and finding the one that ends in -coach is the
    // correct lookup. Falls back to the action mode if no coach exists,
    // so a fork against an extension without a coach mode just runs
    // the same dispatch on both branches (degenerate but safe).
    let altMode = resolvedMode;
    if (extName) {
      try {
        const ownedModes = _getModesOwnedBy(extName) || [];
        const coachMode = ownedModes.find((m) => m.endsWith("-coach"));
        if (coachMode) altMode = coachMode;
      } catch {}
    }
    const altDispatch = makeDispatch(altMode || resolvedMode, extName, classification?.targetNodeId || currentNodeId, {
      ...mods, tense: "future",
    });

    // Unknown path: coach with "couldn't determine" context
    const unknownDispatch = makeDispatch(altMode || resolvedMode, extName, classification?.targetNodeId || currentNodeId, {
      ...mods, tense: "future",
      adjectives: [...(mods.adjectives || []), { type: "condition-unknown", qualifier: "data insufficient to evaluate condition", subject: conditional.condition }],
    });

    // For "unless": invert. truePath = don't act (condition IS true), falsePath = act.
    if (conditional.type === "unless") {
      return {
        type: "fork",
        condition: { text: conditional.condition, type: conditional.type, keyword: conditional.keyword },
        truePath: altDispatch,
        falsePath: actionDispatch,
        unknownPath: unknownDispatch,
        source: "conditional",
      };
    }

    // For "if"/"when": truePath = act, falsePath = don't act
    return {
      type: "fork",
      condition: { text: conditional.condition, type: conditional.type, keyword: conditional.keyword },
      truePath: actionDispatch,
      falsePath: altDispatch,
      unknownPath: unknownDispatch,
      source: "conditional",
    };
  }

  // Priority 2: Quantifier + analytical mode -> FANOUT
  // Quantifiers on review/coach modes mean "resolve the set, bundle context, synthesize."
  // Quantifiers on log/plan modes stay as annotation (you log ONE thing, not a set).
  // TEMPORAL quantifiers alone ("this week", "last month") are time windows, not set selectors.
  // FANOUT only fires when there's a non-temporal quantifier (universal, numeric, superlative, comparative).
  if (quantifiers?.length > 0 && extName) {
    const hasSetQuantifier = quantifiers.some(q => q.type !== "temporal");
    const analyticTenses = ["past", "future", "negated"];
    const isAnalytic = analyticTenses.includes(tenseInfo?.tense) || behavioral === "query";
    if (hasSetQuantifier && isAnalytic) {
      return makeFanout(resolvedMode, extName, classification?.targetNodeId || currentNodeId, mods);
    }
  }

  // Priority 3: Compound tense -> SEQUENCE
  if (tenseInfo?.compound && tenseInfo.compound.length > 1) {
    return {
      type: "sequence",
      steps: tenseInfo.compound.map(step => makeDispatch(step.mode, step.extName, step.targetNodeId, {
        ...mods, tense: step.tense,
      })),
      source: "compound",
    };
  }

  // Priority 3: Causal -> single dispatch to effect domain's coach
  if (causal) {
    return makeDispatch(causal.effectMode, causal.effect, causal.effectNodeId, {
      ...mods,
      adjectives: [...(mods.adjectives || []), {
        type: "causal",
        qualifier: `${causal.cause} ${causal.connector}`,
        subject: causal.effect,
      }],
      voice: "passive",
      tense: "future",
    });
  }

  // Priority 4: Single dispatch
  return makeDispatch(resolvedMode, extName, classification?.targetNodeId || currentNodeId, {
    ...mods, tense: tenseInfo?.tense || "present",
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Graph executor (runtime)
// Recursive walker. The only place with side effects.
//
// runModeAndReturn, runChain, and emitStatus are resolved via dynamic
// import from dispatch.js.
// ─────────────────────────────────────────────────────────────────────────

export async function executeGraph(node, message, visitorId, opts) {
  if (!node) return { success: false, answer: "No execution path resolved." };

  if (node.type === "dispatch") {
    const { runModeAndReturn } = await import("./dispatch.js");
    return runModeAndReturn(visitorId, node.mode, message, {
      socket: opts.socket,
      username: opts.username,
      userId: opts.userId,
      rootId: opts.rootId,
      signal: opts.signal,
      slot: opts.slot,
      currentNodeId: node.targetNodeId || opts.currentNodeId,
      readOnly: node.modifiers.readOnly,
      clearHistory: opts.clearHistory || false,
      onToolLoopCheckpoint: opts.onToolLoopCheckpoint,
      modesUsed: opts.modesUsed,
      targetNodeId: node.targetNodeId,
      adjectives: node.modifiers.adjectives,
      quantifiers: node.modifiers.quantifiers,
      temporalScope: node.modifiers.temporalScope,
      voice: node.modifiers.voice,
      treeCapabilities: node.modifiers.treeCapabilities || null,
      reroutePrefix: opts.reroutePrefix || null,
      sessionId: opts.sessionId,
      rootChatId: opts.rootChatId,
    });
  }

  if (node.type === "sequence") {
    const { runChain } = await import("./dispatch.js");
    const chain = node.steps.map(s => ({
      mode: s.mode,
      extName: s.extName,
      targetNodeId: s.targetNodeId,
      tense: s.tense || "present",
    }));
    return runChain(chain, message, visitorId, {
      socket: opts.socket,
      username: opts.username,
      userId: opts.userId,
      rootId: opts.rootId,
      signal: opts.signal,
      slot: opts.slot,
      onToolLoopCheckpoint: opts.onToolLoopCheckpoint,
      modesUsed: opts.modesUsed,
    });
  }

  if (node.type === "fork") {
    const { emitStatus } = await import("./dispatch.js");
    emitStatus(opts.socket, "evaluating", node.condition.text);
    const evaluation = await evaluateCondition(node.condition.text, {
      rootId: opts.rootId,
      nodeId: opts.currentNodeId,
      userId: opts.userId,
      signal: opts.signal,
      slot: opts.slot,
    });
    const selected = resolveFork(node, evaluation);

    // Inject evaluation reasoning so the AI knows WHY this branch was taken
    if (selected.type === "dispatch" && evaluation.reasoning) {
      selected.modifiers.adjectives = [
        ...(selected.modifiers.adjectives || []),
        { type: "condition-result", qualifier: evaluation.reasoning, subject: node.condition.text },
      ];
    }

    log.info("Grammar", `FORK: "${node.condition.text}" -> ${evaluation.result} (conf=${evaluation.confidence.toFixed(2)}) -> ${selected.mode || selected.type} | ${evaluation.reasoning}`);
    return executeGraph(selected, message, visitorId, opts);
  }

  if (node.type === "fanout") {
    const { emitStatus } = await import("./dispatch.js");
    const { runModeAndReturn } = await import("./dispatch.js");
    emitStatus(opts.socket, "resolving", "Gathering data...");

    // Phase 1: Resolve the set
    const items = await resolveSet({
      extName: node.itemResolver.extName,
      rootId: opts.rootId,
      quantifier: node.itemResolver.quantifier,
      temporalScope: node.itemResolver.temporalScope,
      nodeId: node.targetNodeId || opts.currentNodeId,
      userId: opts.userId,
      message,
    });

    if (items.length === 0) {
      log.info("Grammar", `FANOUT: ${node.extName} -> 0 items resolved, falling back to dispatch`);
      // No items found: fall back to normal dispatch with quantifier annotation
      return runModeAndReturn(visitorId, node.mode, message, {
        socket: opts.socket,
        username: opts.username,
        userId: opts.userId,
        rootId: opts.rootId,
        signal: opts.signal,
        slot: opts.slot,
        currentNodeId: node.targetNodeId || opts.currentNodeId,
        readOnly: true,
        clearHistory: opts.clearHistory || false,
        onToolLoopCheckpoint: opts.onToolLoopCheckpoint,
        modesUsed: opts.modesUsed,
        adjectives: node.modifiers.adjectives,
        voice: node.modifiers.voice,
        treeCapabilities: node.modifiers.treeCapabilities || null,
      });
    }

    // Phase 2: Bundle all item contexts into one prompt
    const itemLines = items.map((item, i) => {
      const ctx = item.context || {};
      // Serialize enriched context per item
      const dataLines = [];
      for (const [key, val] of Object.entries(ctx)) {
        if (["id", "isRoot", "dateCreated", "type", "noteCount", "parent", "siblings"].includes(key)) continue;
        if (val === null || val === undefined) continue;
        if (typeof val === "object") {
          try { dataLines.push(`  ${key}: ${JSON.stringify(val)}`); } catch {}
        } else {
          dataLines.push(`  ${key}: ${val}`);
        }
      }
      return `Item ${i + 1} - ${item.name}:\n${dataLines.join("\n")}`;
    });

    const fanoutBlock = `[Fanout: ${items.length} items resolved]\n${itemLines.join("\n\n")}\n\nThe user asked about ${items.length} items. Analyze each and synthesize a complete response.`;

    log.info("Grammar", `FANOUT: ${node.extName} -> ${items.length} items resolved -> ${node.mode}`);

    // Phase 3: Single dispatch with bundled context (synthesis)
    return runModeAndReturn(visitorId, node.mode, message, {
      socket: opts.socket,
      username: opts.username,
      userId: opts.userId,
      rootId: opts.rootId,
      signal: opts.signal,
      slot: opts.slot,
      currentNodeId: node.targetNodeId || opts.currentNodeId,
      readOnly: true,
      clearHistory: opts.clearHistory || false,
      onToolLoopCheckpoint: opts.onToolLoopCheckpoint,
      modesUsed: opts.modesUsed,
      targetNodeId: node.targetNodeId,
      adjectives: node.modifiers.adjectives,
      temporalScope: node.modifiers.temporalScope,
      voice: node.modifiers.voice,
      treeCapabilities: node.modifiers.treeCapabilities || null,
      fanoutContext: fanoutBlock,
    });
  }

  return { success: false, answer: "Unknown graph node type." };
}

export function describeGraph(node) {
  if (!node) return "null";
  if (node.type === "dispatch") return `dispatch ${node.mode}`;
  if (node.type === "sequence") return `sequence ${node.steps.map(s => s.mode).join(" -> ")}`;
  if (node.type === "fork") return `fork(${node.condition.type} "${node.condition.text}") true=${describeGraph(node.truePath)} / false=${describeGraph(node.falsePath)} / unknown=${describeGraph(node.unknownPath)}`;
  if (node.type === "fanout") return `fanout ${node.extName} -> ${node.mode}`;
  return node.type;
}
