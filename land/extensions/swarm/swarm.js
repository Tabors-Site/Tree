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
import { plan, upsertBranchStep, setBranchStatus } from "./state/planAccess.js";
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
    contracts.push(entry);
  }

  const openStart = openMatch.index;
  const closeEnd = openEnd + closeIdxInRest + closeLength;
  const cleaned = (responseText.slice(0, openStart) + responseText.slice(closeEnd)).trimEnd();
  return { contracts, cleaned };
}

function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let buf = "";
  for (const ch of s) {
    if (ch === "{" || ch === "[" || ch === "<") depth++;
    else if (ch === "}" || ch === "]" || ch === ">") depth--;
    else if (ch === "," && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

function findTopLevelColon(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" || ch === "[" || ch === "<") depth++;
    else if (ch === "}" || ch === "]" || ch === ">") depth--;
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
      await upsertBranchStep({
        parentNodeId: rootProjectNode._id,
        core,
        branch: {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: "done",
          summary: truncate(retryResult?.answer || "", 300),
          finishedAt: new Date().toISOString(),
          retries: 1,
        },
      });
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
      await upsertBranchStep({
        parentNodeId: rootProjectNode._id,
        core,
        branch: {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: "failed",
          error: err.message + " (also failed on retry)",
          finishedAt: new Date().toISOString(),
          retries: 1,
        },
      });
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

  if (!resumeMode) {
    // Mark the project (swarm role + execution bookkeeping).
    await initProjectRole({
      nodeId: rootProjectNode._id,
      systemSpec: userRequest,
      core,
    });
    // Initialize the plan namespace.
    const p = await plan();
    await p.initPlan(rootProjectNode._id, { systemSpec: userRequest }, core);

    for (const b of branches) {
      await upsertBranchStep({
        parentNodeId: rootProjectNode._id,
        core,
        branch: {
          name: b.name,
          spec: b.spec,
          path: b.path || null,
          files: b.files || [],
          slot: b.slot || null,
          mode: b.mode || null,
          status: "pending",
        },
      });
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
        const parentForPlan = await resolveBranchParentId({
          rootProjectId: rootProjectNode._id,
          parentBranchName: q.parentBranch,
          hint: q.parentNodeId,
        });
        await upsertBranchStep({
          parentNodeId: parentForPlan, core,
          branch: {
            name: q.name,
            status: "pending",
            pausedAt: new Date().toISOString(),
            abortReason: "parent session aborted",
          },
        });
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

    const parentNodeForPlan = await resolveBranchParentId({
      rootProjectId: rootProjectNode._id,
      parentBranchName: branch.parentBranch,
      hint: branch.parentNodeId,
    });

    await upsertBranchStep({
      parentNodeId: parentNodeForPlan, core,
      branch: {
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
    });
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
      await upsertBranchStep({
        parentNodeId: parentNodeForPlan, core,
        branch: {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: "done",
          summary: truncate(branchResult?.answer || "", 300),
          finishedAt: new Date().toISOString(),
        },
      });
      await recordBranchEvent({ visitorId, branchName: branch.name, from: "running", to: "done" });

      // Fire per-branch hook. Handlers (e.g., code-workspace) run
      // their own validators (syntax sweep, smoke, dead-receiver
      // scan). If a handler finds a problem, it can mutate
      // resultEntry.status = "failed" and/or append signals. Swarm
      // checks the status after.
      await fireHook(core, "swarm:afterBranchComplete", {
        branchNode, rootProjectNode, branch,
        result: resultEntry,
        branchMode,
      });

      if (resultEntry.status !== "done") {
        // Handler flipped it. Reflect in metadata + subPlan + event log.
        await setBranchStatus({
          branchNodeId: branchNode._id,
          status: resultEntry.status,
          error: resultEntry.error || null,
          summary: null, core,
        });
        await upsertBranchStep({
          parentNodeId: parentNodeForPlan, core,
          branch: {
            name: branch.name,
            nodeId: String(branchNode._id),
            status: resultEntry.status,
            error: resultEntry.error || null,
            finishedAt: new Date().toISOString(),
          },
        });
        await recordBranchEvent({
          visitorId, branchName: branch.name,
          from: "done", to: resultEntry.status,
          reason: resultEntry.error || "handler override",
        });
        continue;
      }

      // Recursive expansion: nested [[BRANCHES]] inside the response.
      // Also pre-populate the parent's subPlan with the declared sub-
      // branches so visibility tools (book-studio, dashboard) see the
      // planned-but-not-yet-dispatched chapter list as soon as a parent
      // finishes decomposing. Without this, the studio shows only
      // dispatched branches mid-run — a 30-chapter book looks like
      // "4 parts, (no prose yet)" until every chapter has actually
      // started running, which can be 30+ minutes on a local LLM.
      if (branch.depth < MAX_DEPTH && branchResult?.answer) {
        const nested = parseBranches(branchResult.answer);
        if (nested.branches.length > 0) {
          log.info("Swarm",
            `🌱 Branch "${qualifiedName}" spawned ${nested.branches.length} sub-branch(es): ${nested.branches.map((s) => s.name).join(", ")}. Pausing for user re-approval.`,
          );

          // Plan-first: DON'T queue the nested branches directly.
          // Seed them on the parent's subPlan as pending-nested-approval
          // so the UI shows "this branch discovered subs, pending user
          // confirmation" and the ring stays visible. Then re-invoke
          // the architect to produce a COMPLETE UPDATED PLAN (with
          // peer adjustments) and stash it for user approval via the
          // same pendingSwarmPlan path the first dispatch used.
          for (const sub of nested.branches) {
            try {
              await upsertBranchStep({
                parentNodeId: branchNode._id,
                core,
                branch: {
                  name: sub.name,
                  spec: sub.spec,
                  path: sub.path || null,
                  files: sub.files || [],
                  slot: sub.slot || null,
                  mode: sub.mode || null,
                  status: "pending-nested-approval",
                },
              });
            } catch {}
          }
          const cleanAnswer = nested.cleaned;
          const lastIdx = results.length - 1;
          if (lastIdx >= 0) results[lastIdx].answer = cleanAnswer;

          // Re-invoke the architect at the project root to re-emit
          // the complete updated plan. We pass the current plan
          // snapshot + the new discoveries so it can decide whether
          // peer branches need their specs adjusted. The architect's
          // response is intercepted by dispatch.js (it sees the new
          // [[BRANCHES]] block and stashes it via setPendingSwarmPlan)
          // just like the first proposal.
          try {
            const { runChat } = await import("../../seed/llm/conversation.js");
            const p = await plan();
            const currentPlan = await p.readPlan(rootProjectNode._id);
            const branchEntries = (currentPlan?.steps || []).filter(s => s.kind === "branch");
            const planSummary = branchEntries.length > 0
              ? branchEntries
                  .map((b) => `  • ${b.title} [${b.status || "?"}]${b.path ? ` (${b.path})` : ""}: ${b.spec || ""}`)
                  .join("\n")
              : "(no plan recorded)";
            const discoveries = nested.branches
              .map((s) => `  • ${s.name}${s.path ? ` (${s.path})` : ""}: ${s.spec || ""}`)
              .join("\n");
            const replanPrompt =
              `Branch "${qualifiedName}" ran and discovered new sub-components that need their own branches:\n${discoveries}\n\n` +
              `Current whole plan:\n${planSummary}\n\n` +
              `Re-emit the COMPLETE updated [[BRANCHES]] block. Include every branch (done, running, and new). ` +
              `If these new discoveries change what peer branches should own, adjust their specs accordingly — ` +
              `the user wants to see the whole coherent plan, not a diff. ` +
              `Keep existing branch names stable where possible so continuity is preserved. ` +
              `Close with [[DONE]].`;

            // Fire the architect mode at the project root. Default
            // ephemeral session keeps it out of the user's thread. The
            // response comes back as a string — we parse [[BRANCHES]]
            // ourselves and stash the new plan for the user's next
            // turn, which flows through the orchestrator interception
            // path built in Phase 1.
            const replanResult = await runChat({
              userId,
              username,
              message: replanPrompt,
              mode: "tree:code-plan",
              rootId,
              nodeId: String(rootProjectNode._id),
              llmPriority: "INTERACTIVE",
            });
            const architectAnswer = (replanResult?.answer || replanResult?.content || "").toString();
            const newParse = parseBranches(architectAnswer);
            if (newParse.branches.length > 0) {
              // Bump the plan version and stash for the user. The
              // user's next message (via chat) triggers the
              // orchestrator.js pending-swarm interception, same
              // as the initial proposal.
              try {
                const { getPendingSwarmPlan, setPendingSwarmPlan } =
                  await import("./state/pendingSwarmPlan.js");
                const { SWARM_WS_EVENTS } = await import("./wsEvents.js");
                const prev = getPendingSwarmPlan(visitorId);
                const nextVersion = (prev?.version || 1) + 1;
                setPendingSwarmPlan(visitorId, {
                  branches: newParse.branches,
                  contracts: prev?.contracts || [],
                  projectNodeId: String(rootProjectNode._id),
                  projectName: rootProjectNode.name || null,
                  userRequest: userRequest || "",
                  architectChatId: null,
                  rootChatId,
                  rootId,
                  modeKey: "tree:code-plan",
                  targetNodeId: String(rootProjectNode._id),
                  version: nextVersion,
                  cleanedAnswer: newParse.cleaned,
                  nestedExpansion: true,
                });
                socket?.emit?.(SWARM_WS_EVENTS.PLAN_UPDATED, {
                  version: nextVersion,
                  projectNodeId: String(rootProjectNode._id),
                  projectName: rootProjectNode.name || null,
                  trigger: `nested expansion of ${qualifiedName}`,
                  branches: newParse.branches.map((b) => ({
                    name: b.name,
                    spec: b.spec,
                    path: b.path || null,
                    files: b.files || [],
                    slot: b.slot || null,
                    mode: b.mode || null,
                    parentBranch: b.parentBranch || null,
                  })),
                });
                log.info("Swarm",
                  `🔁 Replan stashed (v${nextVersion}) with ${newParse.branches.length} branches. Awaiting user approval.`,
                );
              } catch (stashErr) {
                log.warn("Swarm", `stash replan failed: ${stashErr.message}`);
              }
            } else {
              log.warn("Swarm",
                `Replan architect returned no [[BRANCHES]] block; falling back to auto-queue of discovered subs.`,
              );
              // Fallback — preserve old behavior if the replan prompt
              // didn't produce a usable plan.
              for (const sub of nested.branches) {
                queue.push({
                  ...sub,
                  parentBranch: branch.name,
                  depth: branch.depth + 1,
                });
              }
            }
          } catch (replanErr) {
            log.warn("Swarm", `nested replan failed: ${replanErr.message}. Falling back to auto-queue.`);
            // Fallback: keep old behavior so the swarm doesn't stall.
            for (const sub of nested.branches) {
              queue.push({
                ...sub,
                parentBranch: branch.name,
                depth: branch.depth + 1,
              });
              try {
                await upsertBranchStep({
                  parentNodeId: branchNode._id,
                  core,
                  branch: { name: sub.name, status: "pending" },
                });
              } catch {}
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
      await upsertBranchStep({
        parentNodeId: parentNodeForPlan, core,
        branch: {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: resumableStatus,
          error: err.message,
          finishedAt: new Date().toISOString(),
          ...(parentAborted ? { pausedAt: new Date().toISOString(), abortReason: err.message } : {}),
        },
      });
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
    await fireHook(core, "swarm:afterAllBranchesComplete", {
      rootProjectNode, results, branches, core, signal,
    });
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

  return { success: failCount === 0, summary, results };
}

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}
