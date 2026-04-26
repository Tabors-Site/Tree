// Book Studio routes. All URLs follow /api/v1/:nodeId/bookstudio...
// so the studio adapts to wherever the user is in the tree:
//
//   GET  /api/v1/:nodeId/bookstudio            page (HTML)
//   POST /api/v1/:nodeId/bookstudio/contracts  save contracts
//   POST /api/v1/:nodeId/bookstudio/start      dispatch architect
//   GET  /api/v1/:nodeId/bookstudio/state      snapshot JSON
//   GET  /api/v1/:nodeId/bookstudio/events     SSE stream
//
// At a project root, the studio shows / drives the whole book.
// At a chapter or part branch node, the studio scopes down to that
// subtree: contracts stamp the branch's local subPlan, start dispatches
// tree:book-plan (or tree:book-write) at the branch position, state
// returns only that subtree, events filter to that subtree.

import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getExtension } from "../loader.js";
import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";
import { initProject, findProjectForNode, readMeta, mutateMeta } from "./workspace.js";
import { renderStudioPage } from "./pages/studio.js";

// htmlAuth is resolved after boot to html-rendering's urlAuth (accepts
// cookies + URL share tokens). Falls back to Bearer authenticate if
// html-rendering isn't installed.
let htmlAuth = authenticate;
export function resolveHtmlAuth() {
  const htmlExt = getExtension("html-rendering");
  if (htmlExt?.exports?.urlAuth) htmlAuth = htmlExt.exports.urlAuth;
}

// nodeId -> Set<Response>. Broadcasts deliver to any subscriber whose
// root or intermediate node is this one.
const subscribers = new Map();

// nodeId -> { controller, visitorId, startedAt, source }. One active
// run per project node at a time. Stop aborts the controller; the
// architect + swarm respect signal.aborted and bail cleanly.
// Registered from BOTH /start (studio-initiated) and handleMessage
// (CLI/orchestrator-initiated) so the studio always sees the true
// active state regardless of origin.
const activeRuns = new Map();

/**
 * Register a run against a project node, aborting any existing one on
 * that node first. Returns the AbortController the caller should use
 * for their downstream work. When the caller finishes (or errors),
 * they must call unregisterActiveRun with the same controller so a
 * newer run on the same node can take over.
 */
// Register an active run under BOTH the origin node (where the run was
// dispatched — could be a chapter for a rewrite) AND the project root
// (for top-level start / stop from the studio page). Both keys point at
// the same entry, so stopping at either key aborts the same controller.
// Without this, a chapter-rewrite run registered at the chapter is
// invisible to the project-level studio page — user hits "Stop" on the
// project page, state says no run, button disappears even though the
// rewrite is still churning in the background.
export function registerActiveRun({ nodeId, projectNodeId = null, visitorId, source }) {
  const origin = String(nodeId);
  const project = projectNodeId ? String(projectNodeId) : null;
  const keys = project && project !== origin ? [origin, project] : [origin];

  for (const k of keys) {
    const existing = activeRuns.get(k);
    if (existing && existing !== activeRuns.get(keys[0])) {
      try { existing.controller.abort(); } catch {}
      activeRuns.delete(k);
      broadcast(k, "update", `prior ${existing.source || "run"} stopped (new ${source || "run"} starting)`);
    }
  }
  const controller = new AbortController();
  const entry = {
    controller,
    visitorId,
    startedAt: new Date().toISOString(),
    source: source || "run",
    origin,
    project,
  };
  for (const k of keys) activeRuns.set(k, entry);
  broadcast(origin, "update", `${source || "run"} started`);
  return controller;
}

export function unregisterActiveRun({ nodeId, projectNodeId = null, controller }) {
  const keys = [String(nodeId)];
  if (projectNodeId && String(projectNodeId) !== String(nodeId)) keys.push(String(projectNodeId));
  for (const k of keys) {
    const current = activeRuns.get(k);
    if (current?.controller === controller) activeRuns.delete(k);
  }
}

export function getActiveRun(nodeId) {
  return activeRuns.get(String(nodeId)) || null;
}

export function broadcast(nodeId, eventName, payload) {
  const set = subscribers.get(String(nodeId));
  if (!set || set.size === 0) return;
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  const frame = `event: ${eventName}\ndata: ${data}\n\n`;
  for (const res of set) {
    try { res.write(frame); } catch {}
  }
}

function subscribe(nodeId, res) {
  const key = String(nodeId);
  let set = subscribers.get(key);
  if (!set) { set = new Set(); subscribers.set(key, set); }
  set.add(res);
  return () => {
    const s = subscribers.get(key);
    if (s) {
      s.delete(res);
      if (s.size === 0) subscribers.delete(key);
    }
  };
}

function sw() {
  return getExtension("swarm")?.exports || null;
}

// Resolve the "project root" the studio is operating under, given a
// nodeId. If the node is itself a project (book-workspace.role=project),
// that's the root. Otherwise walk ancestors to find the nearest book
// project; the studio scopes its tree view + subPlan reads to the
// incoming nodeId but inherits contracts from the project root.
async function resolveStudioContext(nodeId) {
  const node = await Node.findById(nodeId).select("_id name parent metadata").lean();
  if (!node) return null;
  const meta = readMeta(node);
  if (meta?.role === "project" && meta?.initialized) {
    return { node, project: node, scope: "project" };
  }
  const project = await findProjectForNode(nodeId);
  if (!project) {
    // Not inside a book — treat this node as the entry point; user
    // might be about to initialize a fresh book here.
    return { node, project: null, scope: "new" };
  }
  return { node, project, scope: meta?.role === "chapter" ? "chapter"
                                : meta?.role === "part" ? "part"
                                : meta?.role === "scene" ? "scene"
                                : "descendant" };
}

// Walk a subtree collecting branch children with role=chapter|part|scene,
// return them as studio "chapters" — same shape the page renders.
async function collectSubtreeBranches(startNodeId) {
  const mongoose = (await import("mongoose")).default;
  const Note = mongoose.models.Note;
  const out = [];
  const seenNames = new Set();
  const visited = new Set([String(startNodeId)]);
  const queue = [String(startNodeId)];
  let scanned = 0;
  while (queue.length > 0 && scanned < 200) {
    const id = queue.shift();
    scanned++;
    const node = await Node.findById(id).select("_id name children metadata").lean();
    if (!node) continue;
    const bwMeta = readMeta(node);
    const swMeta = node.metadata instanceof Map
      ? node.metadata.get("swarm")
      : node.metadata?.["swarm"];
    const role = bwMeta?.role || swMeta?.role;
    const isAuthorial = role === "chapter" || role === "part" || role === "scene" || role === "branch";
    if (isAuthorial && String(id) !== String(startNodeId)) {
      const notes = Note ? await Note.find({ nodeId: id })
        .sort({ createdAt: 1 }).limit(20).select("content type createdAt").lean() : [];
      out.push({
        nodeId: String(id),
        name: node.name,
        role,
        status: swMeta?.status || bwMeta?.status || "pending",
        spec: swMeta?.spec || bwMeta?.systemSpec || null,
        path: swMeta?.path || null,
        summary: swMeta?.summary || null,
        notes: notes.map(n => ({
          content: String(n.content || "").slice(0, 20000),
          type: n.type,
          createdAt: n.createdAt,
        })),
      });
      seenNames.add(node.name);
    }
    // Also surface PLANNED branch / chapter steps from this node's
    // plan that haven't been dispatched yet. Mid-run, a part's
    // architect turn emits nested [[BRANCHES]] pre-seeding
    // metadata.plan.steps with pending entries; those don't have tree
    // nodes yet but represent planned chapters. Showing them lets the
    // studio render the full TOC as soon as decomposition completes,
    // not only after each chapter dispatches. Skip steps that already
    // appeared as real tree nodes above (deduplicate by name).
    // Plan discovery routes through the plan extension's canonical
    // walk-up primitive. Under Path B the plan lives on a plan-type
    // child of the scope node.
    let planMeta = null;
    try {
      const { getExtension } = await import("../loader.js");
      const planExt = getExtension("plan")?.exports;
      if (planExt?.readPlan) planMeta = await planExt.readPlan(node._id);
    } catch {}
    const planBranches = (planMeta?.steps || []).filter(
      (s) => s.kind === "branch" || s.kind === "chapter",
    );
    if (planBranches.length > 0) {
      for (const step of planBranches) {
        if (step.childNodeId) continue; // will appear (or already did) via tree walk
        if (seenNames.has(step.title)) continue;
        seenNames.add(step.title);
        out.push({
          nodeId: null,
          name: step.title,
          role: step.mode === "tree:book-plan" ? "part" : "chapter",
          status: step.status || "pending",
          spec: step.spec || null,
          path: step.path || null,
          summary: null,
          notes: [],
        });
      }
    }
    if (Array.isArray(node.children)) {
      for (const kid of node.children) {
        const k = String(kid);
        if (!visited.has(k)) { visited.add(k); queue.push(k); }
      }
    }
  }
  return out;
}

/**
 * Parse swarm's generic dispatch message and rewrite it for book-write.
 * Pulls the branch name, parent, path, spec lines out of the generic
 * template and rebuilds them without the "Files expected" line (books
 * don't have files) and WITHOUT the optional-nested-branches escape
 * (prose chapters shouldn't decompose into sub-branches during
 * writing — the architect already chose the structure).
 */
function extractBookWriteMessage(generic) {
  const branchMatch = generic.match(/Branch name:\s*(.+)/);
  const parentMatch = generic.match(/Parent branch:\s*(.+)/);
  const pathMatch = generic.match(/Path:\s*(.+)/);
  const specMatch = generic.match(/Spec:\s*\n?([\s\S]*?)(?:\n\nFocus only|\n\nIf YOUR|$)/);

  const branch = branchMatch?.[1]?.trim() || "(unnamed)";
  const parent = parentMatch?.[1]?.trim() || null;
  const path = pathMatch?.[1]?.trim() || "(no path)";
  const spec = (specMatch?.[1] || "").trim();

  return (
    `You are writing ONE chapter (or scene) of a book.\n\n` +
    `Chapter: ${branch}\n` +
    (parent ? `Parent: ${parent}\n` : "") +
    `Tree path: ${path}\n\n` +
    `Chapter spec:\n${spec}\n\n` +
    `WRITE THE CHAPTER'S PROSE NOW via create-node-note. Your first ` +
    `action on this turn MUST be a create-node-note call with the ` +
    `chapter's full prose as its content argument. Read the declared ` +
    `contracts (characters, setting, voice) and sibling chapter summaries ` +
    `in your context FIRST, then write the chapter honoring those facts ` +
    `exactly. Target the word count the spec states. When the ` +
    `create-node-note call completes, emit [[DONE]].\n\n` +
    `Do NOT decompose this chapter into scene branches. The architect ` +
    `already chose the structure; this turn is prose-writing only. ` +
    `Do NOT emit [[BRANCHES]]. If a required contract is missing and you ` +
    `cannot work around it, emit [[NO-WRITE: exact thing missing]] and stop.`
  );
}

const router = express.Router();

// ── GET /api/v1/:nodeId/bookstudio ──────────────────────────────
// The HTML page itself. Served under /api/v1 so its state/events
// endpoints sit alongside it under the same namespace.
router.get("/:nodeId/bookstudio", (req, res, next) => htmlAuth(req, res, next), async (req, res) => {
  const { nodeId } = req.params;
  try {
    const ctx = await resolveStudioContext(nodeId);
    if (!ctx) return sendError(res, 404, ERR.NODE_NOT_FOUND, `node ${nodeId} not found`);
    const title = ctx.project
      ? (readMeta(ctx.project)?.title || ctx.project.name)
      : ctx.node.name;
    const html = renderStudioPage({
      nodeId,
      projectId: ctx.project ? String(ctx.project._id) : null,
      title,
      scope: ctx.scope,
      user: req.user || null,
      token: req.query?.token || "",
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  } catch (err) {
    log.error("BookWorkspace/routes", `studio page failed: ${err.message}`);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ── POST /api/v1/:nodeId/bookstudio/contracts ───────────────────
router.post("/:nodeId/bookstudio/contracts", authenticate, express.json(), async (req, res) => {
  const { nodeId } = req.params;
  const body = req.body || {};
  try {
    const swx = sw();
    if (!swx?.setContracts) return sendError(res, 503, ERR.INTERNAL, "swarm extension not loaded");

    const node = await Node.findById(nodeId).lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, `node ${nodeId} not found`);

    const ctx = await resolveStudioContext(nodeId);
    // If we're at a non-project node and no enclosing project, initialize
    // THIS node as the book project.
    let projectId = ctx?.project?._id ? String(ctx.project._id) : null;
    if (!projectId) {
      await initProject({
        projectNodeId: nodeId,
        title: body.title || node.name,
        description: body.premise || null,
        core: { metadata: { setExtMeta: async (n, ns, data) => {
          await Node.updateOne({ _id: n._id }, { $set: { [`metadata.${ns}`]: data } });
        } } },
      });
      if (swx.ensureProject) {
        await swx.ensureProject({ rootId: nodeId, systemSpec: body.premise || null, owner: "book-workspace" });
      }
      projectId = nodeId;
    }

    // Translate form → contract entries.
    const contracts = [];
    if (body.title) contracts.push({ kind: "title", name: "book", fields: [body.title], raw: `title: ${body.title}` });
    if (body.premise) contracts.push({ kind: "premise", name: "book", fields: [body.premise], raw: `premise: ${body.premise}` });
    if (body.sources) contracts.push({ kind: "source", name: "input", fields: [body.sources], raw: `source input: ${String(body.sources).slice(0, 120)}…` });
    for (const c of Array.isArray(body.characters) ? body.characters : []) {
      if (!c?.name) continue;
      const fields = [];
      if (c.pronouns) fields.push(c.pronouns);
      if (c.traits) fields.push(c.traits);
      contracts.push({
        kind: "character",
        name: c.name,
        pronouns: c.pronouns || null,
        fields,
        raw: `character ${c.name}: pronouns=${c.pronouns || "?"}, ${c.traits || ""}`,
      });
    }
    if (body.setting) contracts.push({ kind: "setting", name: "world", fields: [body.setting], raw: `setting: ${body.setting}` });
    if (body.voice) contracts.push({ kind: "voice", name: "narration", fields: [body.voice], raw: `voice: ${body.voice}` });
    if (body.theme) contracts.push({ kind: "theme", name: "central", fields: [body.theme], raw: `theme: ${body.theme}` });
    if (body.depth && body.depth !== "auto") {
      contracts.push({ kind: "depth", name: "preference", fields: [body.depth], raw: `depth: ${body.depth}` });
    }
    for (const ch of Array.isArray(body.chapters) ? body.chapters : []) {
      if (!ch?.slug) continue;
      contracts.push({
        kind: "seedChapter",
        name: ch.slug,
        fields: ch.premise ? [ch.premise] : [],
        raw: `chapter ${ch.slug}: ${ch.premise || ""}`,
      });
    }

    // Write contracts at the resolved project root (shared across the
    // whole book) so chapters inherit them. MERGE semantics: keep any
    // existing entries that the new submission doesn't touch, override
    // same-(kind,name) entries with the new value. This makes concurrent
    // studio runs additive — expanding chapter 1 won't wipe root's
    // characters if a second Save happens mid-run.
    const existing = (await swx.readContracts(projectId)) || [];
    const keyOf = (c) => `${c.kind}::${c.name}`;
    const merged = new Map();
    for (const c of existing) merged.set(keyOf(c), c);
    for (const c of contracts) merged.set(keyOf(c), c);
    await swx.setContracts({ scopeNodeId: projectId, contracts: [...merged.values()] });
    broadcast(nodeId, "update", `contracts saved (${contracts.length} entries)`);
    broadcast(projectId, "update", `contracts saved (${contracts.length} entries)`);
    return sendOk(res, { projectId, contracts: contracts.length });
  } catch (err) {
    log.error("BookWorkspace/routes", `contracts failed: ${err.message}`);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ── POST /api/v1/:nodeId/bookstudio/start ───────────────────────
router.post("/:nodeId/bookstudio/start", authenticate, express.json(), async (req, res) => {
  const { nodeId } = req.params;
  // `authenticate` middleware populates req.userId and req.username (not
  // req.user). Reading req.user?.username here was always undefined →
  // book chats ended up labeled "operator" instead of the actual user.
  const userId = req.userId || null;
  const username = req.username || "operator";
  try {
    const node = await Node.findById(nodeId).lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, `node ${nodeId} not found`);

    const ctx = await resolveStudioContext(nodeId);
    const projectId = ctx?.project?._id ? String(ctx.project._id) : nodeId;

    const swx = sw();
    const contracts = swx?.readContracts ? (await swx.readContracts(projectId) || []) : [];
    const premise = contracts.find(c => c.kind === "premise")?.fields?.[0]
      || contracts.find(c => c.kind === "title")?.fields?.[0]
      || node.name;
    const sources = contracts.find(c => c.kind === "source")?.fields?.[0] || "";

    // Dispatch the architect at `nodeId`. At a project root, this plans
    // the whole book. At a branch, it plans that branch's decomposition
    // (sub-scenes, or a rewrite).
    const scopeNote = ctx?.scope === "project"
      ? "Plan the whole book."
      : `Plan the decomposition for this branch ("${node.name}") — expand into sub-scenes or refine the spec.`;

    // If the form supplied "sources" (URLs, pasted text, etc.), include
    // them inline so needsIntake picks them up and the intake stage runs
    // before the architect. Otherwise it's a pre-declared-contract-only
    // dispatch and the architect works from structured fields alone.
    // Scope determines which mode dispatches. At a project root or part,
    // we run the architect (plan mode) to decompose. At a chapter or
    // scene, we run the writer directly — the architect already chose
    // the structure; this is a targeted rewrite of one node's prose.
    const isWriteScope = ctx?.scope === "chapter" || ctx?.scope === "scene";
    const dispatchMode = isWriteScope ? "tree:book-write" : "tree:book-plan";

    const userMsg = isWriteScope
      ? `Rewrite this chapter. ` +
        `Read the declared contracts at the project root (characters with ` +
        `pronouns, setting, voice, theme) and any sibling chapter summaries ` +
        `in your context. Regenerate the chapter's prose honoring those ` +
        `facts exactly. Target the word count the spec states. Call ` +
        `create-node-note with the new prose as your first action, then ` +
        `emit [[DONE]].${sources ? `\n\nAdditional source material:\n\n${sources}` : ""}`
      : sources
        ? `${scopeNote}\n\nPremise: ${premise}\n\nSources / raw input to ingest:\n\n${sources}`
        : `${scopeNote} Use the pre-declared contracts at the project root ` +
          `(characters, setting, voice, theme, depth hint). If seed chapters ` +
          `exist, honor them; extend if scope warrants. Premise: ${premise}`;

    if (!userId) {
      return sendError(res, 401, ERR.UNAUTHORIZED, "userId required to dispatch architect");
    }

    const visitorId = `bookstudio:${userId}:${nodeId}`;
    const controller = registerActiveRun({
      nodeId,
      projectNodeId: projectId,
      visitorId,
      source: "studio",
    });

    (async () => {
      try {
        const { runChat } = await import("../../seed/llm/conversation.js");

        // If we're rewriting a chapter/scene, skip intake + skip the
        // full swarm dispatch — just run tree:book-write directly at
        // the target node. Chapter-level rewrites are single-turn
        // regenerations, not decomposition + dispatch.
        if (isWriteScope) {
          broadcast(nodeId, "update", `writer thinking (tree:book-write)…`);
          const wResult = await runChat({
            userId, username,
            message: userMsg,
            mode: "tree:book-write",
            rootId: projectId,
            nodeId,
            signal: controller.signal,
            // Per-chapter rewrite lane. Fork by nodeId so different chapters
            // don't bleed into each other.
            scope: "tree",
            purpose: "rewrite",
            extra: nodeId,
            onToolResults: (results) => {
              for (const r of results || []) {
                const name = r?.toolName || r?.name || "tool";
                broadcast(nodeId, "update", `tool: ${name}`);
              }
            },
          });
          const wAnswer = (wResult?.answer || wResult?.content || "").trim();
          if (wAnswer) {
            const preview = wAnswer.length > 240 ? wAnswer.slice(0, 240) + "…" : wAnswer;
            broadcast(nodeId, "update", `writer: ${preview.replace(/\n/g, " ")}`);
          }
          broadcast(nodeId, "update", "rewrite complete");
          return; // skip the rest of the swarm dispatch flow
        }

        // STAGE 1 — INTAKE.
        // If the caller's input is raw (URLs, long text, file references,
        // ingestion-intent phrases), run tree:intake first to distill it
        // into a clean [[PREMISE]] block. Then feed that premise to the
        // architect as its actual input. Two-stage dispatch; one concern
        // per LLM turn; small-model friendly.
        const intakeExt = getExtension("intake");
        const nI = intakeExt?.exports?.needsIntake;
        const parseP = intakeExt?.exports?.parsePremise;
        let architectInput = userMsg;
        if (intakeExt && typeof nI === "function" && nI(userMsg)) {
          broadcast(nodeId, "update", `intake thinking (tree:intake)…`);
          try {
            const intakeResult = await runChat({
              userId, username,
              message: userMsg,
              mode: "tree:intake",
              rootId: String(ctx?.project?._id || nodeId),
              nodeId,
              signal: controller.signal,
              scope: "tree",
              purpose: "intake",
              onToolResults: (results) => {
                for (const r of results || []) {
                  const name = r?.toolName || r?.name || "tool";
                  broadcast(nodeId, "update", `intake tool: ${name}`);
                }
              },
            });
            const intakeAnswer = (intakeResult?.answer || intakeResult?.content || "").trim();
            if (intakeAnswer) {
              const preview = intakeAnswer.length > 240 ? intakeAnswer.slice(0, 240) + "…" : intakeAnswer;
              broadcast(nodeId, "update", `intake: ${preview.replace(/\n/g, " ")}`);
            }
            const parsed = parseP ? parseP(intakeAnswer) : { premise: null };
            if (parsed.premise) {
              architectInput =
                `Build the book described in the premise below. ` +
                `Turn this premise into [[CONTRACTS]] + [[BRANCHES]] following your normal rules. ` +
                `Honor any pre-declared contracts already at the project root; extend, don't replace.\n\n` +
                `[[PREMISE]]\n${parsed.premise}\n[[/PREMISE]]`;
              broadcast(nodeId, "update", `intake complete — passing premise to architect`);
            } else {
              broadcast(nodeId, "update", `intake returned no [[PREMISE]] block; using raw input for architect`);
            }
          } catch (intakeErr) {
            if (!controller.signal.aborted) {
              log.warn("BookWorkspace/routes", `intake stage failed (non-blocking): ${intakeErr.message}`);
              broadcast(nodeId, "update", `intake failed: ${intakeErr.message} — proceeding with raw input`);
            }
          }
        }

        // STAGE 2 — ARCHITECT.
        broadcast(nodeId, "update", `architect thinking (tree:book-plan)…`);

        const result = await runChat({
          userId, username,
          message: architectInput,
          mode: "tree:book-plan",
          rootId: String(ctx?.project?._id || nodeId),
          nodeId,
          signal: controller.signal,
          // Architect lane on this project root — per-node so each chapter
          // root (if dispatched separately) gets its own chain.
          scope: "tree",
          purpose: "architect",
          extra: nodeId,
          onToolResults: (results) => {
            for (const r of results || []) {
              const name = r?.toolName || r?.name || "tool";
              broadcast(nodeId, "update", `tool: ${name}`);
            }
          },
        });

        const answer = (result?.answer || result?.content || "").trim();
        if (answer) {
          const preview = answer.length > 240 ? answer.slice(0, 240) + "…" : answer;
          broadcast(nodeId, "update", `architect: ${preview.replace(/\n/g, " ")}`);
        }
        broadcast(nodeId, "update", "architect turn complete");

        // The architect emitted [[CONTRACTS]] / [[BRANCHES]] blocks in its
        // response. runChat is a pure LLM-turn API — it doesn't know about
        // swarm dispatch (that lives in the tree-orchestrator's dispatch
        // path). So we do it ourselves here: parse, store contracts,
        // validate branches, call runBranchSwarm with a per-branch runChat
        // closure. This is the code path dispatch.js fires automatically
        // when the orchestrator runs a mode — we replicate for background
        // book-studio runs.
        const swx = sw();
        if (!swx || !answer) return;

        const { contracts: parsedContracts } = swx.parseContracts(answer);
        if (parsedContracts.length > 0) {
          const existing = (await swx.readContracts(projectId)) || [];
          const merged = new Map();
          const keyOf = (c) => `${c.kind}::${c.name}`;
          for (const c of existing) merged.set(keyOf(c), c);
          for (const c of parsedContracts) merged.set(keyOf(c), c);
          await swx.setContracts({ scopeNodeId: projectId, contracts: [...merged.values()], userId });
          broadcast(nodeId, "update", `contracts updated (+${parsedContracts.length})`);
        }

        const { branches: parsedBranches } = swx.parseBranches(answer);
        if (parsedBranches.length === 0) {
          broadcast(nodeId, "update", "architect returned no branches — nothing to dispatch");
          return;
        }

        const projectNode = await Node.findById(projectId).lean();
        const validation = swx.validateBranches(parsedBranches, projectNode?.name);
        if (validation.errors.length > 0) {
          broadcast(nodeId, "update", `branch validation failed: ${validation.errors[0]}`);
          return;
        }

        broadcast(nodeId, "update", `dispatching ${parsedBranches.length} branches…`);

        const swarmResult = await swx.runBranchSwarm({
          branches: parsedBranches,
          rootProjectNode: projectNode,
          rootChatId: null,
          sessionId: null,
          visitorId,
          userId,
          username,
          rootId: projectId,
          signal: controller.signal,
          slot: null,
          socket: null,
          onToolLoopCheckpoint: null,
          userRequest: userMsg,
          rt: null,
          core: { metadata: { setExtMeta: async (n, ns, data) => {
            await Node.updateOne({ _id: n._id }, { $set: { [`metadata.${ns}`]: data } });
          } } },
          emitStatus: (_sock, _kind, msg) => {
            if (msg) broadcast(nodeId, "update", msg);
          },
          defaultBranchMode: "tree:book-write",
          runBranch: async ({ mode: bMode, message: bMessage, branchNodeId, slot: bSlot }) => {
            // Override swarm's generic (code-centric) dispatch message
            // with a book-specific one for tree:book-write branches.
            // The generic message mentions "Files expected" and lets the
            // model skip writing via nested [[BRANCHES]] — neither
            // applies to a prose chapter, and the permission to skip
            // was the single biggest reason chapters came back empty.
            const isWriteMode = bMode === "tree:book-write";
            const bookMessage = isWriteMode
              ? extractBookWriteMessage(bMessage)
              : bMessage;
            const bResult = await runChat({
              userId, username,
              message: bookMessage,
              mode: bMode,
              rootId: projectId,
              nodeId: branchNodeId,
              signal: controller.signal,
              // Per-branch lane — swarm forks each branch into its own chain.
              scope: "tree",
              purpose: "branch",
              extra: branchNodeId,
              onToolResults: (results) => {
                for (const r of results || []) {
                  const name = r?.toolName || r?.name || "tool";
                  broadcast(nodeId, "update", `tool: ${name}`);
                }
              },
            });
            return {
              answer: bResult?.answer || bResult?.content || "",
              content: bResult?.content || bResult?.answer || "",
            };
          },
        });

        broadcast(nodeId, "update",
          `swarm done: ${swarmResult.summary ? swarmResult.summary.split("\n")[0] : "finished"}`);
      } catch (err) {
        if (controller.signal.aborted) {
          broadcast(nodeId, "update", "stopped by user");
        } else {
          log.error("BookWorkspace/routes", `architect run failed: ${err.message}`);
          log.error("BookWorkspace/routes", err.stack?.split("\n").slice(0, 5).join("\n"));
          broadcast(nodeId, "update", `error: ${err.message}`);
        }
      } finally {
        unregisterActiveRun({ nodeId, projectNodeId: projectId, controller });
        broadcast(nodeId, "update", "run ended");
      }
    })();

    return sendOk(res, { started: true, scope: ctx?.scope, projectId });
  } catch (err) {
    log.error("BookWorkspace/routes", `start failed: ${err.message}`);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ── POST /api/v1/:nodeId/bookstudio/scout ───────────────────────
// Run the chapter scout on demand — audit every chapter in the book
// for empty content, pronoun drift, character drift, repetition loops,
// under-target drafts, prose pollution, missed chapters. Findings land
// on the project's signal inbox exactly like the post-swarm run does.
// Operators can invoke this any time to get a fresh audit without
// re-running a full swarm.
router.post("/:nodeId/bookstudio/scout", authenticate, async (req, res) => {
  const { nodeId } = req.params;
  try {
    const ctx = await resolveStudioContext(nodeId);
    const projectId = ctx?.project?._id ? String(ctx.project._id) : nodeId;
    const swx = sw();
    const planExt = (await import("../loader.js")).getExtension("plan")?.exports;
    const contracts = swx?.readContracts ? (await swx.readContracts(projectId) || []) : [];
    const planObj = planExt?.readPlan ? await planExt.readPlan(projectId) : null;

    const { scanChapters } = await import("./validators/chapterScout.js");
    broadcast(nodeId, "update", `scout starting…`);
    const scout = await scanChapters({ projectNodeId: projectId, contracts, plan: planObj });

    if (scout.skipped) {
      broadcast(nodeId, "update", `scout skipped: ${scout.reason}`);
      return sendOk(res, { skipped: true, reason: scout.reason });
    }

    // Emit signals for every finding to the appropriate node. Same
    // routing as the post-swarm scout: missed-chapter lands on the
    // project root (no chapter node exists); everything else lands
    // on the chapter's inbox.
    if (swx?.appendSignal) {
      for (const f of scout.findings) {
        const signalTargetId = f.chapterNodeId || projectId;
        await swx.appendSignal({
          nodeId: signalTargetId,
          signal: {
            from: "chapter-scout",
            kind: "coherence-gap",
            filePath: null,
            payload: f,
          },
        });
        broadcast(nodeId, "update", `scout: ${f.kind} in ${f.chapter}`);
      }
    }

    broadcast(nodeId, "update",
      scout.ok
        ? `scout passed: ${scout.scanned} chapters, 0 gaps`
        : `scout: ${scout.findings.length} finding(s) across ${scout.scanned} chapters`,
    );
    return sendOk(res, {
      ok: scout.ok,
      scanned: scout.scanned,
      findings: scout.findings,
    });
  } catch (err) {
    log.error("BookWorkspace/routes", `scout failed: ${err.message}`);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ── POST /api/v1/:nodeId/bookstudio/stop ────────────────────────
router.post("/:nodeId/bookstudio/stop", authenticate, async (req, res) => {
  const { nodeId } = req.params;
  // Primary lookup at the requested node. If nothing's there, fall back to
  // the project root — a chapter rewrite registers at both (chapter +
  // project) so either lookup finds the same entry. This is what makes
  // "stop" work from the project page when the actual run was started
  // from a chapter rewrite.
  let entry = activeRuns.get(String(nodeId));
  if (!entry) {
    try {
      const ctx = await resolveStudioContext(nodeId);
      const projectId = ctx?.project?._id ? String(ctx.project._id) : null;
      if (projectId && projectId !== String(nodeId)) {
        entry = activeRuns.get(projectId);
      }
    } catch {}
  }
  if (!entry) return sendOk(res, { stopped: false, reason: "no active run" });
  try { entry.controller.abort(); } catch {}
  // Clear both keys the entry is registered under so a fresh run can start.
  if (entry.origin) activeRuns.delete(entry.origin);
  if (entry.project) activeRuns.delete(entry.project);
  broadcast(entry.origin || nodeId, "update", "stop signal sent");
  return sendOk(res, { stopped: true });
});

// ── GET /api/v1/:nodeId/bookstudio/state ────────────────────────
router.get("/:nodeId/bookstudio/state", (req, res, next) => htmlAuth(req, res, next), async (req, res) => {
  const { nodeId } = req.params;
  try {
    const node = await Node.findById(nodeId).select("_id name children metadata").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, `node ${nodeId} not found`);

    const ctx = await resolveStudioContext(nodeId);
    const projectId = ctx?.project?._id ? String(ctx.project._id) : null;
    const projectNode = ctx?.project || null;

    // Contracts live on the project root (shared truth). Always return them.
    const swxData = projectNode
      ? (projectNode.metadata instanceof Map
          ? projectNode.metadata.get("swarm")
          : projectNode.metadata?.["swarm"])
      : null;
    const contracts = swxData?.contracts || [];

    // For a book, walk the ENTIRE subtree for authorial nodes
    // (chapter/scene roles). Books use a parts → chapters hierarchy,
    // so the project root's subPlan.branches only lists top-level
    // parts. Showing just those gives the operator no visibility
    // into the actual prose nodes. collectSubtreeBranches walks every
    // descendant with a book-workspace role and returns them flat —
    // parts included (so the user can still trigger Rewrite on a part),
    // chapters included, scenes included, every one carrying its notes.
    const chapters = await collectSubtreeBranches(nodeId);

    const bwMeta = readMeta(node);
    const title = (projectNode && readMeta(projectNode)?.title) || bwMeta?.title || node.name;

    // Same fallback as /stop — if there's no run at this node, check the
    // project root so the studio page sees chapter-originated runs too.
    const runEntry = activeRuns.get(String(nodeId))
      || (projectId && projectId !== String(nodeId) ? activeRuns.get(projectId) : null);
    return sendOk(res, {
      title, contracts, chapters,
      scope: ctx?.scope || "new",
      projectId,
      nodeId: String(node._id),
      nodeName: node.name,
      running: !!runEntry,
      runStartedAt: runEntry?.startedAt || null,
    });
  } catch (err) {
    log.error("BookWorkspace/routes", `state failed: ${err.message}`);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ── GET /api/v1/:nodeId/bookstudio/chats ────────────────────────
// Surfaces recent Chat records for the architect + branch sessions
// tied to this book project. The studio page uses this to show the
// conversation that produced (or is producing) the book.
router.get("/:nodeId/bookstudio/chats", (req, res, next) => htmlAuth(req, res, next), async (req, res) => {
  const { nodeId } = req.params;
  try {
    const ctx = await resolveStudioContext(nodeId);
    const projectId = ctx?.project?._id ? String(ctx.project._id) : String(nodeId);
    const mongoose = (await import("mongoose")).default;
    const Chat = mongoose.models.Chat;
    if (!Chat) return sendOk(res, { chats: [] });

    // Collect every descendant nodeId under the project so we can match
    // branch chats (treeContext.targetNodeId points at each branch).
    const descendants = new Set([projectId]);
    const queue = [projectId];
    let scanned = 0;
    while (queue.length > 0 && scanned < 400) {
      const id = queue.shift();
      scanned++;
      const node = await Node.findById(id).select("_id children").lean();
      if (!node) continue;
      if (Array.isArray(node.children)) {
        for (const kid of node.children) {
          const k = String(kid);
          if (!descendants.has(k)) {
            descendants.add(k);
            queue.push(k);
          }
        }
      }
    }

    const chats = await Chat.find({
      $or: [
        { "treeContext.rootId": projectId },
        { "treeContext.targetNodeId": { $in: [...descendants] } },
        { "aiContext.mode": { $regex: "^tree:book-" } },
      ],
    })
      .sort({ "startMessage.time": -1 })
      .limit(80)
      .select("_id userId sessionId chainIndex rootChatId parentChatId dispatchOrigin startMessage endMessage aiContext treeContext")
      .lean();

    const shaped = chats.map(c => ({
      id: c._id,
      mode: c.aiContext?.mode,
      chainIndex: c.chainIndex,
      dispatchOrigin: c.dispatchOrigin,
      targetNodeId: c.treeContext?.targetNodeId || null,
      startedAt: c.startMessage?.time,
      endedAt: c.endMessage?.time,
      stopped: c.endMessage?.stopped || false,
      input: (c.startMessage?.content || "").slice(0, 2000),
      output: (c.endMessage?.content || "").slice(0, 6000),
    }));

    return sendOk(res, { chats: shaped, projectId, nodeCount: descendants.size });
  } catch (err) {
    log.error("BookWorkspace/routes", `chats failed: ${err.message}`);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ── GET /api/v1/:nodeId/bookstudio/events (SSE) ─────────────────
router.get("/:nodeId/bookstudio/events", (req, res, next) => htmlAuth(req, res, next), async (req, res) => {
  const { nodeId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: update\ndata: connected\n\n`);
  const unsubscribe = subscribe(nodeId, res);
  const keepalive = setInterval(() => {
    try { res.write(`: keepalive\n\n`); } catch {}
  }, 25000);
  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});

export default router;
