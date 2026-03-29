// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// modes/registry.js
// Central mode registry: defines all modes, their tools, and switching logic

import log from "../log.js";
import { getLandConfigValue } from "../landConfig.js";
import { resolveTools } from "../tools.js";
import { getNodeName } from "../tree/treeData.js";
import { treeFallback, homeFallback } from "./fallback.js";
import Node from "../models/node.js";


// ─────────────────────────────────────────────────────────────────────────
// BIG MODES
// ─────────────────────────────────────────────────────────────────────────
// Three zones. That's it. Sub-modes live within these.
export const BIG_MODES = {
  LAND: "land",
  HOME: "home",
  TREE: "tree",
};

// ─────────────────────────────────────────────────────────────────────────
// MODE DEFINITIONS
// Each mode exports: { name, emoji, label, bigMode, toolNames[], buildSystemPrompt(ctx) }
// ─────────────────────────────────────────────────────────────────────────
const ALL_MODES = {
  // Kernel fallbacks (the floor). Extensions register everything else via registerMode().
  "home:fallback": homeFallback,
  "tree:fallback": treeFallback,
};

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT ENTRY MODES (when entering a big mode)
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT_MODES = {
  [BIG_MODES.HOME]: "home:fallback",
  [BIG_MODES.TREE]: "tree:fallback",
};

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get a mode definition by full key (e.g. "tree:structure")
 */
export function getMode(modeKey) {
  return ALL_MODES[modeKey] || null;
}

/**
 * List sub-modes for a big mode. Used by the mode bar UI.
 * Returns [{ key, emoji, label }]
 */
export function getSubModes(bigMode) {
  const all = Object.entries(ALL_MODES)
    .filter(([key, mode]) => {
      if (!key.startsWith(bigMode + ":")) return false;
      // In home/land, hide internal modes. In tree, show everything.
      if (bigMode !== "tree" && mode.hidden) return false;
      return true;
    })
    .map(([key, mode]) => ({
      key,
      emoji: mode.emoji,
      label: mode.label,
    }));
  // Hide kernel fallbacks when real modes are registered
  if (all.length > 1) return all.filter(m => !m.key.endsWith(":fallback"));
  return all;
}

/**
 * Get the default sub-mode key when entering a big mode.
 */
export function getDefaultMode(bigMode) {
  return DEFAULT_MODES[bigMode] || null;
}

/**
 * Set the default entry mode for a big mode.
 * Called by extensions to upgrade from the kernel fallback.
 */
const VALID_BIG_MODES = new Set(Object.values(BIG_MODES));

export function setDefaultMode(bigMode, modeKey) {
  if (!VALID_BIG_MODES.has(bigMode)) {
    log.warn("Modes", `Cannot set default: "${bigMode}" is not a valid zone (${[...VALID_BIG_MODES].join(", ")})`);
    return false;
  }
  if (!ALL_MODES[modeKey]) {
    log.warn("Modes", `Cannot set default for ${bigMode}: mode "${modeKey}" not registered`);
    return false;
  }
  DEFAULT_MODES[bigMode] = modeKey;
  return true;
}

/**
 * Resolve the mode key for an intent at a specific node.
 * Checks node metadata.modes for per-node overrides, walks up to root,
 * then falls back to the default mode for the bigMode.
 *
 * @param {string} intent - e.g. "navigate", "structure", "respond", "librarian"
 * @param {string} bigMode - e.g. "tree", "home", "land"
 * @param {object|null} nodeMetadata - current node's metadata (or null)
 * @param {Set<string>|null} blockedExtensions - full set of blocked extensions at this position
 *   (from ancestor chain walk). If null, falls back to node-local metadata.extensions.blocked.
 * @returns {string} resolved mode key (e.g. "tree:navigate" or "custom:smart-nav")
 */
export function resolveMode(intent, bigMode, nodeMetadata = null, blockedExtensions = null) {
  // Guard against undefined/null intent or bigMode producing keys like "tree:undefined"
  if (!intent || typeof intent !== "string") return DEFAULT_MODES[bigMode] || `${bigMode || "tree"}:fallback`;
  if (!bigMode || typeof bigMode !== "string") bigMode = "tree";

  const meta = nodeMetadata instanceof Map ? Object.fromEntries(nodeMetadata) : (nodeMetadata || {});

  // Spatial extension scoping: prefer the full ancestor-chain blocked set if provided.
  // Falls back to node-local metadata for backward compat with callers that don't pass it.
  const blockedExts = blockedExtensions
    || (meta.extensions?.blocked ? new Set(meta.extensions.blocked) : null);

  // Layer 1: per-node override (skip if owning extension is blocked)
  const nodeMode = meta.modes?.[intent];
  if (nodeMode && ALL_MODES[nodeMode]) {
    const owner = ALL_MODES[nodeMode]._extName;
    if (!blockedExts || !owner || !blockedExts.has(owner)) {
      return nodeMode;
    }
  }

  // Layer 2: default mapping (bigMode:intent)
  const defaultKey = `${bigMode}:${intent}`;
  if (ALL_MODES[defaultKey]) {
    const owner = ALL_MODES[defaultKey]._extName;
    if (!blockedExts || !owner || !blockedExts.has(owner)) {
      return defaultKey;
    }
  }

  // Layer 3: bigMode default
  return DEFAULT_MODES[bigMode] || defaultKey;
}

/**
 * Set a per-node mode override. Extensions use this to assign custom modes
 * to specific nodes (e.g., fitness-log on the Fitness root).
 *
 *   await setNodeMode(nodeId, "respond", "tree:fitness-log");
 *   // Node's metadata.modes.respond = "tree:fitness-log"
 */
export async function setNodeMode(nodeId, intent, modeKey) {
  if (!nodeId || !intent || !modeKey) return false;
  // Validate intent: safe key name, no dots/dollars/proto injection
  if (typeof intent !== "string" || intent.length === 0 || intent.length > 50) return false;
  if (/[.$]/.test(intent) || intent === "__proto__" || intent === "constructor" || intent === "prototype") return false;
  // Validate modeKey: must be a registered mode
  if (typeof modeKey !== "string" || !ALL_MODES[modeKey]) return false;
  await Node.updateOne(
    { _id: String(nodeId) },
    { $set: { [`metadata.modes.${intent}`]: modeKey } }
  );
  return true;
}

/**
 * Resolve the OpenAI-compatible tools array for a mode.
 * Merges three layers:
 *   1. Mode's base toolNames[]
 *   2. Extension-injected tools (via loader)
 *   3. Tree-specific tools (from root node metadata.tools.allowed[])
 */
export function getToolsForMode(modeKey, treeToolConfig = null) {
  const mode = ALL_MODES[modeKey];
  if (!mode) return [];

  // Layer 1: mode base tools
  let toolNames = [...mode.toolNames];

  // Layer 2: extension-injected tools
  const extTools = _getExtToolsFn(modeKey);
  if (extTools.length > 0) {
    toolNames = [...new Set([...toolNames, ...extTools])];
  }

  // Layer 3: tree-specific tools from root node metadata
  // treeToolConfig = { allowed: ["execute-shell", "my-tool"], blocked: ["delete-node-branch"] }
  if (treeToolConfig) {
    if (Array.isArray(treeToolConfig.allowed)) {
      toolNames = [...new Set([...toolNames, ...treeToolConfig.allowed])];
    }
    if (Array.isArray(treeToolConfig.blocked)) {
      const blockedSet = new Set(treeToolConfig.blocked);
      toolNames = toolNames.filter(t => !blockedSet.has(t));
    }
  }

  return resolveTools(toolNames);
}

// Extension tool injection hook. Set by the loader after initialization.
let _getExtToolsFn = () => [];

// Mode registration callback. Set by loader for spatial scoping.
let _onModeRegistered = null;
export function setModeRegistrationHook(fn) { _onModeRegistered = fn; }

/**
 * Called by extension loader to register the tool injection function.
 * This avoids circular imports between registry and loader.
 */
export function setExtensionToolResolver(fn) {
  _getExtToolsFn = fn;
}

/**
 * Register a custom mode from an extension.
 * The mode object must have: name, bigMode, toolNames[], buildSystemPrompt(ctx)
 * Optional: emoji, label, hidden, maxMessagesBeforeLoop, preserveContextOnLoop
 */
let MAX_REGISTERED_MODES = 200;
export function setMaxModes(n) { MAX_REGISTERED_MODES = Math.max(10, Number(n) || 200); }

// modeKey format: "bigMode:subMode" where both parts are lowercase alphanumeric + hyphens
const MODE_KEY_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

export function registerMode(modeKey, modeConfig, extName = "unknown") {
  if (!modeKey || !modeConfig) {
    log.warn("Modes", `Invalid mode registration from ${extName}`);
    return false;
  }
  if (typeof modeKey !== "string" || !MODE_KEY_RE.test(modeKey)) {
    log.warn("Modes", `Invalid mode key format "${modeKey}" from ${extName}. Expected "bigMode:subMode" (lowercase alphanumeric + hyphens).`);
    return false;
  }
  if (Object.keys(ALL_MODES).length >= MAX_REGISTERED_MODES) {
    log.error("Modes", `Mode registry full (${MAX_REGISTERED_MODES} modes). "${modeKey}" from "${extName}" rejected.`);
    return false;
  }
  if (!modeConfig.buildSystemPrompt || typeof modeConfig.buildSystemPrompt !== "function") {
    log.warn("Modes", `Mode "${modeKey}" from ${extName} missing buildSystemPrompt(). Skipped.`);
    return false;
  }
  if (!Array.isArray(modeConfig.toolNames)) {
    log.warn("Modes", `Mode "${modeKey}" from ${extName} missing toolNames[]. Skipped.`);
    return false;
  }
  // Validate toolNames entries are all strings
  if (modeConfig.toolNames.some(t => typeof t !== "string")) {
    log.warn("Modes", `Mode "${modeKey}" from ${extName} has non-string entries in toolNames[]. Skipped.`);
    return false;
  }
  if (ALL_MODES[modeKey]) {
    const existingOwner = ALL_MODES[modeKey]._extName || "kernel";
    log.warn("Modes", `Mode "${modeKey}" already registered by "${existingOwner}". "${extName}" cannot override.`);
    return false;
  }

  // Fill in defaults
  const mode = {
    name: modeKey,
    emoji: modeConfig.emoji || "🧩",
    label: modeConfig.label || modeKey.split(":")[1] || modeKey,
    bigMode: modeConfig.bigMode || modeKey.split(":")[0] || "tree",
    hidden: modeConfig.hidden ?? false,
    toolNames: modeConfig.toolNames,
    buildSystemPrompt: modeConfig.buildSystemPrompt,
    maxMessagesBeforeLoop: modeConfig.maxMessagesBeforeLoop,
    preserveContextOnLoop: modeConfig.preserveContextOnLoop,
  };

  mode._extName = extName;
  ALL_MODES[modeKey] = mode;
  if (_onModeRegistered) _onModeRegistered(modeKey, extName);
  log.verbose("Modes", `Registered: ${modeKey} (${extName})`);
  return true;
}

/**
 * Unregister all modes from an extension.
 */
export function unregisterModes(extName) {
  for (const [key, mode] of Object.entries(ALL_MODES)) {
    if (mode._extName === extName) {
      delete ALL_MODES[key];
      // If this mode was the default for its bigMode, fall back to kernel fallback
      for (const [bigMode, defaultKey] of Object.entries(DEFAULT_MODES)) {
        if (defaultKey === key) {
          DEFAULT_MODES[bigMode] = `${bigMode}:fallback`;
          log.verbose("Modes", `Default mode for ${bigMode} reset to fallback (${extName} unregistered)`);
        }
      }
    }
  }
}

/**
 * Build the system prompt for a mode, given context.
 * Three layers, always in this order:
 *   1. [Position] block (seed layer, guaranteed, cannot be excluded)
 *   2. Mode prompt (domain layer, from mode.buildSystemPrompt)
 *   3. Current time (land timezone)
 *
 * The seed injects structural context so the AI always knows where it is.
 * No extension mode can forget to include position. No mode can override it.
 */
export async function buildPromptForMode(modeKey, ctx) {
  const mode = ALL_MODES[modeKey];
  if (!mode) throw new Error(`Unknown mode: ${modeKey}`);

  // ── Seed layer: guaranteed structural context ──
  const positionLines = [];

  if (ctx.username) {
    positionLines.push(`User: ${ctx.username}`);
  }

  const bigMode = mode.bigMode;

  if (bigMode === "tree") {
    const rootId = ctx.rootId || null;
    const currentNodeId = ctx.currentNodeId || ctx.targetNodeId || null;
    const targetNodeId = ctx.targetNodeId || null;

    // Resolve node names in parallel. Graceful fallback to ID-only on failure.
    const idsToResolve = {};
    if (rootId) idsToResolve.root = rootId;
    if (currentNodeId && currentNodeId !== rootId) idsToResolve.current = currentNodeId;
    if (targetNodeId && targetNodeId !== rootId && targetNodeId !== currentNodeId) idsToResolve.target = targetNodeId;

    const names = {};
    try {
      const entries = Object.entries(idsToResolve);
      if (entries.length > 0) {
        const resolved = await Promise.all(entries.map(([, id]) => getNodeName(id)));
        entries.forEach(([key], i) => { names[key] = resolved[i]; });
      }
    } catch (nameErr) {
      // DB error: degrade to ID-only. The AI still knows where it is.
      log.debug("Modes", `Node name resolution failed: ${nameErr.message}`);
    }

    if (rootId) {
      const rootName = names.root;
      positionLines.push(rootName ? `Tree: ${rootName} (${rootId})` : `Tree: ${rootId}`);
    }
    if (currentNodeId && currentNodeId !== rootId) {
      const nodeName = names.current;
      positionLines.push(nodeName ? `Current node: ${nodeName} (${currentNodeId})` : `Current node: ${currentNodeId}`);
    }
    if (targetNodeId && targetNodeId !== rootId && targetNodeId !== currentNodeId) {
      const targetName = names.target;
      positionLines.push(targetName ? `Target node: ${targetName} (${targetNodeId})` : `Target node: ${targetNodeId}`);
    }
  } else if (bigMode === "home") {
    positionLines.push("Zone: Home");
  } else if (bigMode === "land") {
    positionLines.push("Zone: Land");
  }

  const positionBlock = positionLines.length > 0
    ? `[Position]\n${positionLines.join("\n")}\n\n`
    : "";

  // ── Mode layer: domain-specific prompt ──
  // Await in case the extension's buildSystemPrompt is async (fetching node data, etc.)
  // Catch errors from buggy extension prompt builders so the AI still gets a response.
  let modePrompt;
  try {
    modePrompt = await Promise.resolve(mode.buildSystemPrompt(ctx));
  } catch (promptErr) {
    log.error("Modes", `buildSystemPrompt for "${modeKey}" threw: ${promptErr.message}`);
    modePrompt = `[Mode: ${modeKey}] (prompt generation failed, assist the user as best you can)`;
  }
  // Guard against oversized prompts consuming the entire context window.
  // 32KB is generous for a system prompt. Anything larger is a bug.
  const maxPromptChars = Number(getLandConfigValue("maxSystemPromptChars")) || 32000;
  if (typeof modePrompt === "string" && modePrompt.length > maxPromptChars) {
    log.warn("Modes", `System prompt for "${modeKey}" is ${modePrompt.length} chars. Truncating to ${maxPromptChars}.`);
    modePrompt = modePrompt.slice(0, maxPromptChars) + "\n... (system prompt truncated)";
  }
  if (typeof modePrompt !== "string") {
    log.error("Modes", `buildSystemPrompt for "${modeKey}" returned ${typeof modePrompt}, expected string`);
    modePrompt = `[Mode: ${modeKey}]`;
  }

  // ── Time layer: land timezone ──
  const tz = getLandConfigValue("timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone;
  let timeStr;
  try {
    timeStr = new Date().toLocaleString("en-US", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch (tzErr) {
    log.debug("Modes", `Timezone "${tz}" failed: ${tzErr.message}. Using ISO.`);
    timeStr = new Date().toISOString();
  }

  return `${positionBlock}${modePrompt}\n\nCurrent time: ${timeStr}`;
}

/**
 * Determine big mode from a URL path.
 *   /user/:userId  → HOME
 *   /node/:nodeId       → TREE
 *   /root/:nodeId  → TREE
 */

const NODE_ID_PATTERN =
  "(?:[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})";
// Matches both MongoDB ObjectIds (24 hex) and UUIDs (8-4-4-4-12 hex with dashes)
const NODE_PREFIX_PATTERN = new RegExp(
  `^(/api/v1)?/node/(${NODE_ID_PATTERN})(/|$)`,
  "i",
);

export function bigModeFromUrl(urlPath) {
  if (!urlPath) return BIG_MODES.HOME;
  const clean = urlPath.split("?")[0]; // strip query
  // Match with or without /api/v1 prefix
  if (NODE_PREFIX_PATTERN.test(clean)) {
    return BIG_MODES.TREE;
  }
  if (clean.match(/^(\/api\/v1)?\/user\//)) return BIG_MODES.HOME;
  if (clean.match(/^(\/api\/v1)?\/root\//)) return BIG_MODES.TREE;
  // bare /:nodeId or /api/v1/:nodeId

  return BIG_MODES.HOME;
}

/**
 * Get all unique tool names available across all modes for a bigMode.
 * Used by node pages to show what tools the AI can use.
 */
export function getAllToolNamesForBigMode(bigMode) {
  const names = new Set();
  const prefix = bigMode + ":";
  for (const [key, mode] of Object.entries(ALL_MODES)) {
    if (key.startsWith(prefix)) {
      for (const t of mode.toolNames) names.add(t);
      for (const t of _getExtToolsFn(key)) names.add(t);
    }
  }
  return [...names].sort();
}

/**
 * Number of recent messages to carry across a mode switch.
 */
export let CARRY_MESSAGES = 4;
export function setCarryMessages(n) { CARRY_MESSAGES = Math.max(0, Math.min(20, Number(n) || 4)); }
