/**
 * LLM scout — semantic cross-branch seam verifier.
 *
 * Runs as the `swarm:runScouts` handler. Where the static validators
 * (contractConformance, wsSeam, symbolCoherence, deadReceivers,
 * behavioralTest, smoke) catch structural / syntactic mismatches, the
 * scout catches SEMANTIC ones — things like:
 *
 *   - "menu.js exports beginGame() but game.js calls startRound()"
 *   - "the render branch uses canvas id #game but index.html has #gameCanvas"
 *   - "the game loop starts but never calls draw()"
 *   - "CONTRACT says fetch returns { score, level } but audio.js destructures { points, stage }"
 *
 * The static validators can't see those — they're about MEANING, not
 * regex matches. The scout is a read-only LLM that loads a snapshot of
 * every done-branch's files + the declared contracts and reports
 * structured findings. Its findings get appended to the offending
 * branch's signal inbox as CONTRACT_MISMATCH signals, and the branch's
 * result.status is flipped to "failed" so the swarm's redeploy loop
 * gives that branch another pass with the scout's feedback in context.
 *
 * Scope per call: one LLM call reads the entire project surface. If the
 * project is so large that file contents blow past the context window,
 * the scout falls back to reading file heads + contracts only. For 10
 * branches of ~200-line files that's still within one call.
 *
 * Emits one `swarmScoutReport` WebSocket event per issue found so the
 * narration in the UI renders as: "⚠ scout·menu: <detail>".
 */

import fs from "fs/promises";
import path from "path";
import log from "../../../seed/log.js";
import { SIGNAL_KIND } from "../swarmEvents.js";
import { SWARM_WS_EVENTS } from "../../swarm/wsEvents.js";

const MAX_FILE_BYTES = 18000;
const MAX_PROJECT_BYTES = 90000;
const SCOUT_TIMEOUT_MS = 120000;

/**
 * Run the scout. Called from code-workspace's swarm:runScouts handler.
 *
 *   runScout({
 *     cycle, rootProjectNode, results, branches, workspaceRoot,
 *     contracts, socket, core, issueSummary, branchNodeByName,
 *   })
 *
 * `issueSummary` is the mutable array swarm passes in — we push one
 * entry per finding so swarm can count and route.
 *
 * Returns { issuesFound, clean } for logging.
 */
export async function runScout({
  cycle,
  rootProjectNode,
  results,
  branches,
  workspaceRoot,
  contracts,
  socket,
  core,
  issueSummary,
  branchNodeByName,
}) {
  if (!workspaceRoot || !Array.isArray(results) || results.length === 0) {
    return { issuesFound: 0, clean: true, skipped: true, reason: "no workspace or results" };
  }

  // Only scout branches that actually finished cleanly — flipped
  // branches are already being redeployed.
  const targets = results.filter((r) => r.status === "done");
  if (targets.length < 2) {
    return { issuesFound: 0, clean: true, skipped: true, reason: "need ≥2 done branches" };
  }

  // Load a snapshot of every branch's files. Pulls file contents off
  // the real disk at workspaceRoot/<branch.path> so the scout sees
  // what's actually shipped, not what's in the tree model.
  let snapshot;
  try {
    snapshot = await loadProjectSnapshot({ workspaceRoot, branches, targets });
  } catch (err) {
    log.warn("CodeScout", `snapshot load failed: ${err.message}`);
    return { issuesFound: 0, clean: true, skipped: true, reason: err.message };
  }

  if (snapshot.totalBytes === 0) {
    return { issuesFound: 0, clean: true, skipped: true, reason: "no file content" };
  }

  const contractsText = formatContractsForScout(contracts);
  const prompt = buildScoutPrompt({
    cycle,
    contracts: contractsText,
    snapshot,
    targets,
  });

  let llmAnswer;
  try {
    const { runChat } = await import("../../../seed/llm/conversation.js");
    const scoutVisitor = `scout:${String(rootProjectNode._id).slice(0, 8)}:c${cycle}`;
    const chatPromise = runChat({
      userId: null,
      username: "scout",
      message: prompt,
      mode: "tree:code-ask",
      rootId: null,
      nodeId: String(rootProjectNode._id),
      visitorId: scoutVisitor,
      ephemeral: true,
      llmPriority: "INTERACTIVE",
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("scout LLM call timed out")), SCOUT_TIMEOUT_MS),
    );
    const result = await Promise.race([chatPromise, timeoutPromise]);
    llmAnswer = (result?.answer || result?.content || "").toString();
  } catch (err) {
    log.warn("CodeScout", `LLM call failed: ${err.message}`);
    return { issuesFound: 0, clean: true, skipped: true, reason: `llm: ${err.message}` };
  }

  const issues = parseScoutReport(llmAnswer);
  if (issues.length === 0) {
    return { issuesFound: 0, clean: true };
  }

  // Validate each issue names a real branch; drop ones that don't.
  const knownBranchNames = new Set(targets.map((r) => r.rawName || r.name));
  const valid = issues.filter((i) => knownBranchNames.has(i.branch));

  // Route each issue to the target branch: append as a signal, flip
  // the result status so the redeploy loop picks it up.
  const swarm = await getSwarm();
  const flipped = new Set();
  for (const issue of valid) {
    const targetBranchName = issue.branch;
    const targetNodeId = branchNodeByName?.get(targetBranchName) || null;

    // Append the scout finding to the branch's inbox so its next
    // retry turn sees it in enrichContext. Uses existing signal
    // plumbing — renders through formatSignalInbox's coherence-gap
    // or contract-mismatch renderer depending on kind.
    if (swarm?.appendSignal && targetNodeId) {
      try {
        await swarm.appendSignal({
          nodeId: targetNodeId,
          signal: {
            from: "scout",
            kind: issue.kind === "coherence-gap"
              ? SIGNAL_KIND.COHERENCE_GAP
              : SIGNAL_KIND.CONTRACT_MISMATCH,
            filePath: issue.file || null,
            payload: {
              kind: issue.kind === "coherence-gap" ? "coherence-gap" : issue.kind,
              scoutCycle: cycle,
              message: issue.detail,
              detail: issue.detail,
              branch: targetBranchName,
              toBranch: targetBranchName,
              fromBranch: issue.counterpartBranch || null,
              file: issue.file || null,
              line: issue.line || null,
              suggestion: issue.suggestion || null,
            },
          },
          core,
        });
      } catch (err) {
        log.warn("CodeScout", `append signal failed for ${targetBranchName}: ${err.message}`);
      }
    }

    // Flip the result so swarm's retry sees it needs a redeploy.
    const idx = results.findIndex((r) => (r.rawName || r.name) === targetBranchName);
    if (idx >= 0 && results[idx].status === "done") {
      results[idx] = {
        ...results[idx],
        status: "failed",
        error: `scout found: ${issue.detail.slice(0, 160)}`,
      };
      flipped.add(targetBranchName);
    }

    // Push to issueSummary so swarm's loop counts + routes this cycle.
    issueSummary.push({
      branch: targetBranchName,
      kind: issue.kind,
      detail: issue.detail,
      targetBranch: issue.counterpartBranch || null,
    });

    // Narrate this issue live. Clients render the line in chat.
    try {
      socket?.emit?.(SWARM_WS_EVENTS.SCOUT_REPORT, {
        cycle,
        branch: targetBranchName,
        kind: issue.kind,
        detail: issue.detail,
        counterpartBranch: issue.counterpartBranch || null,
        file: issue.file || null,
        projectNodeId: String(rootProjectNode._id),
      });
    } catch {}
  }

  log.info("CodeScout",
    `🔍 cycle ${cycle}: ${valid.length} issue(s), ${flipped.size} branch(es) flipped for redeploy`,
  );

  return { issuesFound: valid.length, clean: false, flipped: [...flipped] };
}

/**
 * Walk each target branch's directory on disk, build a bounded
 * snapshot { branchName → [{ file, bytes, head }] }. Respects per-file
 * and total byte caps so the scout prompt stays under context limits
 * even on big projects.
 */
async function loadProjectSnapshot({ workspaceRoot, branches, targets }) {
  const byBranch = new Map();
  let totalBytes = 0;
  let truncated = false;

  for (const r of targets) {
    const original = branches.find((b) => b.name === (r.rawName || r.name));
    const branchPath = original?.path || "";
    const rel = branchPath === "." ? "" : branchPath;
    const abs = path.join(workspaceRoot, rel);

    let files;
    try {
      files = await walkFiles(abs, /* depth */ 4);
    } catch {
      continue;
    }
    const entries = [];
    for (const filePath of files) {
      if (totalBytes >= MAX_PROJECT_BYTES) { truncated = true; break; }
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        if (stat.size > MAX_FILE_BYTES * 2) continue; // skip huge files
        const content = await fs.readFile(filePath, "utf8");
        const relName = path.relative(workspaceRoot, filePath);
        const head = content.length > MAX_FILE_BYTES
          ? content.slice(0, MAX_FILE_BYTES) + `\n\n/* ... truncated (${content.length - MAX_FILE_BYTES} more bytes) ... */`
          : content;
        entries.push({ file: relName, bytes: content.length, content: head });
        totalBytes += head.length;
      } catch {}
    }
    byBranch.set(r.rawName || r.name, entries);
  }

  return { byBranch, totalBytes, truncated };
}

async function walkFiles(root, depth = 4) {
  const out = [];
  if (depth < 0) return out;
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.name === "node_modules") continue;
    if (e.name === "dist" || e.name === "build") continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      const sub = await walkFiles(full, depth - 1);
      out.push(...sub);
    } else if (e.isFile()) {
      // Only text-ish sources. Skip binary.
      if (/\.(js|ts|mjs|cjs|jsx|tsx|json|html|css|md|py)$/.test(e.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

function formatContractsForScout(contracts) {
  if (!Array.isArray(contracts) || contracts.length === 0) {
    return "(no declared contracts)";
  }
  const lines = [];
  for (const c of contracts.slice(0, 50)) {
    const by = c.declaredBy ? ` [by ${c.declaredBy}]` : "";
    const src = c.sourceFile ? ` (${c.sourceFile}:${c.sourceLine || "?"})` : "";
    const header = c.method && c.endpoint
      ? `${c.method} ${c.endpoint}${by}${src}`
      : `${c.kind || "contract"} ${c.name || ""}${by}${src}`.trim();
    lines.push(header);
    if (Array.isArray(c.fields) && c.fields.length > 0) {
      lines.push(`  fields: ${c.fields.join(", ")}`);
    }
    if (c.request?.body?.length) lines.push(`  request.body: ${c.request.body.join(", ")}`);
    if (c.response?.shape?.length) lines.push(`  response: ${c.response.shape.join(", ")}`);
  }
  return lines.join("\n");
}

function buildScoutPrompt({ cycle, contracts, snapshot, targets }) {
  const projectBody = [];
  for (const [branchName, entries] of snapshot.byBranch.entries()) {
    if (entries.length === 0) continue;
    projectBody.push(`\n### BRANCH: ${branchName}`);
    for (const e of entries) {
      projectBody.push(`\n--- FILE: ${e.file} (${e.bytes} bytes) ---\n${e.content}`);
    }
  }

  const branchList = targets.map((r) => r.rawName || r.name).join(", ");
  const truncNote = snapshot.truncated
    ? "\nNOTE: project exceeds scout budget; some files were omitted. Report only issues you can verify from the visible content."
    : "";

  return `You are the SCOUT for a multi-branch code swarm (cycle ${cycle}).

Your job: read the declared contracts and every branch's shipped code,
then report the cross-branch SEAM MISMATCHES that would cause the
integrated project to fail at runtime. You are the bee that walks
between flowers. You do NOT write code. You only report.

## WHAT COUNTS AS A MISMATCH

Real mismatches only. Things that would cause a runtime bug or a
contract violation. Examples:

- Branch A exports a function with one name, branch B imports it with a
  different name (classic symbol drift).
- Branch A returns { score, level } but branch B destructures
  { points, stage }.
- Branch A sends a WebSocket message with type "start" but branch B's
  switch has no case for "start".
- Branch A declares a canvas id #game in index.html but branch B writes
  document.getElementById("gameCanvas").
- Branch A reads data.playerName but the declared contract has no such
  field on that message.
- A branch's code depends on a setup step another branch was supposed
  to do, but that other branch never writes it.

NOT mismatches: style choices, minor inefficiencies, missing tests,
unused imports, things you'd merely prefer differently.

## SCOPE THESE BRANCHES

${branchList}

## DECLARED CONTRACTS

${contracts}

## PROJECT CODE
${truncNote}
${projectBody.join("\n")}

## OUTPUT FORMAT

Emit a [[SCOUT_REPORT]]...[[/SCOUT_REPORT]] block. Inside, one issue
per line with this exact shape:

  issue: branch=<branch-with-the-bug> kind=<kind> counterpart=<other-branch-or-empty> file=<file-path-or-empty> line=<n-or-empty>
    detail: <one-sentence description of the exact mismatch>
    fix: <one-line concrete fix suggestion>

Valid kinds: "coherence-gap" (symbol/name drift), "contract-mismatch"
(field/shape drift), "wire-mismatch" (WS / fetch seam), "missing-wire"
(one side doesn't emit what the other reads).

If there are NO real mismatches, emit a single line inside the block:
  CLEAN

Rules:
- Only report mismatches you can point to with a specific file+line or
  a specific function/field name. No vague "this branch looks off".
- If a "mismatch" is actually the contract being wrong, report it
  against the branch that declared the contract with kind=contract-mismatch
  and name the affected field in detail.
- ONE issue per line. Do NOT group.
- Max 10 issues per cycle — pick the most impactful ones.
- Keep each detail and fix to ONE sentence.

Close with [[DONE]].`.trim();
}

/**
 * Parse a [[SCOUT_REPORT]] block into structured issues. Tolerant of
 * missing fields; drops lines that don't at least name a branch and
 * a detail.
 */
export function parseScoutReport(text) {
  if (typeof text !== "string" || !text) return [];
  const openIdx = text.search(/\[\[?\s*scout[_ ]report\s*\]?\]/i);
  if (openIdx === -1) return [];
  const afterOpen = text.slice(openIdx);
  const closeMatch = afterOpen.match(/\[\[?\s*\/\s*scout[_ ]report\s*\]?\]/i);
  const body = closeMatch
    ? afterOpen.slice(afterOpen.indexOf("\n") + 1, closeMatch.index)
    : afterOpen.slice(afterOpen.indexOf("\n") + 1);

  const lines = body.split("\n");
  const issues = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^clean$/i.test(line)) return [];

    const issueMatch = line.match(/^issue\s*:\s*(.+)$/i);
    if (issueMatch) {
      if (current && current.branch && current.detail) issues.push(current);
      current = parseIssueHeader(issueMatch[1]);
      continue;
    }

    const detailMatch = line.match(/^detail\s*:\s*(.+)$/i);
    if (detailMatch && current) {
      current.detail = detailMatch[1].trim();
      continue;
    }

    const fixMatch = line.match(/^fix\s*:\s*(.+)$/i);
    if (fixMatch && current) {
      current.suggestion = fixMatch[1].trim();
      continue;
    }
  }
  if (current && current.branch && current.detail) issues.push(current);
  return issues.slice(0, 10);
}

function parseIssueHeader(body) {
  const out = { branch: "", kind: "contract-mismatch", counterpartBranch: "", file: "", line: null };
  const parts = body.split(/\s+/);
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const key = p.slice(0, eq).toLowerCase();
    const val = p.slice(eq + 1);
    if (key === "branch") out.branch = val;
    else if (key === "kind") out.kind = val;
    else if (key === "counterpart") out.counterpartBranch = val;
    else if (key === "file") out.file = val;
    else if (key === "line") {
      const n = parseInt(val, 10);
      if (Number.isFinite(n)) out.line = n;
    }
  }
  return out;
}

async function getSwarm() {
  try {
    const { getExtension } = await import("../../loader.js");
    return getExtension("swarm")?.exports || null;
  } catch {
    return null;
  }
}
