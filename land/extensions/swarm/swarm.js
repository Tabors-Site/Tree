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
//     path: public
//   [[/BRANCHES]]
//
// Each branch becomes a child node of the project root (named after
// `branch:`). The runner walks the queue, calling the caller-supplied
// runBranch(...) callback at the branch's position with the spec as the
// initial message.

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { v4 as uuidv4 } from "uuid";
import { startChainStep, finalizeChat, setChatContext, getChatContext } from "../../seed/llm/chatTracker.js";
import {
  upsertSubPlanEntry,
  initProjectPlan,
  readSubPlan,
  setBranchStatus,
  initBranchNode,
} from "./state/subPlan.js";
import { appendSignal } from "./state/signalInbox.js";
import { readMeta, mutateMeta } from "./state/meta.js";
import { promoteDoneAncestors } from "./project.js";
import { reconcileProject } from "./reconcile.js";

const BRANCHES_OPEN = /\[\[\s*branches\s*\]\]/i;
const BRANCHES_CLOSE_TIGHT = /\[\[\s*\]?\s*\/\s*branches\s*\]\]/i;
const BRANCHES_CLOSE_LOOSE = /\[\[[^\[\]]*(\/|end)[^\[\]]*branches[^\[\]]*\]\]/i;
const CONTRACTS_OPEN = /\[\[\s*contracts\s*\]\]/i;
const CONTRACTS_CLOSE_TIGHT = /\[\[\s*\]?\s*\/\s*contracts\s*\]\]/i;
const CONTRACTS_CLOSE_LOOSE = /\[\[[^\[\]]*(\/|end)[^\[\]]*contracts[^\[\]]*\]\]/i;

/**
 * Fire a custom swarm lifecycle hook. Handlers registered by domain
 * extensions receive the payload. Errors in handlers are logged but
 * never stop swarm. Returns the payload (handlers may mutate fields
 * like `results` to signal retry needs).
 */
async function fireHook(core, name, payload) {
  try {
    if (core?.hooks?.fire) {
      await core.hooks.fire(name, payload);
    }
  } catch (err) {
    log.warn("Swarm", `hook ${name} listener error: ${err.message}`);
  }
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
    // Unclosed block — consume to EOF if the body has at least one
    // recognizable `message` or `type` declaration. Otherwise reject.
    if (/^\s*(message|type)\s+[A-Za-z_]/im.test(rest)) {
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
    const kvMatch = line.match(/^(message|type)\s+([A-Za-z_][\w-]*)\s*:\s*(.+)$/i);
    if (!kvMatch) continue;
    const kind = kvMatch[1].toLowerCase();
    const name = kvMatch[2];
    const rhs = kvMatch[3].trim();

    const fields = new Set();
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
            fields.add(clean.replace(/^['"]|['"]$/g, ""));
          }
        }
      }
    }

    fields.delete("type");
    contracts.push({ kind, name, fields: [...fields], raw: line });
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

    const nameNorm = normalize(b.name);
    if (nameNorm && nameNorm !== pathNorm) {
      errors.push(
        `Branch "${b.name}" has path "${pathRaw}" which does not match its name. ` +
        `Set path equal to name (rename the branch or change its path).`
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

  // Swarm-owned metadata. Domain extensions can stamp their own
  // namespaces (e.g. code-workspace.path for filesystem mapping) via
  // swarm:beforeBranchRun hook if they need to.
  await mutateMeta(branchNode._id, (draft) => {
    draft.role = "branch";
    draft.branchName = branch.name;
    draft.spec = branch.spec;
    draft.slot = branch.slot || null;
    draft.mode = branch.mode || null;
    draft.path = branch.path || null;
    draft.files = branch.files || [];
    draft.parentProjectId = String(rootProjectId);
    draft.parentBranch = branch.parentBranch || null;
    draft.status = draft.status || "pending";
    if (!draft.subPlan) draft.subPlan = { branches: [], createdAt: new Date().toISOString() };
    if (!draft.aggregatedDetail) {
      draft.aggregatedDetail = {
        filesWritten: 0,
        contracts: [],
        statusCounts: { done: 0, running: 0, pending: 0, failed: 0 },
        lastActivity: null,
      };
    }
    if (!Array.isArray(draft.inbox)) draft.inbox = [];
    if (!draft.createdAt) draft.createdAt = new Date().toISOString();
    return draft;
  }, core);

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
      await upsertSubPlanEntry({
        parentNodeId: rootProjectNode._id,
        core,
        child: {
          name: branch.name,
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
      await upsertSubPlanEntry({
        parentNodeId: rootProjectNode._id,
        core,
        child: {
          name: branch.name,
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
  branches, rootProjectNode, rootChatId, sessionId,
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

  // Tree-authoritative reconciliation. User edits to the tree (inserted
  // branches, renamed, deleted, rewrote specs) get absorbed into subPlan
  // before we read it. The tree is ground truth; subPlan is a cache.
  await reconcileProject({ projectNodeId: rootProjectNode._id, core });

  if (!resumeMode) {
    await initProjectPlan({
      projectNodeId: rootProjectNode._id,
      systemSpec: userRequest,
      core,
    });

    for (const b of branches) {
      await upsertSubPlanEntry({
        parentNodeId: rootProjectNode._id,
        core,
        child: {
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
    if (rt && !rt._cleaned) {
      return rt.beginChainStep(modeKey, input, {
        treeContext: branchNodeId ? { targetNodeId: branchNodeId } : undefined,
      });
    }
    const chat = await startChainStep({
      userId, sessionId,
      chainIndex: fallbackChainIdx++,
      rootChatId: rootChatId || null,
      modeKey,
      source: "swarm-branch",
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
        await upsertSubPlanEntry({
          parentNodeId: parentForPlan, core,
          child: {
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

    await upsertSubPlanEntry({
      parentNodeId: parentNodeForPlan, core,
      child: {
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
      await upsertSubPlanEntry({
        parentNodeId: parentNodeForPlan, core,
        child: {
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
        await upsertSubPlanEntry({
          parentNodeId: parentNodeForPlan, core,
          child: {
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

      // Recursive expansion: nested [[BRANCHES]] inside the response
      if (branch.depth < MAX_DEPTH && branchResult?.answer) {
        const nested = parseBranches(branchResult.answer);
        if (nested.branches.length > 0) {
          log.info("Swarm",
            `🌱 Branch "${qualifiedName}" spawned ${nested.branches.length} sub-branch(es): ${nested.branches.map((s) => s.name).join(", ")}`,
          );
          for (const sub of nested.branches) {
            queue.push({
              ...sub,
              parentBranch: branch.name,
              depth: branch.depth + 1,
            });
          }
          const cleanAnswer = nested.cleaned;
          const lastIdx = results.length - 1;
          if (lastIdx >= 0) results[lastIdx].answer = cleanAnswer;
        }
      }
    } catch (err) {
      const parentAborted = signal?.aborted === true;
      const resumableStatus = parentAborted ? "paused" : "failed";
      log.error("Swarm",
        `Branch "${qualifiedName}" ${parentAborted ? "paused (aborted)" : "failed"}: ${err.message}`,
      );
      await setBranchStatus({ branchNodeId: branchNode._id, status: resumableStatus, error: err.message, core });
      await upsertSubPlanEntry({
        parentNodeId: parentNodeForPlan, core,
        child: {
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
