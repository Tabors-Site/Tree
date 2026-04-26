// Branch swarm runner.
//
// Parallel inquiry as a primitive. When a mode emits a structured
// `[[BRANCHES]]...[[/BRANCHES]]` block, swarm parses it, creates a child
// node per branch under the project root, and dispatches each branch as
// its own sequence of chat turns in whatever mode the architect names
// (or the caller's default).
//
// Status is tracked in metadata.swarm on each swarm-aware node. Domain
// extensions (code-workspace, research-workspace, etc.) subscribe to
// swarm's lifecycle hooks to run their own validators / write their own
// artifacts / format their own enrichContext. Swarm owns the mechanism
// only; policy lives in the subscribers.
//
// Branch block format (whitespace-tolerant):
//
//   [[BRANCHES]]
//   branch: backend
//     spec: Node.js + Express server with auth, swipe, match endpoints.
//     mode: tree:code-plan     # optional; defaults resolved from position
//     slot: code-plan          # optional; LLM slot hint
//     path: backend
//     files: package.json, server.js, auth.js, db.js
//
//   branch: frontend
//     spec: HTML/CSS/JS frontend with login, swipe deck, chat pane.
//     path: frontend
//   [[/BRANCHES]]
//
// Each branch becomes a child node of the project root (named after
// `branch:`). The runner walks the queue, calling the caller-supplied
// runBranch(...) callback at the branch's position with the spec as the
// initial message.

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { v4 as uuidv4 } from "uuid";
import { startChainStep, finalizeChat, setChatContext, getChatContext } from "../../seed/llm/chatTracker.js";
import { appendSignal } from "./state/signalInbox.js";
import { readMeta, mutateMeta, initProjectRole, initBranchRole } from "./state/meta.js";
import { plan, setBranchStatus } from "./state/planAccess.js";
import { promoteDoneAncestors } from "./project.js";
import { reconcileProject } from "./reconcile.js";
import { SWARM_WS_EVENTS } from "./wsEvents.js";

// Accept one or two square brackets on the markers. Small local models
// drop a bracket sometimes ([BRANCHES] instead of [[BRANCHES]]); the
// architect's intent is unambiguous either way, so don't reject the
// whole swarm dispatch over a bracket count.
const BRANCHES_OPEN = /\[\[?\s*branches\s*\]?\]/i;
const BRANCHES_CLOSE_TIGHT = /\[\[?\s*\]?\s*\/\s*branches\s*\]?\]/i;
const BRANCHES_CLOSE_LOOSE = /\[\[?[^\[\]]*(\/|end)[^\[\]]*branches[^\[\]]*\]?\]/i;
const CONTRACTS_OPEN = /\[\[?\s*contracts\s*\]?\]/i;
const CONTRACTS_CLOSE_TIGHT = /\[\[?\s*\]?\s*\/\s*contracts\s*\]?\]/i;
const CONTRACTS_CLOSE_LOOSE = /\[\[?[^\[\]]*(\/|end)[^\[\]]*contracts[^\[\]]*\]?\]/i;

/**
 * Fire a custom swarm lifecycle hook. Handlers registered by domain
 * extensions receive the payload. Errors in handlers are logged but
 * never stop swarm. Returns the payload (handlers may mutate fields
 * like `results` to signal retry needs).
 */
async function fireHook(_core, name, payload) {
  // Always go through the kernel's singleton hook registry. Earlier
  // callers passed a stub `core` (e.g. dispatch.js's
  // { metadata: { setExtMeta } } shim for atomic writes) that had no
  // hooks accessor, and the legacy "prefer core.hooks, fall back to
  // kernel" dance silently no-op'd every swarm lifecycle hook. The
  // _core arg is still accepted for call-site compatibility but the
  // hook registry is a process-wide singleton anyway.
  const { hooks } = await import("../../seed/hooks.js");
  await hooks.fire(name, payload);
  return payload;
}

/**
 * Mirror a branch status transition onto the current AI forensics
 * capture (if treeos-base is loaded). Fire-and-forget.
 */
async function recordBranchEvent({ visitorId, branchName, from, to, reason }) {
  if (!branchName || !to) return;
  try {
    const { getExtension } = await import("../loader.js");
    const tb = getExtension("treeos-base")?.exports;
    if (!tb?.recordBranchEvent) return;
    const chatCtx = getChatContext(visitorId) || {};
    if (!chatCtx.chatId) return;
    tb.recordBranchEvent({
      chatId: chatCtx.chatId,
      branchName,
      from: from || null,
      to,
      reason: reason || null,
    });
  } catch {}
}

/**
 * Parse a [[BRANCHES]] block out of a response. Returns { branches,
 * cleaned }. Closing-tag detection is multi-stage because models emit
 * malformed variants (`[[]/BRANCHES]]`, `[[end branches]]`, etc.).
 */
export function parseBranches(responseText) {
  if (typeof responseText !== "string" || !responseText) {
    return { branches: [], cleaned: responseText };
  }
  const openMatch = responseText.match(BRANCHES_OPEN);
  if (!openMatch) return { branches: [], cleaned: responseText };

  const openEnd = openMatch.index + openMatch[0].length;
  const rest = responseText.slice(openEnd);

  let closeMatch = rest.match(BRANCHES_CLOSE_TIGHT);
  let closeIdxInRest = closeMatch?.index;
  let closeLength = closeMatch?.[0]?.length || 0;

  if (closeIdxInRest == null) {
    closeMatch = rest.match(BRANCHES_CLOSE_LOOSE);
    closeIdxInRest = closeMatch?.index;
    closeLength = closeMatch?.[0]?.length || 0;
  }

  if (closeIdxInRest == null) {
    const lines = rest.split("\n");
    let lastBracketLineIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\s*\[\[/.test(lines[i])) {
        lastBracketLineIdx = i;
        break;
      }
    }
    if (lastBracketLineIdx > 0) {
      const upToThatLine = lines.slice(0, lastBracketLineIdx).join("\n");
      closeIdxInRest = upToThatLine.length + 1;
      closeLength = (lines[lastBracketLineIdx] || "").length;
    }
  }

  if (closeIdxInRest == null) {
    // Unclosed block with branch: lines — small-model failure mode.
    // Consume to EOF if we can prove the body contains at least one
    // branch declaration. Empty-branch hallucinations stay rejected.
    if (/^-?\s*branch\s*:/im.test(rest)) {
      closeIdxInRest = rest.length;
      closeLength = 0;
    } else {
      return { branches: [], cleaned: responseText };
    }
  }

  const body = rest.slice(0, closeIdxInRest);
  const branches = [];
  let current = null;

  const lines = body.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const branchMatch = line.match(/^-?\s*branch\s*:\s*(.+)$/i);
    if (branchMatch) {
      if (current) branches.push(current);
      current = {
        name: branchMatch[1].trim(),
        spec: "",
        slot: null,
        mode: null,
        path: null,
        files: [],
      };
      continue;
    }

    if (!current) continue;

    const kv = line.match(/^(spec|slot|mode|path|files|depends|requires)\s*:\s*(.+)$/i);
    if (kv) {
      const key = kv[1].toLowerCase();
      const value = kv[2].trim();
      if (key === "spec") current.spec = value;
      else if (key === "slot") current.slot = value;
      else if (key === "mode") current.mode = value;
      else if (key === "path") current.path = value;
      else if (key === "files") {
        current.files = value.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (key === "depends" || key === "requires") {
        current.depends = value.split(",").map((s) => s.trim()).filter(Boolean);
      }
      continue;
    }

    if (current && !line.match(/^[a-z]+\s*:/i)) {
      current.spec = current.spec ? current.spec + " " + line : line;
    }
  }
  if (current) branches.push(current);

  const openStart = openMatch.index;
  const closeEnd = openEnd + closeIdxInRest + closeLength;
  const cleaned = (responseText.slice(0, openStart) + responseText.slice(closeEnd)).trimEnd();
  return { branches: branches.filter((b) => b.name && b.spec), cleaned };
}

/**
 * Parse a [[CONTRACTS]] block. Contracts declare invariants every branch
 * must respect. Swarm stores the parsed shape as { kind, name, fields,
 * raw } but doesn't interpret them — domain extensions render / validate
 * them however they like.
 */
export function parseContracts(responseText) {
  if (typeof responseText !== "string" || !responseText) {
    return { contracts: [], cleaned: responseText };
  }
  const openMatch = responseText.match(CONTRACTS_OPEN);
  if (!openMatch) return { contracts: [], cleaned: responseText };

  const openEnd = openMatch.index + openMatch[0].length;
  const rest = responseText.slice(openEnd);

  let closeMatch = rest.match(CONTRACTS_CLOSE_TIGHT);
  let closeIdxInRest = closeMatch?.index;
  let closeLength = closeMatch?.[0]?.length || 0;

  if (closeIdxInRest == null) {
    closeMatch = rest.match(CONTRACTS_CLOSE_LOOSE);
    closeIdxInRest = closeMatch?.index;
    closeLength = closeMatch?.[0]?.length || 0;
  }

  if (closeIdxInRest == null) {
    const lines = rest.split("\n");
    let lastBracketLineIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\s*\[\[/.test(lines[i])) {
        lastBracketLineIdx = i;
        break;
      }
    }
    if (lastBracketLineIdx > 0) {
      const upToThatLine = lines.slice(0, lastBracketLineIdx).join("\n");
      closeIdxInRest = upToThatLine.length + 1;
      closeLength = (lines[lastBracketLineIdx] || "").length;
    }
  }

  if (closeIdxInRest == null) {
    // Unclosed block — consume to EOF if the body has any
    // recognizable `<kind> <name>: {...}` or `<kind>: {...}` entry.
    // (Was message|type only; now accepts any kind so book/research/
    // curriculum contracts survive — character, setting, voice, theme,
    // chapter, etc.)
    if (/^\s*[a-zA-Z][\w-]*(\s+[A-Za-z_][\w-]*)?\s*:\s*[\{"]/m.test(rest)) {
      closeIdxInRest = rest.length;
      closeLength = 0;
    } else {
      return { contracts: [], cleaned: responseText };
    }
  }

  const body = rest.slice(0, closeIdxInRest);
  const contracts = [];

  const lines = body.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("//")) continue;
    if (line.startsWith("[[")) continue;
    // Domain-neutral contract parsing. Accept BOTH shapes:
    //   "character Tabor: { pronouns: 'he/him', ... }"     → named entry
    //   "setting: { timelineSpan: '...' }"                 → unnamed entry
    //   "message join: { roomId, playerName }"             → code-style named
    // The kind is any word; the name is the second word if present.
    let kind, name, rhs;
    const namedMatch = line.match(/^([a-zA-Z][a-zA-Z-]*)\s+([A-Za-z_][\w-]*)\s*:\s*(.+)$/);
    const unnamedMatch = !namedMatch && line.match(/^([a-zA-Z][a-zA-Z-]*)\s*:\s*(.+)$/);
    if (namedMatch) {
      kind = namedMatch[1].toLowerCase();
      name = namedMatch[2];
      rhs = namedMatch[3].trim();
    } else if (unnamedMatch) {
      kind = unnamedMatch[1].toLowerCase();
      name = kind; // unnamed entries use kind as name (setting/voice/theme pattern)
      rhs = unnamedMatch[2].trim();
    } else {
      continue;
    }

    const fields = new Set();
    const values = {}; // key -> raw value string; preserves data the scout can use
    const braceIdx = rhs.indexOf("{");
    if (braceIdx !== -1) {
      let depth = 0;
      let closeIdx = -1;
      for (let i = braceIdx; i < rhs.length; i++) {
        if (rhs[i] === "{") depth++;
        else if (rhs[i] === "}") {
          depth--;
          if (depth === 0) { closeIdx = i; break; }
        }
      }
      if (closeIdx !== -1) {
        const inner = rhs.slice(braceIdx + 1, closeIdx);
        const parts = splitTopLevelCommas(inner);
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          const colonIdx = findTopLevelColon(trimmed);
          const nameStr = colonIdx !== -1 ? trimmed.slice(0, colonIdx).trim() : trimmed;
          const clean = nameStr.replace(/\?$/, "").trim();
          if (/^['"]?[A-Za-z_$][\w$-]*['"]?$/.test(clean)) {
            const fieldName = clean.replace(/^['"]|['"]$/g, "");
            fields.add(fieldName);
            // Also preserve the VALUE so downstream consumers (book
            // scout's pronoun detector, form repopulation, etc.) can
            // read "he/him" not just "pronouns". Strip quotes on the
            // value side the same way.
            if (colonIdx !== -1) {
              const rawVal = trimmed.slice(colonIdx + 1).trim().replace(/,\s*$/, "");
              const cleanVal = rawVal.replace(/^['"]|['"]$/g, "").trim();
              if (cleanVal) values[fieldName] = cleanVal;
            }
          }
        }
      }
    }

    fields.delete("type");
    // Lift common scout-accessible fields to the top-level entry so
    // the book-workspace pronoun scout and form repopulation can read
    // them without re-parsing. Pronouns is the critical one.
    const entry = { kind, name, fields: [...fields], values, raw: line };
    if (values.pronouns) entry.pronouns = values.pronouns;
    // Scope distribution: contracts can be tagged with which branches
    // are concerned. Architect emits one of:
    //   scope: global
    //   scope: shared:[branch-a,branch-b]
    //   scope: local:branch-name
    // Default when omitted: "global" (safe — every branch sees it).
    // Pass 1's distribution layer filters this slice per branch.
    const rawScope = String(values.scope || "global").trim();
    entry.scope = parseScope(rawScope);
    // Stable ID for this contract within its plan. Used by Pass 2's
    // courts to address the contract directly. Defaults to
    // `${kind}:${name}` when not explicitly provided.
    entry.id = String(values.id || `${kind}:${name}`);
    // Namespace mirrors `kind` for now — the architect's `kind` field
    // IS the namespace under the new taxonomy. Kept as a separate
    // field so future code can rely on `entry.namespace` without
    // having to know that `kind === namespace` is a Pass 1 invariant.
    entry.namespace = kind;
    contracts.push(entry);
  }

  const openStart = openMatch.index;
  const closeEnd = openEnd + closeIdxInRest + closeLength;
  const cleaned = (responseText.slice(0, openStart) + responseText.slice(closeEnd)).trimEnd();
  return { contracts, cleaned };
}

/**
 * Parse a scope string from a contract's `scope` field into the
 * canonical structured form:
 *
 *   "global"                    → "global"
 *   "shared:[a,b,c]"            → { shared: ["a", "b", "c"] }
 *   "shared:a,b,c"              → { shared: ["a", "b", "c"] }
 *   "local:branch"              → { local: "branch" }
 *   "local:[branch]"            → { local: "branch" }
 *
 * Anything unrecognized → "global" (safe default; the architect can
 * narrow scope but never accidentally over-narrow). Tolerant of
 * spaces, brackets, and quotes around branch names.
 */
function parseScope(input) {
  if (input == null) return "global";
  if (typeof input === "object") {
    // Already structured (came in pre-parsed).
    if (input.shared && Array.isArray(input.shared)) return { shared: input.shared.map((s) => String(s).trim()).filter(Boolean) };
    if (input.local) return { local: String(input.local).trim() };
    return "global";
  }
  const s = String(input).trim().replace(/^['"]|['"]$/g, "");
  if (!s || /^global$/i.test(s)) return "global";
  const sharedMatch = s.match(/^shared\s*:\s*\[?\s*(.*?)\s*\]?$/i);
  if (sharedMatch) {
    const list = sharedMatch[1]
      .split(",")
      .map((b) => b.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
    return list.length > 0 ? { shared: list } : "global";
  }
  const localMatch = s.match(/^local\s*:\s*\[?\s*(.+?)\s*\]?$/i);
  if (localMatch) {
    const name = localMatch[1].trim().replace(/^['"]|['"]$/g, "");
    return name ? { local: name } : "global";
  }
  return "global";
}

function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let quote = null;     // active quote char ('|"|`) or null when not in a string
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    // Quote tracking — commas/colons inside strings must NOT split.
    // The architect frequently emits values like
    //   exports: 'start(), stop(), onScore(handler)'
    // and the comma-split would otherwise truncate to "start()".
    if (quote) {
      if (ch === "\\" && i + 1 < s.length) { buf += ch + s[++i]; continue; }
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; buf += ch; continue; }
    if (ch === "{" || ch === "[" || ch === "<" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ">" || ch === ")") depth--;
    else if (ch === "," && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

function findTopLevelColon(s) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\" && i + 1 < s.length) { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{" || ch === "[" || ch === "<" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ">" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

/**
 * Validate a parsed [[BRANCHES]] list against the seam rules every
 * compound-task architect output must respect. Returns an array of
 * error strings — empty array means valid.
 *
 * Rules:
 *   1. Every branch MUST declare a path.
 *   2. No two branches may share a path.
 *   3. No branch path may equal the project's own name.
 *   4. Branch name must match its path (case-insensitive).
 */
export function validateBranches(branches, projectName) {
  const errors = [];
  if (!Array.isArray(branches) || branches.length === 0) return { errors };

  const normalize = (s) => String(s || "").trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  const normProject = normalize(projectName);

  const seenPaths = new Map();
  for (const b of branches) {
    const pathRaw = b.path || "";
    const pathNorm = normalize(pathRaw);

    if (!pathNorm) {
      errors.push(`Branch "${b.name}" has no path. Every branch must declare a path field naming its subdirectory (e.g. path: backend).`);
      continue;
    }

    if (normProject && pathNorm === normProject) {
      errors.push(
        `Branch "${b.name}" has path "${pathRaw}" which is the project's own name. ` +
        `Use a subdirectory name that describes the LAYER, not the project name.`
      );
      continue;
    }

    if (seenPaths.has(pathNorm)) {
      errors.push(
        `Branch "${b.name}" has path "${pathRaw}" which is already used by branch ` +
        `"${seenPaths.get(pathNorm)}". Each branch must have a unique path.`
      );
      continue;
    }

    // Integration / shell branch: path "." means "project root". The
    // architect uses this for the one branch that owns the top-level
    // entry file (index.html, main.py, etc.) and wires siblings
    // together. At most one such branch per swarm. Name doesn't have
    // to match path for this special case.
    const isShell = pathNorm === "." || pathRaw === ".";
    if (isShell) {
      const existingShell = [...seenPaths.entries()].find(([p]) => p === "." || p === "");
      if (existingShell) {
        errors.push(
          `Branch "${b.name}" has path "." but branch "${existingShell[1]}" already owns the project root. ` +
          `Only one branch can have path "." (the integration/shell branch that wires siblings together).`
        );
        continue;
      }
      seenPaths.set(".", b.name);
      continue;
    }

    const nameNorm = normalize(b.name);
    if (nameNorm && nameNorm !== pathNorm) {
      errors.push(
        `Branch "${b.name}" has path "${pathRaw}" which does not match its name. ` +
        `Set path equal to name (rename the branch or change its path), or use path: "." ` +
        `if this is the integration branch that owns the project root.`
      );
      continue;
    }

    seenPaths.set(pathNorm, b.name);
  }

  return { errors };
}

/**
 * BFS the project subtree for a branch-role node by name. Used to find
 * the parent node for nested sub-branches whose parent isn't a direct
 * child of the project root.
 */
async function resolveBranchParentId({ rootProjectId, parentBranchName, hint }) {
  if (!parentBranchName) return rootProjectId;
  if (hint) return hint;

  const visited = new Set([String(rootProjectId)]);
  const queue = [String(rootProjectId)];
  let scanned = 0;
  while (queue.length > 0 && scanned < 200) {
    const currentId = queue.shift();
    scanned++;
    const node = await Node.findById(currentId).select("_id children").lean();
    if (!node?.children?.length) continue;
    const kids = await Node.find({ _id: { $in: node.children } })
      .select("_id name metadata").lean();
    for (const kid of kids) {
      const kidIdStr = String(kid._id);
      if (visited.has(kidIdStr)) continue;
      visited.add(kidIdStr);
      const data = readMeta(kid);
      if (data?.role === "branch" && kid.name === parentBranchName) {
        return kidIdStr;
      }
      queue.push(kidIdStr);
    }
  }
  return rootProjectId;
}

/**
 * Ensure a child node exists under the branch parent for this branch.
 * Reuses an existing node by name if present. Stamps metadata.swarm
 * with role=branch + the branch spec / path / files. Enables cascade
 * so writes inside the branch fire kernel propagation.
 */
async function ensureBranchNode({ rootProjectId, branch, userId, core }) {
  const parent = await Node.findById(rootProjectId).select("_id children");
  if (!parent) throw new Error(`Swarm: parent node ${rootProjectId} not found`);

  let branchNode = null;
  if (Array.isArray(parent.children) && parent.children.length > 0) {
    branchNode = await Node.findOne({
      _id: { $in: parent.children },
      name: branch.name,
    });
  }

  if (!branchNode) {
    if (core?.tree?.createNode) {
      branchNode = await core.tree.createNode({
        parentId: parent._id,
        name: branch.name,
        type: "branch",
        userId,
      });
    } else {
      branchNode = await Node.create({
        _id: uuidv4(),
        name: branch.name,
        type: "branch",
        parent: parent._id,
        status: "active",
      });
      await Node.updateOne({ _id: parent._id }, { $addToSet: { children: branchNode._id } });
    }
  }

  // Swarm-owned execution bookkeeping for the branch (role, parentage,
  // spec/path/files for prompt rendering, aggregatedDetail, inbox).
  // The plan namespace at this branch is independent and gets created
  // lazily when the branch's own decomposition writes to it.
  await initBranchRole({
    nodeId: branchNode._id,
    name: branch.name,
    spec: branch.spec,
    path: branch.path || null,
    files: branch.files || [],
    slot: branch.slot || null,
    mode: branch.mode || null,
    parentProjectId: String(rootProjectId),
    parentBranch: branch.parentBranch || null,
    core,
  });

  // Enable cascade on branch nodes so file writes inside fire propagation.
  try {
    const cascadeData = {
      enabled: true,
      enabledAt: new Date().toISOString(),
      enabledBy: "swarm",
    };
    if (core?.metadata?.setExtMeta) {
      await core.metadata.setExtMeta(branchNode, "cascade", cascadeData);
    } else {
      await Node.updateOne(
        { _id: branchNode._id },
        { $set: { "metadata.cascade": cascadeData } },
      );
    }
  } catch (err) {
    log.warn("Swarm", `Failed to enable cascade on branch ${branch.name}: ${err.message}`);
  }

  return branchNode;
}

/**
 * Resolve the mode key a branch should run in. Priority:
 *   1. branch.mode (explicit in [[BRANCHES]] block)
 *   2. defaultBranchMode (caller-supplied fallback)
 *   3. Walk ancestors for the nearest extension's `-plan` mode via
 *      extensionScope.getModesOwnedBy (same resolution chain the kernel
 *      uses for tool/mode resolution).
 */
async function resolveBranchMode({ branch, defaultBranchMode, branchNodeId }) {
  if (branch.mode) return branch.mode;
  if (defaultBranchMode) return defaultBranchMode;

  try {
    const { getModeOwner, getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
    let cursor = String(branchNodeId || "");
    let guard = 0;
    while (cursor && guard < 64) {
      const node = await Node.findById(cursor).select("_id parent metadata").lean();
      if (!node) break;
      const md = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
      for (const [extName, extData] of Object.entries(md)) {
        if (!extData || typeof extData !== "object") continue;
        if (!extData.role && !extData.initialized) continue;
        const planModes = getModesOwnedBy(extName).filter((m) => m.endsWith("-plan"));
        if (planModes.length > 0) return planModes[0];
      }
      if (!node.parent) break;
      cursor = String(node.parent);
      guard++;
    }
  } catch (err) {
    log.debug("Swarm", `resolveBranchMode ancestor walk failed: ${err.message}`);
  }
  return null;
}

/**
 * Retry any failed branches from a first swarm pass. Each failed branch
 * gets ONE retry with an augmented message that includes the original
 * error. Other branches' files / writes are now in place, so the retry
 * benefits from enrichContext (signals, contracts, aggregated detail)
 * that the first attempt didn't have.
 *
 * Capped: each branch gets at most ONE retry. If retry also fails, the
 * branch stays marked failed.
 */
async function retryFailedBranches({
  results, branches, runBranch, rootProjectNode,
  sessionId, userId, username, visitorId, rootId,
  signal, slot, socket, onToolLoopCheckpoint, rootChatId,
  core, emitStatus, rt, defaultBranchMode,
}) {
  const failed = results.filter((r) => r.status === "failed" || r.status === "error");
  if (failed.length === 0) return { retried: 0 };

  log.info("Swarm", `🔁 Retry: ${failed.length} failed branch(es) get one more shot`);

  // Path B: plan steps live on the plan-type child of the project
  // scope. Resolve once for all retries in this batch.
  const p = await plan();
  const rootPlan = await p.ensurePlanAtScope(
    rootProjectNode._id,
    { userId },
    core,
  );
  const rootPlanNodeId = rootPlan ? String(rootPlan._id) : String(rootProjectNode._id);

  for (const prev of failed) {
    if (signal?.aborted) break;
    const branch = branches.find((b) => b.name === prev.name || b.name === prev.rawName);
    if (!branch) continue;

    emitStatus?.(socket, "intent", `Retry: ${branch.name}`);

    const branchNode = await Node.findOne({
      parent: rootProjectNode._id,
      name: branch.name,
    });
    if (!branchNode) continue;

    const branchMode = await resolveBranchMode({
      branch,
      defaultBranchMode,
      branchNodeId: branchNode._id,
    });
    if (!branchMode) {
      log.warn("Swarm", `Retry: no branch mode resolvable for "${branch.name}", skipping`);
      continue;
    }

    const retryHeaderInput = `[retry ${branch.name}] previous error: ${prev.error || "unknown"}`;
    let retryStep = null;
    if (rt && !rt._cleaned) {
      retryStep = await rt.beginChainStep(branchMode, retryHeaderInput, {
        treeContext: { targetNodeId: branchNode._id },
      });
    }

    const retryMessage =
      `You are retrying a branch that failed on the first pass.\n\n` +
      `Branch: ${branch.name}\n` +
      `Path: ${branch.path || "(project root)"}\n` +
      `Files expected: ${(branch.files || []).join(", ") || "(infer from spec)"}\n\n` +
      `Original spec:\n${branch.spec}\n\n` +
      `Previous error:\n${prev.error || "unknown"}\n\n` +
      `Sibling branches have likely made progress since the first attempt ` +
      `(their writes show up in enrichContext). Apply the fix now. Emit ` +
      `[[DONE]] when the branch is complete.`;

    try {
      const retryResult = await runBranch({
        mode: branchMode,
        message: retryMessage,
        branchNodeId: branchNode._id,
        slot: branch.slot || slot,
        visitorId, username, userId, rootId,
        signal, onToolLoopCheckpoint, socket,
      });

      const idx = results.findIndex((r) => r.name === branch.name || r.rawName === branch.name);
      if (idx >= 0) {
        results[idx] = {
          name: branch.name,
          status: "done",
          answer: (retryResult?.answer || "") + " (retried)",
        };
      }
      await setBranchStatus({ branchNodeId: branchNode._id, status: "done", summary: retryResult?.answer || null, core });
      await p.upsertBranchStep(
        rootPlanNodeId,
        {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: "done",
          summary: truncate(retryResult?.answer || "", 300),
          finishedAt: new Date().toISOString(),
          retries: 1,
        },
        core,
      );
      // Record the retry consumption on the plan's budget. Pass 3
      // reputation reads per-step consumption to weight signature
      // trust; tracking retries here ensures root and sub plans
      // accrue symmetric budget history.
      try {
        const rootPlanRead = await p.readPlan(rootPlanNodeId);
        const retryStep = (rootPlanRead?.steps || []).find(
          (s) => s.kind === "branch" && String(s.childNodeId || "") === String(branchNode._id),
        );
        if (retryStep?.id) {
          await p.recordBudgetConsumption(rootPlanNodeId, retryStep.id, { retries: 1 }, core);
        }
      } catch (budgetErr) {
        log.debug("Swarm", `recordBudgetConsumption (retry-success) skipped: ${budgetErr.message}`);
      }
      await recordBranchEvent({ visitorId, branchName: branch.name, from: "failed", to: "done", reason: "retry succeeded" });

      if (retryStep && rt && !rt._cleaned) {
        await rt.finishChainStep(retryStep.chatId, {
          output: `✓ ${branch.name} (retry): ${truncate(retryResult?.answer || "done", 200)}`,
          stopped: signal?.aborted || false,
          modeKey: branchMode,
        });
      }
    } catch (err) {
      log.error("Swarm", `Retry failed for "${branch.name}": ${err.message}`);
      const idx = results.findIndex((r) => r.name === branch.name || r.rawName === branch.name);
      if (idx >= 0) {
        results[idx] = {
          name: branch.name,
          status: "failed",
          error: err.message + " (also failed on retry)",
        };
      }
      await setBranchStatus({ branchNodeId: branchNode._id, status: "failed", error: err.message, core });
      await p.upsertBranchStep(
        rootPlanNodeId,
        {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: "failed",
          error: err.message + " (also failed on retry)",
          finishedAt: new Date().toISOString(),
          retries: 1,
        },
        core,
      );
      // Record the retry consumption even when retry fails — the
      // retry attempt consumed budget whether it succeeded or not.
      try {
        const rootPlanRead = await p.readPlan(rootPlanNodeId);
        const retryStep = (rootPlanRead?.steps || []).find(
          (s) => s.kind === "branch" && String(s.childNodeId || "") === String(branchNode._id),
        );
        if (retryStep?.id) {
          await p.recordBudgetConsumption(rootPlanNodeId, retryStep.id, { retries: 1 }, core);
        }
      } catch (budgetErr) {
        log.debug("Swarm", `recordBudgetConsumption (retry-fail) skipped: ${budgetErr.message}`);
      }
      await recordBranchEvent({ visitorId, branchName: branch.name, from: "failed", to: "failed", reason: `retry also failed: ${err.message}` });
      if (retryStep && rt && !rt._cleaned) {
        await rt.finishChainStep(retryStep.chatId, {
          output: `✗ ${branch.name} (retry): ${err.message}`,
          stopped: true,
          modeKey: branchMode,
        });
      }
    }
  }

  return { retried: failed.length };
}

/**
 * Scout loop: adaptive multi-cycle cross-branch verification phase that
 * runs AFTER all builder branches finish and the standard retry pass
 * concludes. Fires `swarm:runScouts` once per cycle; domain extensions
 * (code-workspace, book-workspace, etc.) subscribe to it and perform
 * their own read-only seam checks — LLM scouts, static analyzers,
 * contract comparisons. Whatever the handlers find gets appended to
 * branch signal inboxes and their result statuses flipped to "failed";
 * swarm detects the flip and re-dispatches only the affected branches.
 * Repeats until no new issues OR the cycle cap is hit.
 *
 * Adaptive policy:
 *   cycle 1: always (if ≥2 branches and at least one listener)
 *   cycle 2: only if cycle 1 found issues
 *   cycle 3: only if ≥5 branches AND cycle 2 still found issues
 *   max:     3 cycles hard-capped
 *   early:   zero issues at any cycle → done clean
 *   stuck:   identical issue signature to prior cycle → stop with "stuck"
 *
 * Handlers receive `scoutPayload.issueSummary` (array) and push
 * `{ branch, kind, detail }` entries for every finding. Swarm uses the
 * length of that array + the set of affected branches to decide
 * whether to re-dispatch, and to build the final reconciliation event.
 *
 * This function emits narration events to the provided socket so the
 * UI renders a distinct phase: "🔍 dispatching scouts... ⚠ scout·menu
 * found mismatch... 📬 routing 2 issues to 2 branches... 🔧
 * redeploying... ✓ swarm reconciled". If no listeners are registered
 * on `swarm:runScouts`, the whole phase is silent.
 */
async function runScoutLoop({
  rootProjectNode, results, branches, core, socket, signal,
  runBranch, sessionId, userId, username, visitorId, rootId,
  slot, onToolLoopCheckpoint, rootChatId, rt, defaultBranchMode,
}) {
  if (!Array.isArray(branches) || branches.length < 2) {
    return { cycles: 0, status: "skipped", totalIssues: 0 };
  }
  if (signal?.aborted) {
    return { cycles: 0, status: "aborted", totalIssues: 0 };
  }

  // No listener → no scouts. Check the kernel singleton so we see
  // every registered handler regardless of what `core` shape the
  // caller handed us (dispatch.js passes a stub without hooks).
  try {
    const { hooks } = await import("../../seed/hooks.js");
    const registered = hooks.list();
    if (!registered["swarm:runScouts"] || registered["swarm:runScouts"].length === 0) {
      return { cycles: 0, status: "no-listeners", totalIssues: 0 };
    }
  } catch {
    return { cycles: 0, status: "no-listeners", totalIssues: 0 };
  }

  const MAX_CYCLES = 3;
  let cycle = 0;
  let totalIssues = 0;
  let prevSignature = "";
  let exitStatus = "clean";

  while (cycle < MAX_CYCLES) {
    if (signal?.aborted) { exitStatus = "aborted"; break; }

    // Adaptive gate for cycle 3: only when the swarm is large enough
    // that a third pass is worth the extra wall time.
    if (cycle === 2 && branches.length < 5) { exitStatus = "capped"; break; }

    cycle++;

    socket?.emit?.(SWARM_WS_EVENTS.SCOUTS_DISPATCHED, {
      cycle,
      branchCount: results.filter((r) => r.status === "done").length,
      projectNodeId: String(rootProjectNode._id),
      projectName: rootProjectNode.name || null,
    });

    const statusesBefore = results.map((r) => `${r.name}:${r.status}`).join("|");
    const scoutPayload = {
      cycle,
      rootProjectNode,
      workspaceAnchorNode,
      results,
      branches,
      core,
      socket,
      visitorId,
      signal,
      // Handlers push { branch, kind, detail, targetBranch? } for every
      // finding. Swarm uses .length + affected branch set for routing.
      issueSummary: [],
    };

    try {
      await fireHook(core, "swarm:runScouts", scoutPayload);
    } catch (err) {
      log.warn("Swarm", `scout cycle ${cycle} hook error: ${err.message}`);
    }
    const statusesAfter = results.map((r) => `${r.name}:${r.status}`).join("|");

    const issuesThisCycle = Array.isArray(scoutPayload.issueSummary)
      ? scoutPayload.issueSummary.length : 0;
    const affected = [...new Set(
      (scoutPayload.issueSummary || []).map((i) => i?.branch).filter(Boolean),
    )];
    totalIssues += issuesThisCycle;

    socket?.emit?.(SWARM_WS_EVENTS.ISSUES_ROUTED, {
      cycle,
      total: issuesThisCycle,
      affectedBranches: affected,
      projectNodeId: String(rootProjectNode._id),
    });

    if (issuesThisCycle === 0) { exitStatus = "clean"; break; }

    // Stuck detection: same findings as last cycle → we're not making
    // progress, stop to avoid burning cycles on an unsolvable mismatch.
    const signatureArr = (scoutPayload.issueSummary || [])
      .map((i) => `${i?.branch || "?"}|${i?.kind || "?"}|${String(i?.detail || "").slice(0, 80)}`)
      .sort();
    const signature = signatureArr.join(";");
    if (cycle > 1 && signature === prevSignature) {
      exitStatus = "stuck";
      break;
    }
    prevSignature = signature;

    // Handlers flipped statuses → re-dispatch the affected branches.
    if (statusesAfter !== statusesBefore) {
      socket?.emit?.(SWARM_WS_EVENTS.REDEPLOYING, {
        cycle,
        branches: affected,
        projectNodeId: String(rootProjectNode._id),
      });
      await retryFailedBranches({
        results, branches, runBranch, rootProjectNode,
        sessionId, userId, username, visitorId, rootId,
        signal, slot, socket, onToolLoopCheckpoint, rootChatId,
        core, emitStatus: () => {}, rt, defaultBranchMode,
      });
    }
  }

  if (cycle >= MAX_CYCLES && exitStatus === "clean") exitStatus = "capped";

  socket?.emit?.(SWARM_WS_EVENTS.SWARM_RECONCILED, {
    cycles: cycle,
    status: exitStatus,
    totalIssues,
    projectNodeId: String(rootProjectNode._id),
    projectName: rootProjectNode.name || null,
  });

  return { cycles: cycle, status: exitStatus, totalIssues };
}

/**
 * Run a whole swarm. Walk branches sequentially, dispatch each at the
 * resolved mode at that branch's tree position, collect results, return
 * a summary. Each branch opens its own chainIndex chat records inside
 * the same session so the dashboard groups the swarm under one
 * conversation.
 *
 * The `runBranch` callback is injected by the caller so this module
 * doesn't depend on any orchestrator. It's a closure that dispatches
 * one branch as a stepped mode run and returns the final result.
 *
 * Fires hooks:
 *   swarm:beforeBranchRun       — before each branch dispatch
 *   swarm:afterBranchComplete   — after each branch terminates
 *   swarm:afterAllBranchesComplete — once, after the final retry pass
 *   swarm:branchRetryNeeded     — when a handler flips results to fail
 *
 * Handlers on afterAllBranchesComplete may mutate results[].status to
 * "failed" and append to signal inboxes. Swarm detects the status flip
 * and re-runs retryFailedBranches to give those branches a fresh shot.
 */
export async function runBranchSwarm({
  branches, rootProjectNode, rootChatId, architectChatId, sessionId,
  visitorId, userId, username, rootId, signal, slot, socket,
  onToolLoopCheckpoint, core, runBranch, emitStatus, userRequest,
  rt, resumeMode = false, defaultBranchMode = null,
  // workspaceAnchorNode: the node whose content-workspace (the
  // filesystem directory that holds files) is the root for file I/O
  // during this swarm run. Distinct from rootProjectNode, which is
  // the PLAN ANCHOR (where metadata.plan and the signal inbox live).
  // They converge at top-level project runs (anchor === rootProject)
  // but diverge for sub-plans (plan anchor = sub-plan scope; workspace
  // anchor = outer project whose workspaceRoot dir holds files) and
  // for cross-cutting plans at LCAs (Pass 2+). Callers that don't
  // specify it inherit resolveWorkspaceRoot(rootProjectNode._id) —
  // walk-up from the plan anchor to the nearest ancestor with a
  // workspace. Pass explicitly when plan anchor and workspace anchor
  // must differ (e.g. Pass 4+ user-context-driven anchors).
  workspaceAnchorNode = null,
}) {
  if (!Array.isArray(branches) || branches.length === 0) {
    return { success: true, summary: "No branches to run." };
  }
  if (!rootProjectNode) {
    throw new Error("runBranchSwarm requires rootProjectNode");
  }

  log.info("Swarm",
    `🌿 ${resumeMode ? "Resuming" : "Dispatching"} ${branches.length} branches under ${rootProjectNode.name || rootProjectNode._id}`,
  );

  // Announce the fanout to live consumers (CLI, web) so they can render
  // the fork UI before individual branches start firing. Labels let the
  // renderer show the list up front: `⎇ swarm: 3 branches [backend,
  // frontend, tests]`. Emission is safe when socket is absent.
  socket?.emit?.(WS.SWARM_DISPATCH, {
    resume: !!resumeMode,
    count: branches.length,
    branches: branches.map((b) => ({
      name: b.name,
      parentBranch: b.parentBranch || null,
      path: b.path || null,
      mode: b.mode || null,
    })),
    projectNodeId: String(rootProjectNode._id),
  });

  // Tree-authoritative reconciliation. User edits to the tree (inserted
  // branches, renamed, deleted, rewrote specs) get absorbed into subPlan
  // before we read it. The tree is ground truth; subPlan is a cache.
  await reconcileProject({ projectNodeId: rootProjectNode._id, core });

  // Path B: plans live on plan-type child nodes of the scope they
  // coordinate. Resolve the root plan once (find-or-create) and cache
  // it; every downstream write for this swarm run uses the cached id.
  // Nested scopes (sub-plans created by nested [[BRANCHES]] emissions)
  // populate the cache lazily via planAtScope().
  const p = await plan();
  const planAtScopeCache = new Map(); // scopeId → planNodeId
  const planAtScope = async (scopeId) => {
    if (!scopeId) return null;
    const key = String(scopeId);
    if (planAtScopeCache.has(key)) return planAtScopeCache.get(key);
    const planNode = await p.ensurePlanAtScope(
      scopeId,
      { userId, systemSpec: userRequest },
      core,
    );
    const planNodeId = planNode ? String(planNode._id) : null;
    if (planNodeId) planAtScopeCache.set(key, planNodeId);
    return planNodeId;
  };

  const rootPlanNodeId = await planAtScope(rootProjectNode._id);

  // Stamp the plan's dispatch event on its ledger. Symmetric with the
  // sub-plan-dispatched / sub-plan-completed / sub-plan-archived
  // entries stamped by dispatchApprovedSubPlan — plans at ANY scope
  // log their lifecycle uniformly so Pass 3's reputation aggregation
  // sees root plans and sub-plans with the same data shape. A stamp
  // fires on every dispatch (initial AND resume) so the ledger shows
  // full session history.
  try {
    if (rootPlanNodeId && p.appendLedger) {
      await p.appendLedger(rootPlanNodeId, {
        event: resumeMode ? "plan-resumed" : "plan-dispatched",
        detail: {
          scopeNodeId: String(rootProjectNode._id),
          scopeName: rootProjectNode.name || null,
          branchCount: branches.length,
          branchNames: branches.map((b) => b.name),
          resume: !!resumeMode,
        },
      }, core);
    }
  } catch (ledgerErr) {
    log.debug("Swarm", `plan-dispatched ledger skipped: ${ledgerErr.message}`);
  }

  if (!resumeMode) {
    // Mark the project (swarm role + execution bookkeeping on the scope
    // node itself — signal inbox, aggregatedDetail, role, parentage).
    // Plan steps live on rootPlanNodeId, not on the scope node.
    await initProjectRole({
      nodeId: rootProjectNode._id,
      systemSpec: userRequest,
      core,
    });
    await p.initPlan(rootPlanNodeId, { systemSpec: userRequest }, core);

    for (const b of branches) {
      await p.upsertBranchStep(
        rootPlanNodeId,
        {
          name: b.name,
          spec: b.spec,
          path: b.path || null,
          files: b.files || [],
          slot: b.slot || null,
          mode: b.mode || null,
          status: "pending",
        },
        core,
      );
      await recordBranchEvent({ visitorId, branchName: b.name, from: null, to: "pending", reason: "queued" });
    }
  }

  const results = [];
  let fallbackChainIdx = 1;

  const beginBranchHeader = async ({ input, branchNodeId, modeKey }) => {
    // Dispatch marker's parent is the architect chat (the LLM call that
    // emitted [[BRANCHES]]). This makes the node-chats tree render
    // architect → [dispatch marker backend → worker turns, dispatch
    // marker frontend → worker turns, ...] instead of a flat sibling
    // list.
    const markerParent = architectChatId || rootChatId || null;
    if (rt && !rt._cleaned) {
      return rt.beginChainStep(modeKey, input, {
        treeContext: branchNodeId ? { targetNodeId: branchNodeId } : undefined,
        parentChatId: markerParent,
        dispatchOrigin: "branch-swarm",
      });
    }
    const chat = await startChainStep({
      userId, sessionId,
      chainIndex: fallbackChainIdx++,
      rootChatId: rootChatId || null,
      parentChatId: markerParent,
      modeKey,
      source: "swarm-branch",
      dispatchOrigin: "branch-swarm",
      input,
      treeContext: branchNodeId ? { targetNodeId: branchNodeId } : undefined,
    });
    if (!chat) return null;
    return { chatId: chat._id, chainIndex: chat.chainIndex };
  };

  const finishBranchHeader = async (step, { output, stopped = false, modeKey }) => {
    if (!step?.chatId) return;
    if (rt && !rt._cleaned) {
      await rt.finishChainStep(step.chatId, { output, stopped, modeKey });
    } else {
      await finalizeChat({ chatId: step.chatId, content: output, stopped, modeKey }).catch(() => {});
    }
  };

  const queue = branches.map((b) => ({
    ...b,
    parentBranch: b.parentBranch ?? null,
    depth: b.depth ?? 0,
  }));
  let processed = 0;
  const MAX_BRANCHES = 60;
  const MAX_DEPTH = 4;

  while (queue.length > 0 && processed < MAX_BRANCHES) {
    if (signal?.aborted) {
      log.warn("Swarm",
        `🛑 Aborted after ${processed} branches (${queue.length} still queued). Queued branches stay "pending"; next message at this project can resume them.`,
      );
      for (const q of queue) {
        const treeScope = await resolveBranchParentId({
          rootProjectId: rootProjectNode._id,
          parentBranchName: q.parentBranch,
          hint: q.parentNodeId,
        });
        const planIdForScope = await planAtScope(treeScope);
        await p.upsertBranchStep(
          planIdForScope,
          {
            name: q.name,
            status: "pending",
            pausedAt: new Date().toISOString(),
            abortReason: "parent session aborted",
          },
          core,
        );
        await recordBranchEvent({ visitorId, branchName: q.name, from: "pending", to: "pending", reason: "parent session aborted" });
      }
      break;
    }

    const branch = queue.shift();
    processed++;
    const totalKnown = processed + queue.length;
    const depthPrefix = branch.parentBranch ? `${branch.parentBranch}/` : "";
    const qualifiedName = depthPrefix + branch.name;

    emitStatus?.(socket, "intent", `Branch ${processed}/${totalKnown}: ${qualifiedName}`);
    socket?.emit?.(WS.BRANCH_STARTED, {
      name: qualifiedName,
      rawName: branch.name,
      parentBranch: branch.parentBranch || null,
      index: processed,
      total: totalKnown,
      mode: branch.mode || null,
      path: branch.path || null,
    });

    let branchNode;
    try {
      const parentId = await resolveBranchParentId({
        rootProjectId: rootProjectNode._id,
        parentBranchName: branch.parentBranch,
        hint: branch.parentNodeId,
      });
      branchNode = await ensureBranchNode({ rootProjectId: parentId, branch, userId, core });
    } catch (err) {
      log.error("Swarm", `Failed to create branch "${qualifiedName}": ${err.message}`);
      results.push({ name: qualifiedName, status: "error", error: err.message, parentBranch: branch.parentBranch });
      continue;
    }

    const branchMode = await resolveBranchMode({
      branch, defaultBranchMode, branchNodeId: branchNode._id,
    });
    if (!branchMode) {
      const err = `No branch mode resolvable for "${qualifiedName}". Declare mode: in the [[BRANCHES]] block, pass defaultBranchMode, or position the project under an extension with a -plan mode.`;
      log.error("Swarm", err);
      results.push({ name: qualifiedName, status: "error", error: err, parentBranch: branch.parentBranch });
      continue;
    }

    const treeScopeId = await resolveBranchParentId({
      rootProjectId: rootProjectNode._id,
      parentBranchName: branch.parentBranch,
      hint: branch.parentNodeId,
    });
    // Path B: resolve the plan-type child of the scope. Branch steps
    // are written to the plan node, not to the scope node itself.
    const planNodeForStep = await planAtScope(treeScopeId);

    await p.upsertBranchStep(
      planNodeForStep,
      {
        name: branch.name,
        nodeId: String(branchNode._id),
        spec: branch.spec,
        path: branch.path || null,
        files: branch.files || [],
        slot: branch.slot || null,
        mode: branchMode,
        status: "running",
        startedAt: new Date().toISOString(),
      },
      core,
    );
    await recordBranchEvent({ visitorId, branchName: branch.name, from: "pending", to: "running" });

    await fireHook(core, "swarm:beforeBranchRun", {
      branchNode, rootProjectNode, branch, branchMode,
    });

    const branchInput = `[${branch.parentBranch ? "sub-branch" : "branch"} ${processed}/${totalKnown}] ${qualifiedName}: ${branch.spec}`;
    const branchHeaderStep = await beginBranchHeader({
      input: branchInput, branchNodeId: branchNode?._id, modeKey: branchMode,
    });

    let branchResult;
    try {
      const branchMessage =
        `You are building ONE branch of a larger project.\n\n` +
        `Branch name: ${qualifiedName}\n` +
        `${branch.parentBranch ? `Parent branch: ${branch.parentBranch}\n` : ""}` +
        `Path: ${branch.path || "(project root)"}\n` +
        `Files expected: ${(branch.files || []).join(", ") || "(infer from spec)"}\n\n` +
        `Spec:\n${branch.spec}\n\n` +
        `Focus only on this branch. Do the work it needs. Do not touch ` +
        `other branches. Emit [[DONE]] when this branch is complete.` +
        `\n\nIf YOUR branch itself splits naturally into sub-components, ` +
        `you may emit a nested [[BRANCHES]]...[[/BRANCHES]] block instead ` +
        `of building directly. Each sub-branch becomes a child node and ` +
        `runs as its own session. ${branch.depth >= MAX_DEPTH - 1 ? "NOTE: near max recursion depth — do NOT spawn further sub-branches." : ""}`;

      const branchAbort = new AbortController();
      let parentAbortListener = null;
      if (signal) {
        if (signal.aborted) {
          branchAbort.abort();
        } else {
          parentAbortListener = () => branchAbort.abort();
          signal.addEventListener("abort", parentAbortListener, { once: true });
        }
      }
      try {
        branchResult = await runBranch({
          mode: branchMode,
          message: branchMessage,
          branchNodeId: branchNode._id,
          slot: branch.slot || slot,
          visitorId, username, userId, rootId,
          signal: branchAbort.signal,
          onToolLoopCheckpoint, socket,
          // Dispatch-marker chatId → worker-turn parent. Nests every
          // continuation of this branch under its own marker card so
          // the chats UI renders the dispatch tree correctly.
          markerChatId: branchHeaderStep?.chatId || null,
        });
      } finally {
        if (parentAbortListener && signal) {
          try { signal.removeEventListener("abort", parentAbortListener); } catch {}
        }
      }

      // Mark done provisionally. Hook subscribers can flip it to failed
      // by appending signals + mutating the result.
      await setBranchStatus({ branchNodeId: branchNode._id, status: "done", summary: branchResult?.answer || null, core });
      const resultEntry = {
        name: qualifiedName,
        rawName: branch.name,
        parentBranch: branch.parentBranch,
        status: "done",
        answer: branchResult?.answer || "",
      };
      results.push(resultEntry);
      await p.upsertBranchStep(
        planNodeForStep,
        {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: "done",
          summary: truncate(branchResult?.answer || "", 300),
          finishedAt: new Date().toISOString(),
        },
        core,
      );
      // Record budget consumption for the completed dispatch. Uses
      // turnsUsed from runSteppedMode when available; otherwise
      // attributes a minimum of 1 turn (every branch consumed at
      // least one LLM turn to emit its terminal marker). Symmetric
      // for root and sub plans — they both dispatch through this
      // code path — so Pass 3's reputation read sees uniform data.
      try {
        const turnsUsed = Number.isFinite(branchResult?.turnsUsed) && branchResult.turnsUsed > 0
          ? branchResult.turnsUsed
          : 1;
        const planRead = await p.readPlan(planNodeForStep);
        const completedStep = (planRead?.steps || []).find(
          (s) => s.kind === "branch" && String(s.childNodeId || "") === String(branchNode._id),
        );
        if (completedStep?.id) {
          await p.recordBudgetConsumption(planNodeForStep, completedStep.id, { turns: turnsUsed }, core);
        }
      } catch (budgetErr) {
        log.debug("Swarm", `recordBudgetConsumption (dispatch) skipped: ${budgetErr.message}`);
      }
      await recordBranchEvent({ visitorId, branchName: branch.name, from: "running", to: "done" });

      // Fire per-branch hook. Handlers (e.g., code-workspace) run
      // their own validators (syntax sweep, smoke, dead-receiver
      // scan). If a handler finds a problem, it can mutate
      // resultEntry.status = "failed" and/or append signals. Swarm
      // checks the status after.
      const branchCompletePayload = {
        branchNode, rootProjectNode, workspaceAnchorNode, branch,
        result: resultEntry,
        branchMode,
      };
      await fireHook(core, "swarm:afterBranchComplete", branchCompletePayload);
      // Declarative validators (Pass 1 strengthening). Run AFTER the
      // kernel hooks so existing hook-based validators keep their
      // current effective order, and the new registry is purely
      // additive. New validators (notably Pass 2's court system) opt
      // in via swarm.registerValidator and get explicit phase + order
      // semantics. See state/validators.js.
      try {
        const { runValidators } = await import("./state/validators.js");
        await runValidators("branch-complete", branchCompletePayload);
      } catch (vErr) {
        log.debug("Swarm", `branch-complete validators skipped: ${vErr.message}`);
      }

      if (resultEntry.status !== "done") {
        // Handler flipped it. Reflect in metadata + subPlan + event log.
        await setBranchStatus({
          branchNodeId: branchNode._id,
          status: resultEntry.status,
          error: resultEntry.error || null,
          summary: null, core,
        });
        await p.upsertBranchStep(
          planNodeForStep,
          {
            name: branch.name,
            nodeId: String(branchNode._id),
            status: resultEntry.status,
            error: resultEntry.error || null,
            finishedAt: new Date().toISOString(),
          },
          core,
        );
        await recordBranchEvent({
          visitorId, branchName: branch.name,
          from: "done", to: resultEntry.status,
          reason: resultEntry.error || "handler override",
        });
        continue;
      }

      // Nested-branch decomposition (Pass 1 — model-first rewire).
      //
      // A worker emits [[BRANCHES]] inside its response. Instead of
      // bouncing the emission back to the root architect for a whole-
      // project replan, we land it LOCALLY: create a plan-type node as
      // a child of the worker's own node, populate its steps with the
      // proposed sub-branches in pending-approval state, and emit
      // SUB_PLAN_PROPOSED so the user approves at sub-scope. The
      // sub-plan INHERITS its anchor from the worker's node — no
      // parameter threading needed; findGoverningPlan walks up.
      //
      // Depth cap: Pass 1 MVP caps at depth 1 (one level of sub-plan).
      // Sub-branches that themselves emit [[BRANCHES]] have their
      // emissions ignored with a log line; relaxation is a later pass
      // once budget semantics are in place. branch.depth=0 is a root-
      // level branch; its emissions are depth=1 sub-plans. ALLOWED.
      // branch.depth=1 would be a sub-branch; its further emission
      // would be depth=2. REJECTED.
      if (branchResult?.answer) {
        const nested = parseBranches(branchResult.answer);
        if (nested.branches.length > 0) {
          const currentDepth = branch.depth || 0;
          const MAX_SUB_PLAN_DEPTH = 1;

          // Always strip the [[BRANCHES]] block from the worker's
          // answer so downstream logic (scout, retry, summary) doesn't
          // re-parse stale nested emissions.
          const cleanAnswer = nested.cleaned;
          const lastIdx = results.length - 1;
          if (lastIdx >= 0) results[lastIdx].answer = cleanAnswer;

          if (currentDepth >= MAX_SUB_PLAN_DEPTH) {
            log.warn(
              "Swarm",
              `🌱 Branch "${qualifiedName}" emitted ${nested.branches.length} nested branch(es) but depth cap (${MAX_SUB_PLAN_DEPTH}) blocks further decomposition. Emission ignored; worker must handle flat.`,
            );
          } else {
            log.info(
              "Swarm",
              `🌱 Branch "${qualifiedName}" emitted ${nested.branches.length} sub-branch(es): ${nested.branches.map((s) => s.name).join(", ")}. Creating sub-plan at ${String(branchNode._id).slice(0, 8)}.`,
            );

            try {
              const p = await plan();

              // Build initial steps from the nested emission. Status is
              // pending-approval until the user accepts at sub-scope.
              // parentBranch links back so rollup and display can trace
              // the chain to the outermost plan.
              const subPlanSteps = nested.branches.map((sub) => ({
                kind: "branch",
                title: sub.name,
                spec: sub.spec || null,
                path: sub.path || null,
                files: sub.files || [],
                slot: sub.slot || null,
                mode: sub.mode || null,
                stepType: "simple",
                status: "pending-approval",
                parentBranch: branch.name,
              }));

              // Create the sub-plan node as child of the worker's
              // branch node. INHERITS POSITION: parent = the very node
              // where decomposition was triggered. findGoverningPlan
              // from any future sub-branch walks up and lands here.
              const subPlanNode = await p.createPlanNode({
                parentNodeId: String(branchNode._id),
                userId,
                // Plain "plan" — parent + type="plan" encode the
                // hierarchy; renaming the worker's branch shouldn't
                // orphan the sub-plan's name.
                name: "plan",
                systemSpec: `Sub-plan for ${qualifiedName}. Triggered mid-build when the worker emitted [[BRANCHES]] discovering compound work.`,
                steps: subPlanSteps,
                core,
              });

              // Mark the parent plan's step (the one this worker was
              // executing) as having decomposed. Update its stepType
              // to "compound" and stamp a subPlanNodeId pointer. The
              // governing plan for the worker's node is whatever plan
              // holds its branch step — typically the project-root
              // plan, but could be a higher sub-plan in deeper runs.
              try {
                const parentPlanNode = await p.findGoverningPlan(String(branchNode._id));
                if (parentPlanNode) {
                  const parentPlan = await p.readPlan(parentPlanNode._id);
                  const parentStep = parentPlan?.steps?.find(
                    (s) => s.kind === "branch" &&
                      String(s.childNodeId || "") === String(branchNode._id),
                  );
                  if (parentStep) {
                    await p.updateStep(parentPlanNode._id, parentStep.id, {
                      stepType: "compound",
                      subPlanNodeId: String(subPlanNode._id),
                    }, core);
                  }
                }
              } catch (markErr) {
                log.debug("Swarm", `parent-step compound mark skipped: ${markErr.message}`);
              }

              // Ledger entry captures that this sub-plan was proposed
              // and what triggered it. Pass 3 will read ledger entries
              // to compute signature reputation.
              try {
                await p.appendLedger(String(subPlanNode._id), {
                  event: "sub-plan-proposed",
                  detail: {
                    parentBranchName: branch.name,
                    parentBranchNodeId: String(branchNode._id),
                    qualifiedName,
                    stepCount: subPlanSteps.length,
                    branchNames: nested.branches.map((b) => b.name),
                  },
                }, core);
              } catch {}

              // Emit SUB_PLAN_PROPOSED for the user to approve at
              // sub-scope. Payload shows ONLY the local sub-plan with
              // parent context as breadcrumbs — not the whole-project
              // plan. Scoped cognitive load, aligned with the scope
              // the decision actually covers.
              try {
                const { SWARM_WS_EVENTS } = await import("./wsEvents.js");
                socket?.emit?.(SWARM_WS_EVENTS.SUB_PLAN_PROPOSED, {
                  subPlanNodeId: String(subPlanNode._id),
                  subPlanName: subPlanNode.name || "plan",
                  scope: {
                    parentBranchName: branch.name,
                    parentBranchNodeId: String(branchNode._id),
                    qualifiedName,
                    rootPlanNodeId: rootProjectNode?._id ? String(rootProjectNode._id) : null,
                    rootPlanName: rootProjectNode?.name || null,
                  },
                  proposedBranches: nested.branches.map((b) => ({
                    name: b.name,
                    spec: b.spec,
                    path: b.path || null,
                    files: b.files || [],
                    slot: b.slot || null,
                    mode: b.mode || null,
                    parentBranch: branch.name,
                  })),
                  trigger: `${qualifiedName} discovered ${nested.branches.length} sub-component(s)`,
                });
              } catch (emitErr) {
                log.debug("Swarm", `SUB_PLAN_PROPOSED emit failed: ${emitErr.message}`);
              }

              log.info(
                "Swarm",
                `📋 Sub-plan ${String(subPlanNode._id).slice(0, 8)} created with ${subPlanSteps.length} pending-approval step(s). Awaiting user approval at sub-scope (parent branch ${branch.name}).`,
              );
            } catch (subPlanErr) {
              // Sub-plan creation failed catastrophically (DB error,
              // permission issue, etc.). Log and skip — don't try to
              // persist plan state through a broken write path. The
              // nested [[BRANCHES]] emission is lost from this run but
              // the outer swarm continues; the user can re-issue.
              log.error(
                "Swarm",
                `Sub-plan creation failed for "${qualifiedName}": ${subPlanErr.message}. Nested emission dropped.`,
              );
            }
          }
        }
      }
    } catch (err) {
      const parentAborted = signal?.aborted === true;
      const resumableStatus = parentAborted ? "paused" : "failed";
      log.error("Swarm",
        `Branch "${qualifiedName}" ${parentAborted ? "paused (aborted)" : "failed"}: ${err.message}`,
      );
      await setBranchStatus({ branchNodeId: branchNode._id, status: resumableStatus, error: err.message, core });
      await p.upsertBranchStep(
        planNodeForStep,
        {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: resumableStatus,
          error: err.message,
          finishedAt: new Date().toISOString(),
          ...(parentAborted ? { pausedAt: new Date().toISOString(), abortReason: err.message } : {}),
        },
        core,
      );
      await recordBranchEvent({ visitorId, branchName: branch.name, from: "running", to: resumableStatus, reason: err.message });
      results.push({
        name: qualifiedName,
        rawName: branch.name,
        parentBranch: branch.parentBranch,
        status: "failed",
        error: err.message,
      });
    }

    if (branchHeaderStep) {
      const done = results[results.length - 1];
      const headerOutput =
        done.status === "done"
          ? `✓ ${qualifiedName}: ${truncate(done.answer || "done", 200)}`
          : `✗ ${qualifiedName}: ${done.error || "failed"}`;
      await finishBranchHeader(branchHeaderStep, {
        output: headerOutput,
        stopped: done.status !== "done",
        modeKey: branchMode,
      });
    }
    const lastResult = results[results.length - 1];
    socket?.emit?.(WS.BRANCH_COMPLETED, {
      name: qualifiedName,
      rawName: branch.name,
      parentBranch: branch.parentBranch || null,
      index: processed,
      total: totalKnown,
      status: lastResult?.status || "unknown",
      error: lastResult?.error || null,
    });
  }

  if (queue.length > 0 && !signal?.aborted && processed >= MAX_BRANCHES) {
    log.warn("Swarm",
      `${queue.length} branches remained queued after MAX_BRANCHES (${MAX_BRANCHES}) cap hit`,
    );
  }

  // First retry pass over anything that failed in the per-branch phase
  if (!signal?.aborted) {
    await retryFailedBranches({
      results, branches, runBranch, rootProjectNode,
      sessionId, userId, username, visitorId, rootId,
      signal, slot, socket, onToolLoopCheckpoint, rootChatId,
      core, emitStatus, rt, defaultBranchMode,
    });
  }

  if (rootChatId && sessionId) {
    setChatContext(visitorId, sessionId, rootChatId);
  }

  // Promote any branch whose children are all done
  try {
    await promoteDoneAncestors({ projectNodeId: rootProjectNode._id, core });
  } catch (err) {
    log.debug("Swarm", `promoteDoneAncestors skipped: ${err.message}`);
  }

  // Cross-branch hook. Domain extensions run their integration /
  // conformance / seam / behavioral tests here. If any handler flips
  // result statuses to failed, we re-run retry one more time so
  // branches can see the new signals in their next enrichContext.
  if (!signal?.aborted) {
    const statusesBefore = results.map((r) => r.status).join("|");
    const swarmCompletePayload = {
      rootProjectNode, workspaceAnchorNode, results, branches, core, signal,
    };
    await fireHook(core, "swarm:afterAllBranchesComplete", swarmCompletePayload);
    // Declarative validators (Pass 1 strengthening). Same shape as the
    // branch-complete site: run after the kernel hook so existing
    // handlers keep their effective order, and new validators opt in
    // via swarm.registerValidator with explicit phase + order.
    try {
      const { runValidators } = await import("./state/validators.js");
      await runValidators("swarm-complete", swarmCompletePayload);
    } catch (vErr) {
      log.debug("Swarm", `swarm-complete validators skipped: ${vErr.message}`);
    }
    const statusesAfter = results.map((r) => r.status).join("|");

    if (statusesAfter !== statusesBefore) {
      await fireHook(core, "swarm:branchRetryNeeded", {
        rootProjectNode, results, branches,
      });
      log.info("Swarm",
        `🔄 Re-running retry after cross-branch handlers flipped statuses`);
      await retryFailedBranches({
        results, branches, runBranch, rootProjectNode,
        sessionId, userId, username, visitorId, rootId,
        signal, slot, socket, onToolLoopCheckpoint, rootChatId,
        core, emitStatus, rt, defaultBranchMode,
      });
    }
  }

  // Scout phase: extension-provided seam verification. Runs AFTER
  // existing validators have had their shot, so scouts are looking
  // at the "final" state branches produced. Narrated via
  // swarmScoutsDispatched / swarmScoutReport / swarmIssuesRouted /
  // swarmRedeploying / swarmReconciled events. Silent if no
  // swarm:runScouts listener is registered.
  if (!signal?.aborted) {
    try {
      const scoutOutcome = await runScoutLoop({
        rootProjectNode, results, branches, core, socket, signal,
        runBranch, sessionId, userId, username, visitorId, rootId,
        slot, onToolLoopCheckpoint, rootChatId, rt, defaultBranchMode,
      });
      if (scoutOutcome.cycles > 0) {
        log.info("Swarm",
          `🔍 Scout loop: ${scoutOutcome.cycles} cycle(s), ${scoutOutcome.totalIssues} issue(s), status=${scoutOutcome.status}`);
      }
    } catch (err) {
      log.warn("Swarm", `scout loop error: ${err.message}`);
    }
  }

  const doneCount = results.filter((r) => r.status === "done").length;
  const failCount = results.filter((r) => r.status === "failed" || r.status === "error").length;
  const summaryLines = results.map((r) => {
    const icon = r.status === "done" ? "✓" : "✗";
    return `${icon} ${r.name}${r.answer ? ` — ${truncate(r.answer, 120)}` : r.error ? ` — ${r.error}` : ""}`;
  });

  const summary =
    `Swarm complete: ${doneCount} done, ${failCount} failed, ${results.length} total branches.\n\n` +
    summaryLines.join("\n");

  log.info("Swarm", `🌿 Finished: ${doneCount}/${results.length} branches succeeded`);

  // Stamp plan-completed on the ledger. Symmetric with the sub-plan
  // completion lifecycle — every plan at every scope logs its own
  // start and end events, so Pass 3 reputation sees uniform data.
  try {
    if (rootPlanNodeId && p.appendLedger) {
      const overallStatus = failCount === 0 && results.length > 0
        ? "settled"
        : (doneCount > 0 ? "partial" : "failed");
      await p.appendLedger(rootPlanNodeId, {
        event: "plan-completed",
        detail: {
          scopeNodeId: String(rootProjectNode._id),
          scopeName: rootProjectNode.name || null,
          doneCount,
          failCount,
          total: results.length,
          overallStatus,
        },
      }, core);
    }
  } catch (ledgerErr) {
    log.debug("Swarm", `plan-completed ledger skipped: ${ledgerErr.message}`);
  }

  return { success: failCount === 0, summary, results };
}

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}
