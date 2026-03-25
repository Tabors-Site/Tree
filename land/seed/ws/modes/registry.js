// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// ws/modes/registry.js
// Central mode registry: defines all modes, their tools, and switching logic

import log from "../../log.js";
import { getLandConfigValue } from "../../landConfig.js";
import { resolveTools } from "../tools.js";
import { getNodeName } from "../../tree/treeData.js";
import { treeFallback, homeFallback } from "./fallback.js";


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
  return Object.entries(ALL_MODES)
    .filter(([key]) => key.startsWith(bigMode + ":"))
    .map(([key, mode]) => ({
      key,
      emoji: mode.emoji,
      label: mode.label,
    }));
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
export function setDefaultMode(bigMode, modeKey) {
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
 * @returns {string} resolved mode key (e.g. "tree:navigate" or "custom:smart-nav")
 */
export function resolveMode(intent, bigMode, nodeMetadata = null) {
  const meta = nodeMetadata instanceof Map ? Object.fromEntries(nodeMetadata) : (nodeMetadata || {});

  // Spatial extension scoping: collect blocked extensions from node metadata
  const blockedExts = meta.extensions?.blocked ? new Set(meta.extensions.blocked) : null;

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
      toolNames = toolNames.filter(t => !treeToolConfig.blocked.includes(t));
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
export function registerMode(modeKey, modeConfig, extName = "unknown") {
  if (!modeKey || !modeConfig) {
    log.warn("Modes", `Invalid mode registration from ${extName}`);
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
  if (ALL_MODES[modeKey]) {
    log.warn("Modes", `Mode "${modeKey}" already registered. ${extName} cannot override.`);
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
    } catch {
      // DB error: degrade to ID-only. The AI still knows where it is.
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
  const modePrompt = mode.buildSystemPrompt(ctx);

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
  } catch {
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
  for (const [key, mode] of Object.entries(ALL_MODES)) {
    if (key.startsWith(bigMode + ":")) {
      for (const t of mode.toolNames) names.add(t);
    }
  }
  // Add extension-injected tools across all modes of this bigMode
  for (const [key] of Object.entries(ALL_MODES)) {
    if (key.startsWith(bigMode + ":")) {
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
