/**
 * Branch swarm runner.
 *
 * When a mode emits a structured `[[BRANCHES]]...[[/BRANCHES]]` block, the
 * orchestrator parses it into a list of branch specs and dispatches each
 * branch as its own sequence of plan-mode chats, rooted at a dedicated
 * child node under the project.
 *
 * A swarm is how TreeOS builds a multi-component project: decompose into
 * branches (backend, frontend, shared-contracts, etc.), each branch runs
 * in its own session context with its own tree position, leaf nodes
 * write files, cascades propagate state changes between siblings. The
 * root project node holds the overall plan.
 *
 * Phase 1 (this file) is SEQUENTIAL — branches run one after another.
 * The `slot` field on each branch is captured but not yet used to route
 * the LLM call; once parallelism is enabled, multiple branches can run
 * at once on different LLM slots (cloud + local mix) without blocking
 * on the single GPU.
 *
 * Block format (whitespace-tolerant, indentation ignored):
 *
 *     [[BRANCHES]]
 *     branch: backend
 *       spec: Node.js + Express server with auth, swipe, match endpoints.
 *       slot: code-plan
 *       path: backend
 *       files: package.json, server.js, auth.js, db.js
 *
 *     branch: frontend
 *       spec: HTML/CSS/JS frontend with login, swipe deck, chat pane.
 *       slot: code-plan
 *       path: public
 *       files: public/index.html, public/app.js, public/styles.css
 *     [[/BRANCHES]]
 *
 * Each branch becomes a child node of the project root (named after
 * `branch:`). The runner walks branches in declared order, calling
 * runSteppedMode on tree:code-plan at the branch's position with the
 * spec as the initial message.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { v4 as uuidv4 } from "uuid";
import { startChainStep, finalizeChat, setChatContext, getChatContext } from "../../seed/llm/chatTracker.js";

/**
 * Mirror a branch status transition onto the current AI forensics
 * capture (if treeos-base is loaded and the capture is still pending).
 * Fire-and-forget — a missing forensics export or a failed call never
 * breaks the swarm runner.
 *
 * Called right after every `upsertSubPlanEntry` with a status change.
 * The renderer shows these as an inline timeline inside each chat
 * step's expanded view.
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
import {
  upsertSubPlanEntry,
  initProjectPlan,
  readSubPlan,
  readAggregatedDetail,
  appendSignalInbox,
  SIGNAL_KIND,
} from "../code-workspace/swarmEvents.js";
import { validateSyntax } from "../code-workspace/validators/syntax.js";
import { smokeBranch } from "../code-workspace/validators/smoke.js";
import { smokeIntegration } from "../code-workspace/validators/integration.js";
import { smokeWsSeam } from "../code-workspace/validators/wsSeam.js";
import { runBehavioralTests } from "../code-workspace/validators/behavioralTest.js";
import { getWorkspacePath } from "../code-workspace/workspace.js";

// The opening tag is tight: `[[branches]]` (case-insensitive, flexible
// whitespace). The closing tag is deliberately loose because the model
// keeps emitting malformed variants like `[[]/BRANCHES]]`, `[[ /branches]]`,
// `[[ end branches ]]`, etc., and every miss silently swallows the whole
// swarm dispatch. The loose pattern accepts any `[[...branches...]]`
// ending tag as long as the body includes a `/`, `\`, `end`, or just
// `branches` after an opening `[[`. If even this misses, parseBranches
// falls back to "find the last `[[` on or after a line containing a slash
// or 'end' or 'branches' and cut the body there".
const BRANCHES_OPEN = /\[\[\s*branches\s*\]\]/i;
const BRANCHES_CLOSE_TIGHT = /\[\[\s*\]?\s*\/\s*branches\s*\]\]/i;
const BRANCHES_CLOSE_LOOSE = /\[\[[^\[\]]*(\/|end)[^\[\]]*branches[^\[\]]*\]\]/i;

// Same pattern for the [[CONTRACTS]] block. Contracts are the shared
// wire protocol the architect declares BEFORE branching, and every
// branch must conform. We parse the block with the same tight/loose/
// line-based strategy because the architect model hits similar
// malformed closer variants.
const CONTRACTS_OPEN = /\[\[\s*contracts\s*\]\]/i;
const CONTRACTS_CLOSE_TIGHT = /\[\[\s*\]?\s*\/\s*contracts\s*\]\]/i;
const CONTRACTS_CLOSE_LOOSE = /\[\[[^\[\]]*(\/|end)[^\[\]]*contracts[^\[\]]*\]\]/i;

/**
 * Parse a [[BRANCHES]] block out of a response. Returns { branches, cleaned }
 * where `branches` is an array of branch objects and `cleaned` is the
 * response text with the block removed.
 *
 * Closing-tag detection is multi-stage because the model emits several
 * malformed variants (`[[]/BRANCHES]]`, `[[end-branches]]`, etc.) and we
 * can't afford to silently swallow the whole dispatch on any of them.
 * The stages are:
 *   1. Tight regex — correct + the common `[[]/branches]]` typo
 *   2. Loose regex — any `[[...<slash-or-end>...branches...]]` tag
 *   3. Line-based fallback — the last line that starts with `[[` after
 *      the opener; treat everything between opener and that line as body
 */
export function parseBranches(responseText) {
  if (typeof responseText !== "string" || !responseText) {
    return { branches: [], cleaned: responseText };
  }
  const openMatch = responseText.match(BRANCHES_OPEN);
  if (!openMatch) return { branches: [], cleaned: responseText };

  const openEnd = openMatch.index + openMatch[0].length;
  const rest = responseText.slice(openEnd);

  // Stage 1: tight regex on the remainder
  let closeMatch = rest.match(BRANCHES_CLOSE_TIGHT);
  let closeIdxInRest = closeMatch?.index;
  let closeLength = closeMatch?.[0]?.length || 0;

  // Stage 2: loose regex on the remainder
  if (closeIdxInRest == null) {
    closeMatch = rest.match(BRANCHES_CLOSE_LOOSE);
    closeIdxInRest = closeMatch?.index;
    closeLength = closeMatch?.[0]?.length || 0;
  }

  // Stage 3: line-based fallback — find the last line that starts with
  // `[[` in the rest. This catches `[[endbranches]]`, `[[close]]`, etc.
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
      // Reconstruct the char offset of that line in rest
      const upToThatLine = lines.slice(0, lastBracketLineIdx).join("\n");
      closeIdxInRest = upToThatLine.length + 1; // +1 for the newline
      closeLength = (lines[lastBracketLineIdx] || "").length;
    }
  }

  if (closeIdxInRest == null) {
    // No close tag found anywhere. Treat the block as unclosed — don't
    // return it as branches (dangerous), return empty and let the model
    // retry with a well-formed closer.
    return { branches: [], cleaned: responseText };
  }

  const body = rest.slice(0, closeIdxInRest);
  const branches = [];
  let current = null;

  const lines = body.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Start a new branch on any line that looks like `branch: name`
    const branchMatch = line.match(/^-?\s*branch\s*:\s*(.+)$/i);
    if (branchMatch) {
      if (current) branches.push(current);
      current = {
        name: branchMatch[1].trim(),
        spec: "",
        slot: "code-plan",
        path: null,
        files: [],
      };
      continue;
    }

    if (!current) continue;

    const kv = line.match(/^(spec|slot|path|files|depends|requires)\s*:\s*(.+)$/i);
    if (kv) {
      const key = kv[1].toLowerCase();
      const value = kv[2].trim();
      if (key === "spec") current.spec = value;
      else if (key === "slot") current.slot = value;
      else if (key === "path") current.path = value;
      else if (key === "files") {
        current.files = value.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (key === "depends" || key === "requires") {
        current.depends = value.split(",").map((s) => s.trim()).filter(Boolean);
      }
      continue;
    }

    // Bare continuation line on a branch: append to spec
    if (current && !line.match(/^[a-z]+\s*:/i)) {
      current.spec = current.spec ? current.spec + " " + line : line;
    }
  }
  if (current) branches.push(current);

  // Strip the whole matched range [openStart, closeEnd] from the text
  // so the cleaned response no longer contains the raw [[BRANCHES]] block.
  const openStart = openMatch.index;
  const closeEnd = openEnd + closeIdxInRest + closeLength;
  const cleaned = (responseText.slice(0, openStart) + responseText.slice(closeEnd)).trimEnd();
  return { branches: branches.filter((b) => b.name && b.spec), cleaned };
}

/**
 * Parse a [[CONTRACTS]] block out of a response. Contracts declare
 * the shared wire protocol every branch must agree on, BEFORE they
 * are dispatched. The architect's job is to design the seam first;
 * each branch's job is to implement its side faithfully.
 *
 * Format the architect emits (lines, tolerant whitespace):
 *
 *   [[CONTRACTS]]
 *   message join: { type: "join", roomId: string }
 *   message gameState: { type: "gameState", players: Map<id, Snake>, apples: Apple[], grid: number }
 *   type Snake: { x: number, y: number, direction: "up"|"down"|"left"|"right", tail: {x,y}[], dead: boolean }
 *   type Apple: { x: number, y: number }
 *   [[/CONTRACTS]]
 *
 * We don't try to fully parse the types — we just care about field
 * NAMES and the kind (message vs type). Branch validation compares
 * actual code's sent/received/read field names to these declared
 * names. Type correctness is the AI's problem, not the parser's.
 *
 * Returns:
 *   { contracts, cleaned }
 *     contracts: Array of { kind: 'message'|'type', name, fields: string[], raw }
 *     cleaned:   responseText with the [[CONTRACTS]] block removed
 *
 * Note: contracts can appear alongside [[BRANCHES]]. The caller
 * strips both blocks so the final answer text stays clean.
 */
export function parseContracts(responseText) {
  if (typeof responseText !== "string" || !responseText) {
    return { contracts: [], cleaned: responseText };
  }
  const openMatch = responseText.match(CONTRACTS_OPEN);
  if (!openMatch) return { contracts: [], cleaned: responseText };

  const openEnd = openMatch.index + openMatch[0].length;
  const rest = responseText.slice(openEnd);

  // Stage 1: tight close
  let closeMatch = rest.match(CONTRACTS_CLOSE_TIGHT);
  let closeIdxInRest = closeMatch?.index;
  let closeLength = closeMatch?.[0]?.length || 0;

  // Stage 2: loose close
  if (closeIdxInRest == null) {
    closeMatch = rest.match(CONTRACTS_CLOSE_LOOSE);
    closeIdxInRest = closeMatch?.index;
    closeLength = closeMatch?.[0]?.length || 0;
  }

  // Stage 3: line-based fallback (same as parseBranches)
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
    return { contracts: [], cleaned: responseText };
  }

  const body = rest.slice(0, closeIdxInRest);
  const contracts = [];

  // Line-based parse: each contract is one line of
  //   (message|type) NAME : { FIELD_LIST }
  // Field list is roughly comma-separated `field: type` pairs,
  // plus shorthand identifiers. We only extract field names.
  const lines = body.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("//")) continue;
    // Match `(message|type) NAME : { ... }`
    const kvMatch = line.match(/^(message|type)\s+([A-Za-z_][\w-]*)\s*:\s*(.+)$/i);
    if (!kvMatch) continue;
    const kind = kvMatch[1].toLowerCase();
    const name = kvMatch[2];
    const rhs = kvMatch[3].trim();

    // Extract field names from the RHS. We handle two shapes:
    //   { a: X, b: Y, c }
    //   Map<id, X>  → treat as a pseudo-type, no fields extracted here
    const fields = new Set();
    const braceIdx = rhs.indexOf("{");
    if (braceIdx !== -1) {
      // Find matching close, accounting for nested braces
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
        // Split by top-level commas
        const parts = splitTopLevelCommas(inner);
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          // `field: type` or shorthand `field`
          const colonIdx = findTopLevelColon(trimmed);
          const nameStr = colonIdx !== -1 ? trimmed.slice(0, colonIdx).trim() : trimmed;
          // Strip optional `?` for optional fields
          const clean = nameStr.replace(/\?$/, "").trim();
          if (/^['"]?[A-Za-z_$][\w$-]*['"]?$/.test(clean)) {
            fields.add(clean.replace(/^['"]|['"]$/g, ""));
          }
        }
      }
    }

    // Drop the `type` field itself from a message's field set — it's
    // the discriminant, not a payload field (same convention as wsSeam).
    fields.delete("type");

    contracts.push({
      kind,
      name,
      fields: [...fields],
      raw: line,
    });
  }

  const openStart = openMatch.index;
  const closeEnd = openEnd + closeIdxInRest + closeLength;
  const cleaned = (responseText.slice(0, openStart) + responseText.slice(closeEnd)).trimEnd();

  return { contracts, cleaned };
}

/** Split a string on top-level commas (ignore commas inside braces/brackets/angle brackets). */
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

/** Find the first top-level `:` (not inside braces/brackets/angle brackets). */
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
 * Validate a parsed [[BRANCHES]] list against the seam rules we tell
 * the architect about in the compoundBranches facet. Returns an array
 * of error strings — empty array means valid.
 *
 * Rules enforced:
 *   1. No branch's `path` may equal the project's own name. The AI
 *      often reaches for the project name as the "main" directory
 *      and every branch ends up writing into the same subdir.
 *      (TronGame case: backend and frontend both had path=TronGame,
 *      so the swarm collapsed both into one subdir and the real
 *      branch nodes stayed empty.)
 *   2. No two branches may share a `path`. Sibling branches must own
 *      disjoint directories or their file writes compete.
 *   3. Every branch MUST have a path (the swarm needs somewhere to
 *      scope its writes).
 *
 * Case-insensitive comparisons. Empty project name is tolerated (the
 * rule-1 check no-ops if we don't know the name yet).
 */
export function validateBranches(branches, projectName) {
  const errors = [];
  if (!Array.isArray(branches) || branches.length === 0) return { errors };

  const normalize = (s) => String(s || "").trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  const normProject = normalize(projectName);

  const seenPaths = new Map(); // normalized path → first branch name that used it
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
        `Use a subdirectory name that describes the LAYER (backend, frontend, server, ` +
        `client, api, ui, db, data, store, tests, docs), not the project name.`
      );
      continue;
    }

    if (seenPaths.has(pathNorm)) {
      errors.push(
        `Branch "${b.name}" has path "${pathRaw}" which is already used by branch ` +
        `"${seenPaths.get(pathNorm)}". Each branch must have a unique path — sibling ` +
        `branches that share a path compete for the same files and silently overwrite ` +
        `each other.`
      );
      continue;
    }

    // Name must match path (case-insensitive). The branch tree node
    // is created with the branch's `name`, and files the branch's AI
    // writes get prefixed with its `path` before resolveOrCreateFile
    // walks the project root. If name != path, the files land in a
    // sibling directory at the project root — NOT under the branch
    // node — which breaks the rollup and leaves the branch node
    // empty. Example that used to slip through: name=backend path=server
    // → backend branch empty, server/ directory holds the files.
    const nameNorm = normalize(b.name);
    if (nameNorm && nameNorm !== pathNorm) {
      errors.push(
        `Branch "${b.name}" has path "${pathRaw}" which does not match its name. ` +
        `The branch name IS the subdirectory name — set path equal to name. ` +
        `Either rename the branch to "${pathRaw}" or change its path to "${b.name}".`
      );
      continue;
    }

    seenPaths.set(pathNorm, b.name);
  }

  return { errors };
}

/**
 * Ensure a child node exists under the project root for this branch.
 * Reuses an existing node with the same name if present (idempotent
 * re-dispatch). Stamps metadata.code-workspace.swarm-branch so the
 * node is identifiable later.
 */
/**
 * Resolve the parent nodeId for a branch's dispatch, walking the tree
 * by NAME from the project root down to find the branch at any depth.
 * Used by both the initial dispatch loop and the abort-mark loop to
 * support nested sub-branches whose parent isn't a direct child of
 * the project root.
 *
 * Strategy:
 *   1. If `parentBranch` is null → parent is the project root.
 *   2. If the queue entry has a pre-resolved `parentNodeId` (set by
 *      the detector on resume), use that directly.
 *   3. Otherwise BFS through the project's descendants looking for a
 *      branch-role node with matching name. The first match wins.
 *
 * Returns the parent nodeId string or the project root's id as fallback.
 */
async function resolveBranchParentId({ rootProjectId, parentBranchName, hint }) {
  if (!parentBranchName) return rootProjectId;
  if (hint) return hint;

  // BFS the whole project subtree for a branch node matching the name.
  // Capped at 200 nodes to prevent runaway on huge trees — swarm branches
  // rarely exceed a few dozen.
  const visited = new Set([String(rootProjectId)]);
  const queue = [String(rootProjectId)];
  let scanned = 0;
  while (queue.length > 0 && scanned < 200) {
    const currentId = queue.shift();
    scanned++;
    const node = await Node.findById(currentId).select("_id children").lean();
    if (!node?.children?.length) continue;
    const kids = await Node.find({
      _id: { $in: node.children },
    }).select("_id name metadata").lean();
    for (const kid of kids) {
      const kidIdStr = String(kid._id);
      if (visited.has(kidIdStr)) continue;
      visited.add(kidIdStr);
      const data = kid.metadata instanceof Map
        ? kid.metadata.get("code-workspace")
        : kid.metadata?.["code-workspace"];
      if (data?.role === "branch" && kid.name === parentBranchName) {
        return kidIdStr;
      }
      queue.push(kidIdStr);
    }
  }
  // Fallback: couldn't find the parent branch by name → hang under project root
  return rootProjectId;
}

/**
 * Re-validate every file the branch wrote (or, more precisely, every
 * code file currently sitting under the branch's tree subdirectory).
 * Run AFTER runBranch returns successfully and BEFORE the swarm marks
 * the branch as done. If any file is broken, the branch's "done" gets
 * overridden to "failed" + the structured errors get appended to the
 * branch's signalInbox so the existing retry loop picks it up on
 * the next user message.
 *
 * The seam closer for the validator pipeline. Without this, a branch
 * that wrote bad code on its last continuation turn (with no remaining
 * budget to fix it) would silently land as "done" because afterNote's
 * live signal got buried under the swarm's success path.
 *
 * Returns { ok: bool, errors: [{ file, line, column, message }] }.
 */
async function sweepBranchValidation({ branchNode, rootProjectNode, branchPath, core }) {
  const errors = [];
  try {
    const { walkProjectFiles } = await import("../code-workspace/workspace.js");
    // Walk the entire project tree (cheap — branches share a single
    // workspace and code-workspace caches the walk via Mongo). Then
    // filter to files that live under the branch's path subdirectory.
    // This catches "this branch wrote a bad file" AND "this branch
    // touched a file in its subdir during a sub-branch's recursion".
    const allFiles = await walkProjectFiles(rootProjectNode._id);
    const prefix = branchPath ? branchPath.replace(/\/+$/, "") + "/" : null;

    for (const f of allFiles) {
      // Filter to files under this branch's subdir. If the branch has
      // no path declared (top-level project work), validate every code
      // file the branch wrote — but we don't track per-file branch
      // ownership granularly enough to do that, so we'd over-validate.
      // For safety: if no path declared, validate nothing in the sweep
      // (live afterNote signals already covered each individual write).
      if (!prefix) continue;
      if (!f.filePath.startsWith(prefix)) continue;
      if (!f.content) continue;

      const result = validateSyntax({
        filePath: f.filePath,
        content: f.content,
      });
      if (!result.ok && result.error) {
        errors.push(result.error);
      }
    }
  } catch (err) {
    log.warn("Tree Orchestrator", `Branch validation sweep failed: ${err.message}`);
  }

  return { ok: errors.length === 0, errors };
}

async function ensureBranchNode({ rootProjectId, branch, userId, core }) {
  const root = await Node.findById(rootProjectId).select("_id children");
  if (!root) throw new Error(`Swarm: project node ${rootProjectId} not found`);

  let branchNode = null;
  if (Array.isArray(root.children) && root.children.length > 0) {
    branchNode = await Node.findOne({
      _id: { $in: root.children },
      name: branch.name,
    });
  }

  if (!branchNode) {
    if (core?.tree?.createNode) {
      branchNode = await core.tree.createNode({
        parentId: root._id,
        name: branch.name,
        type: "branch",
        userId,
      });
    } else {
      branchNode = await Node.create({
        _id: uuidv4(),
        name: branch.name,
        type: "branch",
        parent: root._id,
        status: "active",
      });
      await Node.updateOne({ _id: root._id }, { $addToSet: { children: branchNode._id } });
    }
  }

  // Stamp the branch metadata with the self-similar shape. Same fields
  // as the project root uses, so any walker/reader/writer that works on
  // the root also works here: subPlan (decomposition), aggregatedDetail
  // (rolled up from descendants), signalInbox (lateral signals).
  const data = {
    role: "branch",
    systemSpec: branch.spec,
    spec: branch.spec, // kept for backwards-compat
    slot: branch.slot || "code-plan",
    path: branch.path || null,
    files: branch.files || [],
    parentProjectId: String(rootProjectId),
    parentBranch: branch.parentBranch || null,
    status: "pending",
    subPlan: { branches: [], createdAt: new Date().toISOString() },
    aggregatedDetail: {
      filesWritten: 0,
      contracts: [],
      statusCounts: { done: 0, running: 0, pending: 0, failed: 0 },
      lastActivity: null,
    },
    signalInbox: [],
    createdAt: new Date().toISOString(),
  };

  if (core?.metadata?.setExtMeta) {
    await core.metadata.setExtMeta(branchNode, "code-workspace", data);
  } else {
    await Node.updateOne(
      { _id: branchNode._id },
      { $set: { "metadata.code-workspace": data } },
    );
  }

  // Enable cascade on branch nodes too so file writes inside a branch
  // fire the kernel's propagation. The onCascade listener in code-
  // workspace handles rollup + lateral signaling.
  try {
    const cascadeData = {
      enabled: true,
      enabledAt: new Date().toISOString(),
      enabledBy: "code-workspace/swarm",
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
    log.warn("Tree Orchestrator", `Failed to enable cascade on branch ${branch.name}: ${err.message}`);
  }

  return branchNode;
}

/**
 * Mark a branch's swarm status after it runs. Lightweight metadata update
 * so later turns (or a root aggregator) can see which branches are done,
 * which failed, which are still pending.
 */
async function markBranchStatus(branchNodeId, status, summary, core) {
  const patch = {
    "metadata.code-workspace.status": status,
    "metadata.code-workspace.summary": summary || null,
    "metadata.code-workspace.finishedAt": new Date().toISOString(),
  };
  await Node.updateOne({ _id: branchNodeId }, { $set: patch });
}

/**
 * Run a whole swarm: walk branches sequentially, dispatch plan mode per
 * branch at that branch's tree position, collect results, return a
 * summary to the caller. Each branch opens its own chainIndex chat
 * records inside the same session so the dashboard groups the whole
 * swarm under one conversation.
 *
 * The `runBranch` callback is injected so this module doesn't have a
 * circular import with orchestrator.js. The orchestrator passes in a
 * closure that calls its own `runSteppedMode`.
 */
/**
 * Build a markdown plan document from a swarm result and write it to
 * `plan.md` at the project root via the code-workspace addFile export.
 * Called by the root aggregator so the user has a single readable
 * artifact showing what was built, what's pending, what failed.
 */
/**
 * Render plan.md from the DISTRIBUTED self-similar state. Walks the
 * tree recursively starting at the project root: each level's subPlan
 * contributes its own section, aggregatedDetail gets a summary line,
 * signalInbox shows recent lateral signals. Nested branches render
 * deeper heading levels.
 *
 * Each level's plan.md is the PROJECTION of that level's subPlan +
 * aggregatedDetail. The source of truth is the tree metadata; this is
 * just a human-readable view for disk consumption.
 */
async function writeSwarmPlan({
  projectNode,
  userRequest,
  userId,
  core,
}) {
  try {
    const { readSubPlan, readAggregatedDetail, readSignalInbox, readContracts } =
      await import("../code-workspace/swarmEvents.js");

    // Helper: render a node and its recursive subPlan into markdown.
    async function renderNodeSection(nodeId, depth) {
      const n = await Node.findById(nodeId).select("_id name metadata").lean();
      if (!n) return [];
      const meta = n.metadata instanceof Map
        ? n.metadata.get("code-workspace")
        : n.metadata?.["code-workspace"];
      if (!meta) return [];

      const lines = [];
      const headingLevel = Math.min(2 + depth, 6);
      const prefix = "#".repeat(headingLevel);
      const icon =
        meta.status === "done" ? "✅" :
        meta.status === "failed" ? "❌" :
        meta.status === "running" ? "🟡" : "⏳";
      const label = meta.role === "project"
        ? `${prefix} Project: ${n.name}`
        : `${prefix} ${icon} ${n.name}`;
      lines.push(label);
      lines.push("");

      if (meta.systemSpec || meta.spec) {
        lines.push(`**Spec:** ${meta.systemSpec || meta.spec}`);
      }
      if (meta.path) lines.push(`**Path:** \`${meta.path}\``);
      if (meta.files?.length) {
        lines.push(`**Files:** ${meta.files.map((f) => `\`${f}\``).join(", ")}`);
      }
      if (meta.slot) lines.push(`**LLM slot:** \`${meta.slot}\``);
      if (meta.summary) lines.push(`**Result:** ${truncate(meta.summary, 400)}`);
      if (meta.error) lines.push(`**Error:** ${meta.error}`);

      // Aggregated state under this level
      const agg = meta.aggregatedDetail;
      if (agg && (agg.filesWritten > 0 || (agg.contracts && agg.contracts.length > 0))) {
        lines.push("");
        lines.push(`**Aggregated under here:** ${agg.filesWritten || 0} files written`);
        if (agg.contracts?.length) {
          lines.push("**Established contracts:**");
          for (const c of agg.contracts.slice(-12)) {
            lines.push(`- \`${c}\``);
          }
        }
      }

      // Lateral signals received
      if (Array.isArray(meta.signalInbox) && meta.signalInbox.length > 0) {
        lines.push("");
        lines.push(`**Lateral signals received:** ${meta.signalInbox.length}`);
        for (const sig of meta.signalInbox.slice(-6)) {
          const payload = typeof sig.payload === "string" ? sig.payload : JSON.stringify(sig.payload);
          lines.push(`- from ${sig.from || "?"}: ${truncate(payload, 200)}`);
        }
      }

      lines.push("");

      // Recurse into this node's subPlan children
      const subPlan = meta.subPlan;
      if (subPlan?.branches?.length > 0 && depth < 6) {
        for (const child of subPlan.branches) {
          if (!child.nodeId) continue;
          const childLines = await renderNodeSection(child.nodeId, depth + 1);
          lines.push(...childLines);
        }
      }

      return lines;
    }

    const lines = [
      `# Project Plan: ${projectNode.name || "project"}`,
      "",
      "## Request",
      "",
      userRequest || "(no request text)",
      "",
      "## Structure",
      "",
    ];

    // Render the project root itself + walk down
    const rootSection = await renderNodeSection(projectNode._id, 0);
    // Drop the first heading line from the root (we already have a title)
    rootSection.shift();
    lines.push(...rootSection);

    // Render declared contracts as a dedicated section so the operator
    // can audit what each branch committed to. Source of truth is the
    // project root's metadata["code-workspace"].contracts — this is
    // just a projection.
    try {
      const contracts = await readContracts(projectNode._id);
      if (Array.isArray(contracts) && contracts.length > 0) {
        lines.push("");
        lines.push("## Declared API Contracts");
        lines.push("");
        lines.push("These are the field-level contracts each branch committed to.");
        lines.push("Siblings read them via enrichContext and the validator diffs new writes against them.");
        lines.push("");
        const sorted = [...contracts].sort((a, b) => {
          if (a.endpoint !== b.endpoint) return a.endpoint.localeCompare(b.endpoint);
          return a.method.localeCompare(b.method);
        });
        for (const c of sorted) {
          const by = c.declaredBy ? ` _[${c.declaredBy}]_` : "";
          const src = c.sourceFile ? ` \`${c.sourceFile}:${c.sourceLine || "?"}\`` : "";
          lines.push(`### \`${c.method} ${c.endpoint}\`${by}`);
          lines.push(`Source: ${src}`);
          const body = c.request?.body || [];
          if (body.length > 0) {
            lines.push(`- **request.body:** ${body.map((k) => `\`${k}\``).join(", ")}`);
          }
          const shape = c.response?.shape || [];
          if (shape.length > 0) {
            lines.push(`- **response:** ${shape.map((k) => `\`${k}\``).join(", ")}`);
          } else if (c.response?.inferred === "variable") {
            lines.push(`- **response:** _(dynamic — shape unknown at extraction time)_`);
          }
          lines.push("");
        }
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `plan.md contracts section skipped: ${err.message}`);
    }

    lines.push("---");
    lines.push("");
    lines.push(`_Generated ${new Date().toISOString()} by the TreeOS swarm runner._`);
    lines.push(`_Each node's subPlan and aggregatedDetail live at metadata["code-workspace"] — this file is just a projection._`);

    const content = lines.join("\n");

    const { getExtension } = await import("../loader.js");
    const cwExt = getExtension("code-workspace");
    if (!cwExt?.exports?.addFile) {
      log.warn("Tree Orchestrator", "Swarm: code-workspace.addFile unavailable — plan.md not written");
      return;
    }
    await cwExt.exports.addFile({
      projectNodeId: projectNode._id,
      relPath: "plan.md",
      content,
      userId: userId || null,
      core,
    });
    log.info("Tree Orchestrator", `📄 Swarm: wrote plan.md at ${projectNode.name} (from distributed subPlan)`);
  } catch (err) {
    log.warn("Tree Orchestrator", `Swarm: writeSwarmPlan failed: ${err.message}`);
  }
}

/**
 * Retry any failed branches from a first swarm pass. Each failed branch
 * gets ONE retry with an augmented message that includes the original
 * error. Other branches' files are now on disk, so the retry benefits
 * from cascade context (API contracts, shared data shapes) that the
 * first attempt didn't have.
 *
 * Capped: each branch gets at most ONE retry. Infinite loops are
 * impossible. If the retry also fails, the branch stays marked failed
 * and the plan.md reflects that.
 */
async function retryFailedBranches({
  results,
  branches,
  runBranch,
  rootProjectNode,
  sessionId,
  userId,
  username,
  visitorId,
  rootId,
  signal,
  slot,
  socket,
  onToolLoopCheckpoint,
  rootChatId,
  core,
  emitStatus,
  rt,
}) {
  const failed = results.filter((r) => r.status === "failed" || r.status === "error");
  if (failed.length === 0) return { retried: 0 };

  log.info("Tree Orchestrator", `🔁 Swarm retry: ${failed.length} failed branch(es) get one more shot`);

  for (const prev of failed) {
    if (signal?.aborted) break;
    const branch = branches.find((b) => b.name === prev.name);
    if (!branch) continue;

    emitStatus?.(socket, "intent", `Retry: ${branch.name}`);

    // Re-resolve the branch node (already exists from the first pass)
    const branchNode = await Node.findOne({
      parent: rootProjectNode._id,
      name: branch.name,
    });
    if (!branchNode) continue;

    // Open retry header via rt (shared chainIndex).
    const retryHeaderInput = `[retry ${branch.name}] previous error: ${prev.error || "unknown"}`;
    let retryStep = null;
    if (rt && !rt._cleaned) {
      retryStep = await rt.beginChainStep("tree:code-plan", retryHeaderInput, {
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
      `[[DONE]] when the branch's files are complete.`;

    try {
      const retryResult = await runBranch({
        mode: "tree:code-plan",
        message: retryMessage,
        branchNodeId: branchNode._id,
        slot: branch.slot || slot,
        visitorId,
        username,
        userId,
        rootId,
        signal,
        onToolLoopCheckpoint,
        socket,
      });

      // Update the corresponding result in place
      const idx = results.findIndex((r) => r.name === branch.name);
      if (idx >= 0) {
        results[idx] = {
          name: branch.name,
          status: "done",
          answer: (retryResult?.answer || "") + " (retried)",
        };
      }
      await markBranchStatus(branchNode._id, "done", retryResult?.answer || null, core);
      // Update the retry branch's subPlan entry on ITS parent. Retried
      // branches are always top-level (nested retries use the same path
      // via ensureBranchNode's parent resolution).
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
          modeKey: "tree:code-plan",
        });
      }
    } catch (err) {
      log.error("Tree Orchestrator", `Swarm retry failed for "${branch.name}": ${err.message}`);
      const idx = results.findIndex((r) => r.name === branch.name);
      if (idx >= 0) {
        results[idx] = {
          name: branch.name,
          status: "failed",
          error: err.message + " (also failed on retry)",
        };
      }
      await markBranchStatus(branchNode._id, "failed", err.message, core);
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
          modeKey: "tree:code-plan",
        });
      }
    }
  }

  return { retried: failed.length };
}

export async function runBranchSwarm({
  branches,
  rootProjectNode,
  rootChatId,
  sessionId,
  visitorId,
  userId,
  username,
  rootId,
  signal,
  slot,
  socket,
  onToolLoopCheckpoint,
  core,
  runBranch,
  emitStatus,
  userRequest,
  rt,             // OrchestratorRuntime from the active request (shared chainIndex counter)
  resumeMode = false,  // true = picking up existing branches, don't reseed subPlan
}) {
  if (!Array.isArray(branches) || branches.length === 0) {
    return { success: true, summary: "No branches to run." };
  }
  if (!rootProjectNode) {
    throw new Error("runBranchSwarm requires rootProjectNode");
  }

  log.info("Tree Orchestrator",
    `🌿 Swarm: ${resumeMode ? "resuming" : "dispatching"} ${branches.length} branches under ${rootProjectNode.name || rootProjectNode._id}`,
  );

  // Initialize the project root's self-similar state only on a FRESH
  // swarm (not a resume). Resumes inherit whatever state is already on
  // the project — done branches stay done, pending/failed/paused ones
  // are what we're re-dispatching here.
  if (!resumeMode) {
    await initProjectPlan({
      projectNodeId: rootProjectNode._id,
      systemSpec: userRequest,
      core,
    });

    // Seed the top-level subPlan with the architect's branches. Each entry
    // lives on the project root until the branch is dispatched and acquires
    // its own node. Sub-branches later land on THEIR parent branch's
    // subPlan, not the root, via upsertSubPlanEntry(parentNodeId, ...).
    for (const b of branches) {
      await upsertSubPlanEntry({
        parentNodeId: rootProjectNode._id,
        core,
        child: {
          name: b.name,
          spec: b.spec,
          path: b.path || null,
          files: b.files || [],
          slot: b.slot || "code-plan",
          status: "pending",
        },
      });
      await recordBranchEvent({ visitorId, branchName: b.name, from: null, to: "pending", reason: "queued" });
    }
  }

  const results = [];

  // Helper: begin a branch header chain step via rt so it shares the
  // global counter. Falls back to a direct startChainStep + local
  // counter only if rt is missing (non-orchestrator caller). Never
  // collides with runSteppedMode's internal chain steps because they
  // both increment rt.chainIndex atomically.
  let fallbackChainIdx = 1;
  const beginBranchHeader = async ({ input, branchNodeId }) => {
    if (rt && !rt._cleaned) {
      return rt.beginChainStep("tree:code-plan", input, {
        treeContext: branchNodeId ? { targetNodeId: branchNodeId } : undefined,
      });
    }
    const chat = await startChainStep({
      userId,
      sessionId,
      chainIndex: fallbackChainIdx++,
      rootChatId: rootChatId || null,
      modeKey: "tree:code-plan",
      source: "swarm-branch",
      input,
      treeContext: branchNodeId ? { targetNodeId: branchNodeId } : undefined,
    });
    if (!chat) return null;
    return { chatId: chat._id, chainIndex: chat.chainIndex };
  };

  const finishBranchHeader = async (step, { output, stopped = false }) => {
    if (!step?.chatId) return;
    if (rt && !rt._cleaned) {
      await rt.finishChainStep(step.chatId, {
        output,
        stopped,
        modeKey: "tree:code-plan",
      });
    } else {
      await finalizeChat({
        chatId: step.chatId,
        content: output,
        stopped,
        modeKey: "tree:code-plan",
      }).catch(() => {});
    }
  };

  // Use a queue instead of a fixed iteration. Recursive branches can
  // push onto the queue while it's being drained — a branch finishing
  // backend can declare sub-branches (auth, db, routes) that get
  // processed in the same swarm run. Same primitive as the top-level
  // fan-out: emit [[BRANCHES]]...[[/BRANCHES]] anywhere in the
  // response and they join the queue.
  //
  // Preserve parentBranch and depth from the caller if present (resume
  // mode passes resumable entries with their original parentBranch so
  // nested sub-branches re-dispatch under the right parent node, not
  // at the project root). Fresh dispatches default parentBranch=null,
  // depth=0 — architect-produced branches are always top-level.
  const queue = branches.map((b) => ({
    ...b,
    parentBranch: b.parentBranch ?? null,
    depth: b.depth ?? 0,
  }));
  let processed = 0;
  const MAX_BRANCHES = 60;    // hard cap to prevent runaway recursion
  const MAX_DEPTH = 4;        // max nested depth from the root

  while (queue.length > 0 && processed < MAX_BRANCHES) {
    if (signal?.aborted) {
      log.warn("Tree Orchestrator",
        `🛑 Swarm aborted after ${processed} branches (${queue.length} still queued). Queued branches stay "pending"; next message at this project can resume them.`,
      );
      // Mark every not-yet-dispatched branch as pending-for-resume
      // (the initial seeding already set them to pending, so this is a
      // no-op, but we make the intent explicit in case we later change
      // seeding semantics).
      for (const q of queue) {
        const parentForPlan = await resolveBranchParentId({
          rootProjectId: rootProjectNode._id,
          parentBranchName: q.parentBranch,
          hint: q.parentNodeId,
        });
        await upsertSubPlanEntry({
          parentNodeId: parentForPlan,
          core,
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

    // 1. Create / find the branch node. Nested branches hang under
    //    their parent branch node, not the project root — this is how
    //    recursive sub-branches get the right tree position. The
    //    resolver walks the whole project subtree by name so deeply-
    //    nested resumes (e.g. backend/db/migrations) land correctly.
    let branchNode;
    try {
      const parentId = await resolveBranchParentId({
        rootProjectId: rootProjectNode._id,
        parentBranchName: branch.parentBranch,
        hint: branch.parentNodeId,
      });
      branchNode = await ensureBranchNode({
        rootProjectId: parentId,
        branch,
        userId,
        core,
      });
    } catch (err) {
      log.error("Tree Orchestrator", `Swarm: failed to create branch "${qualifiedName}": ${err.message}`);
      results.push({ name: qualifiedName, status: "error", error: err.message, parentBranch: branch.parentBranch });
      continue;
    }

    // Upsert the branch onto its PARENT's subPlan. Top-level branches
    // land on the project root's subPlan; nested sub-branches land on
    // their parent branch node's subPlan. The distributed per-level
    // shape means each branch's plan lives right next to its work.
    const parentNodeForPlan = await resolveBranchParentId({
      rootProjectId: rootProjectNode._id,
      parentBranchName: branch.parentBranch,
      hint: branch.parentNodeId,
    });

    await upsertSubPlanEntry({
      parentNodeId: parentNodeForPlan,
      core,
      child: {
        name: branch.name,
        nodeId: String(branchNode._id),
        spec: branch.spec,
        path: branch.path || null,
        files: branch.files || [],
        slot: branch.slot || "code-plan",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    });
    await recordBranchEvent({ visitorId, branchName: branch.name, from: "pending", to: "running" });

    // 2. Open the branch header chain step. This records ONLY the
    //    dispatch event ("[branch N/M] name: spec") with no LLM call
    //    attached — the actual work happens inside runBranch →
    //    runSteppedMode, which creates its own chain steps per LLM call
    //    using the same rt.chainIndex counter. The header sits just
    //    before those per-call steps in the ordering.
    const branchInput = `[${branch.parentBranch ? "sub-branch" : "branch"} ${processed}/${totalKnown}] ${qualifiedName}: ${branch.spec}`;
    const branchHeaderStep = await beginBranchHeader({
      input: branchInput,
      branchNodeId: branchNode?._id,
    });
    // NOTE: we do NOT setChatContext here — the header is a label-only
    // record with no LLM call inside it. runSteppedMode will swap the
    // context itself when it begins its own chain steps inside the
    // branch dispatch.

    // 3. Dispatch the branch
    let branchResult;
    try {
      const branchMessage =
        `You are building ONE branch of a larger project.\n\n` +
        `Branch name: ${qualifiedName}\n` +
        `${branch.parentBranch ? `Parent branch: ${branch.parentBranch}\n` : ""}` +
        `Path: ${branch.path || "(project root)"}\n` +
        `Files expected: ${(branch.files || []).join(", ") || "(infer from spec)"}\n\n` +
        `Spec:\n${branch.spec}\n\n` +
        `Focus only on this branch. Write the files it needs. Do not touch ` +
        `other branches. Emit [[DONE]] when this branch's files are complete.` +
        `\n\nIf YOUR branch itself is too complex to build in one shot and ` +
        `naturally splits into sub-components, you may emit a nested ` +
        `[[BRANCHES]]...[[/BRANCHES]] block instead of building directly. ` +
        `Each sub-branch becomes a child node under this branch and runs ` +
        `as its own session. Use this ONLY when your spec genuinely has ` +
        `multiple independent pieces — not as a way to delay doing work. ` +
        `If you can finish in under ~5 files, just build directly.` +
        `\n\nThe orchestrator sees any [[BRANCHES]] block in your response ` +
        `and queues them automatically. ${branch.depth >= MAX_DEPTH - 1 ? "NOTE: you're near the max recursion depth — do NOT spawn further sub-branches. Build directly." : ""}`;

      // Per-branch AbortController. Each branch gets its own signal
      // that forwards parent aborts (user cancel, global timeout) but
      // isolates its own internal failures. If a single branch's LLM
      // errors or times out, we abort ONLY this branch's controller
      // in the catch block below — the parent signal stays clean, so
      // the next iteration of the queue can dispatch the next branch.
      //
      // Before this fix: one branch throwing "Request was aborted"
      // tripped the parent signal and killed the whole swarm mid-queue
      // (this is why persistence and tests never ran after backend
      // aborted). Now the swarm queue keeps draining after any single
      // branch failure, and only a genuine parent-signal abort
      // (ctrl-c, session close) stops the queue.
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
          mode: "tree:code-plan",
          message: branchMessage,
          branchNodeId: branchNode._id,
          slot: branch.slot || slot,
          visitorId,
          username,
          userId,
          rootId,
          signal: branchAbort.signal,
          onToolLoopCheckpoint,
          socket,
        });
      } finally {
        // Remove the forwarder listener so it doesn't keep the parent
        // signal's retainer alive across branch iterations.
        if (parentAbortListener && signal) {
          try { signal.removeEventListener("abort", parentAbortListener); } catch {}
        }
      }

      // ── Branch-done validation sweep ──
      // Re-validate every code file in the branch's subdirectory. If
      // anything is broken, override the branch's success and flip it
      // to failed so the retry loop picks it up. Append structured
      // errors to the branch's signalInbox so the next attempt
      // sees them in enrichContext.
      //
      // This is the seam closer: live afterNote validation catches
      // errors during the run (best case), and this sweep catches
      // anything that survived the run (last-write failures, budget
      // exhaustion, etc).
      const sweep = await sweepBranchValidation({
        branchNode,
        rootProjectNode,
        branchPath: branch.path,
        core,
      });

      if (!sweep.ok) {
        log.warn(
          "Tree Orchestrator",
          `🔴 Branch "${qualifiedName}" passed swarm but failed validator sweep: ${sweep.errors.length} file(s) broken. Overriding to failed for retry.`,
        );
        // Append each error as a structured cascade signal to the
        // branch. The retry loop reads them via enrichContext.
        for (const err of sweep.errors) {
          await appendSignalInbox({
            nodeId: branchNode._id,
            signal: {
              from: branchNode.name,
              kind: SIGNAL_KIND.SYNTAX_ERROR,
              filePath: err.file,
              payload: err,
            },
            core,
          });
        }
        const errSummary = sweep.errors
          .slice(0, 3)
          .map((e) => `${e.file}:${e.line} ${e.message}`)
          .join("; ");
        await markBranchStatus(branchNode._id, "failed", errSummary, core);
        results.push({
          name: qualifiedName,
          rawName: branch.name,
          parentBranch: branch.parentBranch,
          status: "failed",
          error: `validator: ${errSummary}`,
        });
        await upsertSubPlanEntry({
          parentNodeId: parentNodeForPlan,
          core,
          child: {
            name: branch.name,
            nodeId: String(branchNode._id),
            status: "failed",
            error: `validator: ${errSummary}`,
            finishedAt: new Date().toISOString(),
          },
        });
        await recordBranchEvent({ visitorId, branchName: branch.name, from: "running", to: "failed", reason: `validator: ${errSummary}` });
        // Skip the recursive [[BRANCHES]] scan and the success-path
        // upsert. Move on to the next queued branch.
        continue;
      }

      // ── Per-branch runtime smoke test ──
      // Syntax passed, now verify the branch actually runs (server
      // boots, static assets resolve, docs are well-formed). Skipped
      // for branches with no path, and for branches whose shape doesn't
      // match any supported kind. Runs in isolation — no other branches
      // needed, no waiting. Each branch validates what IT built.
      try {
        const workspaceRoot = getWorkspacePath(rootProjectNode);
        const smoke = await smokeBranch({
          workspaceRoot,
          branchPath: branch.path,
          branchName: qualifiedName,
        });
        if (smoke.skipped) {
          log.debug("Tree Orchestrator",
            `Smoke skipped for ${qualifiedName}: ${smoke.reason}`);
        } else if (!smoke.ok) {
          log.warn("Tree Orchestrator",
            `💥 Branch "${qualifiedName}" passed syntax but failed smoke: ${smoke.errors[0]?.message || "(unknown)"}`);
          for (const err of smoke.errors) {
            await appendSignalInbox({
              nodeId: branchNode._id,
              signal: {
                from: branchNode.name,
                kind: SIGNAL_KIND.RUNTIME_ERROR,
                filePath: err.file,
                payload: err,
              },
              core,
            });
          }
          const errSummary = smoke.errors
            .slice(0, 3)
            .map((e) => `${e.file}:${e.line} ${e.message}`)
            .join("; ");
          await markBranchStatus(branchNode._id, "failed", `smoke: ${errSummary}`, core);
          results.push({
            name: qualifiedName,
            rawName: branch.name,
            parentBranch: branch.parentBranch,
            status: "failed",
            error: `smoke: ${errSummary}`,
          });
          await upsertSubPlanEntry({
            parentNodeId: parentNodeForPlan,
            core,
            child: {
              name: branch.name,
              nodeId: String(branchNode._id),
              status: "failed",
              error: `smoke: ${errSummary}`,
              finishedAt: new Date().toISOString(),
            },
          });
          await recordBranchEvent({ visitorId, branchName: branch.name, from: "running", to: "failed", reason: `smoke: ${errSummary}` });
          continue;
        }
      } catch (smokeErr) {
        log.warn("Tree Orchestrator",
          `Smoke validator crashed (non-blocking) for ${qualifiedName}: ${smokeErr.message}`);
      }

      await markBranchStatus(branchNode._id, "done", branchResult?.answer || null, core);
      results.push({
        name: qualifiedName,
        rawName: branch.name,
        parentBranch: branch.parentBranch,
        status: "done",
        answer: branchResult?.answer || "",
      });
      await upsertSubPlanEntry({
        parentNodeId: parentNodeForPlan,
        core,
        child: {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: "done",
          summary: truncate(branchResult?.answer || "", 300),
          finishedAt: new Date().toISOString(),
        },
      });
      await recordBranchEvent({ visitorId, branchName: branch.name, from: "running", to: "done" });

      // Recursive expansion: if the branch's response contained a nested
      // [[BRANCHES]] block, parse it and push the sub-branches onto the
      // queue. They'll run right after any already-queued branches, at
      // an incremented depth.
      if (branch.depth < MAX_DEPTH && branchResult?.answer) {
        const nested = parseBranches(branchResult.answer);
        if (nested.branches.length > 0) {
          const subCount = nested.branches.length;
          log.info("Tree Orchestrator",
            `🌱 Swarm: branch "${qualifiedName}" spawned ${subCount} sub-branch(es): ${nested.branches.map((s) => s.name).join(", ")}`,
          );
          for (const sub of nested.branches) {
            queue.push({
              ...sub,
              parentBranch: branch.name,
              depth: branch.depth + 1,
            });
          }
          // Strip the nested block from the visible answer so it doesn't
          // confuse the final summary
          const cleanAnswer = nested.cleaned;
          const lastIdx = results.length - 1;
          if (lastIdx >= 0) results[lastIdx].answer = cleanAnswer;
        }
      }
    } catch (err) {
      // Distinguish abort (session went away, work is resumable) from
      // a real failure (LLM error, tree access, etc.). Aborted branches
      // get status "paused" so the resume detector picks them up next
      // message; real failures get "failed" so the retry loop handles
      // them.
      //
      // IMPORTANT: we only treat this as a user-side abort if the
      // PARENT signal is aborted (ctrl-c, session close). A per-branch
      // abort from the branchAbort controller above means only this
      // branch timed out or errored — the swarm should continue. An
      // error with "aborted" in its message but a clean parent signal
      // gets classified as failed, not paused.
      const parentAborted = signal?.aborted === true;
      const wasAborted = parentAborted;
      const resumableStatus = wasAborted ? "paused" : "failed";
      log.error("Tree Orchestrator",
        `Swarm: branch "${qualifiedName}" ${wasAborted ? "paused (aborted)" : "failed"}: ${err.message}`,
      );
      await markBranchStatus(branchNode._id, resumableStatus, err.message, core);
      await upsertSubPlanEntry({
        parentNodeId: parentNodeForPlan,
        core,
        child: {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: resumableStatus,
          error: err.message,
          finishedAt: new Date().toISOString(),
          ...(wasAborted ? { pausedAt: new Date().toISOString(), abortReason: err.message } : {}),
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

    // 4. Finalize the branch header with a summary. If the branch
    //    failed, mark stopped: true so the UI shows the Stopped badge.
    if (branchHeaderStep) {
      const done = results[results.length - 1];
      const headerOutput =
        done.status === "done"
          ? `✓ ${qualifiedName}: ${truncate(done.answer || "done", 200)}`
          : `✗ ${qualifiedName}: ${done.error || "failed"}`;
      await finishBranchHeader(branchHeaderStep, {
        output: headerOutput,
        stopped: done.status !== "done",
      });
    }
  }

  if (queue.length > 0) {
    if (signal?.aborted) {
      // Already logged above on the abort break; don't double-log.
    } else if (processed >= MAX_BRANCHES) {
      log.warn("Tree Orchestrator",
        `Swarm: ${queue.length} branches remained queued after MAX_BRANCHES (${MAX_BRANCHES}) cap hit`,
      );
    } else {
      log.warn("Tree Orchestrator",
        `Swarm: ${queue.length} branches remained queued (unexpected early exit)`,
      );
    }
  }

  // Alias `branches` to `results`-compatible structure for the plan
  // writer and retry code (which still expect the top-level branch list).
  // The initial top-level branches are still the authoritative spec
  // reference for the plan.md writer.

  // Root aggregator: retry any failed branches once before writing the
  // final plan. After all branches plus retries are done, write plan.md
  // at the project root so the user has a persistent artifact describing
  // what was built.
  if (!signal?.aborted) {
    await retryFailedBranches({
      results,
      branches,
      runBranch,
      rootProjectNode,
      sessionId,
      userId,
      username,
      visitorId,
      rootId,
      signal,
      slot,
      socket,
      onToolLoopCheckpoint,
      rootChatId,
      core,
      emitStatus,
      rt,
    });
  }

  // Restore context so the caller's outer finalizeChat writes to the root chat
  if (rootChatId && sessionId) {
    setChatContext(visitorId, sessionId, rootChatId);
  }

  // Walk the tree bottom-up and promote any non-done parent branches
  // whose children are now all done. This is the "work under here is
  // finished" auto-signal: when a resume run completes the last pending
  // leaf under `backend/db`, `backend/db` itself should flip to done,
  // and if that was also `backend`'s last pending child, `backend`
  // flips too. Idempotent; cheap; always correct.
  try {
    const { promoteDoneAncestors } = await import("../code-workspace/swarmEvents.js");
    await promoteDoneAncestors({
      projectNodeId: rootProjectNode._id,
      core,
    });
  } catch (err) {
    log.debug("Tree Orchestrator", `promoteDoneAncestors skipped: ${err.message}`);
  }

  // ── Cross-branch integration smoke ──
  // Only runs if EVERY branch passed its own unit smoke. Tests the
  // seams: does the frontend's fetch() hit a backend route? Mismatches
  // surface to the operator, NOT auto-retried, because the direction
  // of the fix is ambiguous (frontend or backend gives way?). The
  // mismatch signals get appended to the project root's signalInbox
  // so plan.md + the next user message both see them.
  if (!signal?.aborted) {
    const allDone = results.every((r) => r.status === "done");
    if (allDone && results.length >= 2) {
      try {
        const workspaceRoot = getWorkspacePath(rootProjectNode);
        const integration = await smokeIntegration({
          workspaceRoot,
          branches: results.map((r) => {
            const original = branches.find((b) => b.name === r.rawName);
            return {
              name: r.name,
              path: original?.path || null,
              status: r.status,
            };
          }),
        });
        if (integration.skipped) {
          log.info("Tree Orchestrator",
            `Integration smoke skipped: ${integration.reason}`);
        } else if (!integration.ok) {
          log.warn("Tree Orchestrator",
            `🔗 Integration smoke found ${integration.mismatches.length} mismatch(es) — surfacing to operator`);
          for (const mm of integration.mismatches) {
            await appendSignalInbox({
              nodeId: rootProjectNode._id,
              signal: {
                from: mm.from || "integration",
                kind: SIGNAL_KIND.CONTRACT_MISMATCH,
                filePath: null,
                payload: mm,
              },
              core,
            });
          }
        } else {
          log.info("Tree Orchestrator",
            `✅ Integration smoke passed: ${integration.probed || 0} endpoint(s) verified`);
        }
      } catch (intErr) {
        log.warn("Tree Orchestrator",
          `Integration smoke crashed (non-blocking): ${intErr.message}`);
      }
    }

    // ── Contract conformance check ──
    // When the architect declared contracts before branching, every
    // branch's actual code MUST match them. This check uses the same
    // wsSeam extractors to harvest each branch's sends/handles/fields
    // and compares them to the project-root's declaredContracts list.
    // Any violation (branch sends a type the contracts don't declare,
    // branch reads a field the contract doesn't list, etc.) is a
    // SIGNAL_KIND.CONTRACT_MISMATCH on the offending branch, flipping
    // it to failed so the retry loop can fix it with the contract
    // sitting at the top of its enrichContext.
    if (allDone && results.length >= 2) {
      try {
        const { readProjectContracts } = await import("../code-workspace/swarmEvents.js");
        const declared = await readProjectContracts(rootProjectNode._id);
        if (declared && declared.length > 0) {
          const { checkContractConformance } = await import("../code-workspace/validators/contractConformance.js");
          const workspaceRoot = getWorkspacePath(rootProjectNode);
          const conform = await checkContractConformance({
            workspaceRoot,
            branches: results.map((r) => {
              const original = branches.find((b) => b.name === r.rawName);
              return { name: r.name, path: original?.path || null, status: r.status };
            }),
            contracts: declared,
          });
          if (conform.skipped) {
            log.info("Tree Orchestrator", `Contract conformance skipped: ${conform.reason}`);
          } else if (!conform.ok) {
            log.warn("Tree Orchestrator",
              `📜 Contract conformance: ${conform.violations.length} violation(s) — flipping branches for retry`);
            // Resolve branch name → node id map
            const branchNodeByName = new Map();
            const rootSubPlan = await readSubPlan(rootProjectNode._id);
            if (rootSubPlan?.branches) {
              for (const b of rootSubPlan.branches) {
                if (b.nodeId && b.name) branchNodeByName.set(b.name, b.nodeId);
              }
            }
            const failedNames = new Set();
            for (const v of conform.violations) {
              const target = branchNodeByName.get(v.branch);
              const targets = new Set([target, String(rootProjectNode._id)].filter(Boolean));
              for (const nodeId of targets) {
                await appendSignalInbox({
                  nodeId,
                  signal: {
                    from: "contract-conformance",
                    kind: SIGNAL_KIND.CONTRACT_MISMATCH,
                    filePath: v.file || null,
                    payload: {
                      kind: v.kind,
                      branch: v.branch,
                      type: v.type,
                      field: v.field || null,
                      declaredTypes: v.declaredTypes ? v.declaredTypes.join(",") : null,
                      declaredFields: v.declaredFields ? v.declaredFields.join(",") : null,
                      message: v.message,
                    },
                  },
                  core,
                });
              }
              failedNames.add(v.branch);
            }
            for (const name of failedNames) {
              const nodeId = branchNodeByName.get(name);
              if (!nodeId) continue;
              await markBranchStatus(
                nodeId,
                "failed",
                `Contract violation: see signalInbox for details`,
                core,
              );
              const r = results.find((x) => x.rawName === name);
              if (r) {
                r.status = "failed";
                r.error = "Contract violation (see signalInbox)";
              }
            }
            log.info("Tree Orchestrator",
              `🔄 Re-running retry loop for ${failedNames.size} branch(es) flipped by contract conformance`);
            await retryFailedBranches({
              results,
              branches,
              runBranch,
              rootProjectNode,
              sessionId,
              userId,
              username,
              visitorId,
              rootId,
              signal,
              slot,
              socket,
              onToolLoopCheckpoint,
              rootChatId,
              core,
              emitStatus,
              rt,
            });
          } else {
            log.info("Tree Orchestrator",
              `✅ Contract conformance passed: all ${declared.length} declared contract(s) satisfied across branches`);
          }
        }
      } catch (ccErr) {
        log.warn("Tree Orchestrator",
          `Contract conformance crashed (non-blocking): ${ccErr.message}`);
      }
    }

    // ── WS seam static check ──
    // Complements the HTTP integration smoke above. Static analysis
    // of the WebSocket protocol between server and client branches —
    // catches the naming drift bugs (frontend sends {type:'join'},
    // backend expects 'join_room'; backend broadcasts .players,
    // frontend reads .snakes) that each branch's isolated AI session
    // invented independently.
    //
    // Mismatches land on the SPECIFIC branches involved (both
    // producer and consumer), not just the project root. The retry
    // loop then picks up both branches' signalInboxes in their next
    // enrichContext and the AI has an actionable correction.
    if (allDone && results.length >= 2) {
      try {
        const workspaceRoot = getWorkspacePath(rootProjectNode);
        const wsSeam = await smokeWsSeam({
          workspaceRoot,
          branches: results.map((r) => {
            const original = branches.find((b) => b.name === r.rawName);
            return {
              name: r.name,
              path: original?.path || null,
              status: r.status,
            };
          }),
        });
        if (wsSeam.skipped) {
          log.info("Tree Orchestrator", `WS seam check skipped: ${wsSeam.reason}`);
        } else if (!wsSeam.ok) {
          log.warn("Tree Orchestrator",
            `🔗 WS seam: ${wsSeam.mismatches.length} mismatch(es) — propagating signals to involved branches`);
          // Resolve branch name → node id once so we can append to
          // both producer and consumer inboxes.
          const branchNodeByName = new Map();
          for (const entry of results) {
            const original = branches.find((b) => b.name === entry.rawName);
            if (original?.nodeId) branchNodeByName.set(entry.rawName, original.nodeId);
          }
          // The subPlan is the source of truth for the final node
          // ids after dispatch — reconcile from there.
          const { readSubPlan } = await import("../code-workspace/swarmEvents.js");
          const rootSubPlan = await readSubPlan(rootProjectNode._id);
          if (rootSubPlan?.branches) {
            for (const b of rootSubPlan.branches) {
              if (b.nodeId && b.name) branchNodeByName.set(b.name, b.nodeId);
            }
          }
          for (const mm of wsSeam.mismatches) {
            const producerId = branchNodeByName.get(mm.fromBranch);
            const consumerId = branchNodeByName.get(mm.toBranch);
            const targets = new Set([producerId, consumerId].filter(Boolean));
            // Always append to the project root too so plan.md picks it up
            targets.add(String(rootProjectNode._id));
            for (const targetNodeId of targets) {
              await appendSignalInbox({
                nodeId: targetNodeId,
                signal: {
                  from: "ws-seam",
                  kind: SIGNAL_KIND.CONTRACT_MISMATCH,
                  filePath: mm.evidence?.clientFile || mm.evidence?.serverFile || null,
                  payload: {
                    kind: mm.kind,
                    direction: mm.direction,
                    type: mm.type,
                    field: mm.field || null,
                    fromBranch: mm.fromBranch,
                    toBranch: mm.toBranch,
                    message: mm.message,
                  },
                },
                core,
              });
            }
          }
          // Flip BOTH producer and consumer branches to failed so
          // the retry loop re-dispatches them with the mismatch
          // signal in their enrichContext. Without this the swarm
          // reports success despite the seam being broken.
          const failedNames = new Set();
          for (const mm of wsSeam.mismatches) {
            failedNames.add(mm.fromBranch);
            failedNames.add(mm.toBranch);
          }
          for (const name of failedNames) {
            const nodeId = branchNodeByName.get(name);
            if (!nodeId) continue;
            await markBranchStatus(
              nodeId,
              "failed",
              `WS seam mismatch: rename message types or payload fields to align with sibling branch`,
              core,
            );
            // Also update the result record so retryFailedBranches sees it
            const r = results.find((x) => x.rawName === name);
            if (r) {
              r.status = "failed";
              r.error = "WS seam mismatch (see signalInbox)";
            }
          }
          // The retry loop has already run above; trigger it once
          // more now that new failures exist. One extra pass is
          // enough to let the branch sessions fix the seam using
          // the mismatch signal.
          log.info("Tree Orchestrator",
            `🔄 Re-running retry loop for ${failedNames.size} branch(es) flipped by WS seam`);
          await retryFailedBranches({
            results,
            branches,
            runBranch,
            rootProjectNode,
            sessionId,
            userId,
            username,
            visitorId,
            rootId,
            signal,
            slot,
            socket,
            onToolLoopCheckpoint,
            rootChatId,
            core,
            emitStatus,
            rt,
          });
        } else {
          log.info("Tree Orchestrator",
            `✅ WS seam passed: ${wsSeam.stats?.clientSends || 0} client sends, ` +
            `${wsSeam.stats?.serverBroadcasts || 0} server broadcasts, ` +
            `${wsSeam.stats?.fieldReads || 0} field reads all matched`);
        }
      } catch (wsErr) {
        log.warn("Tree Orchestrator",
          `WS seam check crashed (non-blocking): ${wsErr.message}`);
      }
    }

    // ── Phase 4: behavioral test gate ──
    // Only runs if the project has a tests/ directory the model wrote
    // (the plan-mode prompt instructs models to write tests/spec.test.js
    // for any project complex enough to have multiple behaviors). When
    // present, runs the test file and surfaces failures as TEST_FAILURE
    // signals on the project root for the retry loop to pick up.
    //
    // Skipped silently when no tests/ exists — we don't force the model
    // to write tests for one-line scripts. The plan-mode prompt is what
    // makes the model emit them for non-trivial builds.
    if (allDone && results.length >= 1) {
      try {
        const workspaceRoot = getWorkspacePath(rootProjectNode);
        const testRun = await runBehavioralTests({
          workspaceRoot,
          projectNode: rootProjectNode,
          core,
        });
        if (testRun.skipped) {
          log.info("Tree Orchestrator",
            `Behavioral test gate skipped: ${testRun.reason}`);
        } else if (!testRun.ok) {
          log.warn("Tree Orchestrator",
            `🧪 Behavioral tests failed: ${testRun.failures.length} failure(s) — surfacing to retry loop`);
          for (const failure of testRun.failures) {
            await appendSignalInbox({
              nodeId: rootProjectNode._id,
              signal: {
                from: "behavioral-test",
                kind: SIGNAL_KIND.TEST_FAILURE,
                filePath: failure.file || "tests/spec.test.js",
                payload: failure,
              },
              core,
            });
          }
        } else {
          log.info("Tree Orchestrator",
            `✅ Behavioral tests passed: ${testRun.ran || 0} test file(s)`);
        }
      } catch (testErr) {
        log.warn("Tree Orchestrator",
          `Behavioral test runner crashed (non-blocking): ${testErr.message}`);
      }
    }
  }

  // Write the master plan.md as the root aggregator's output. Reads
  // structured branches from metadata["code-workspace"].masterPlan so
  // recursive sub-branches show up with the right nesting.
  await writeSwarmPlan({
    projectNode: rootProjectNode,
    userRequest,
    userId,
    core,
  });

  const doneCount = results.filter((r) => r.status === "done").length;
  const failCount = results.filter((r) => r.status === "failed" || r.status === "error").length;
  const summaryLines = results.map((r) => {
    const icon = r.status === "done" ? "✓" : "✗";
    return `${icon} ${r.name}${r.answer ? ` — ${truncate(r.answer, 120)}` : r.error ? ` — ${r.error}` : ""}`;
  });

  const summary =
    `Swarm complete: ${doneCount} done, ${failCount} failed, ${results.length} total branches. ` +
    `Plan written to plan.md.\n\n` +
    summaryLines.join("\n");

  log.info("Tree Orchestrator", `🌿 Swarm finished: ${doneCount}/${results.length} branches succeeded`);

  return {
    success: failCount === 0,
    summary,
    results,
  };
}

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}
