import log from "../../seed/log.js";
import { initProject, findProjectForNode, stampRole, countLeafChapters, readMeta, mutateMeta } from "./workspace.js";
import { broadcast, resolveHtmlAuth, registerActiveRun, unregisterActiveRun } from "./routes.js";
import { scanChapters } from "./validators/chapterScout.js";

import planMode from "./modes/plan.js";
import writeMode from "./modes/write.js";
import coachMode from "./modes/coach.js";
import reviewMode from "./modes/review.js";
import askMode from "./modes/ask.js";
// Typed Workers — see code-workspace's equivalent block for the
// architecture. dispatch consults governing.lookupWorkerMode() which
// reads the registry registerWorkspaceWorkerTypes() populates below.
import bookWorkerBuild from "./modes/workerBuild.js";
import bookWorkerRefine from "./modes/workerRefine.js";
import bookWorkerReview from "./modes/workerReview.js";
import bookWorkerIntegrate from "./modes/workerIntegrate.js";

async function swarm() {
  const { getExtension } = await import("../loader.js");
  return getExtension("swarm")?.exports || null;
}

// Set metadata.modes.respond on a book project node so the orchestrator's
// position-hold fires at that node. Any message there routes into
// book-workspace's modes (book-coach as default; tense suffix routing
// redirects to book-plan / book-review / book-log as appropriate).
// Without this, follow-ups like "yes proceed with the collection"
// fall through to tree:converse.
async function setBookResponseMode(nodeId) {
  if (!nodeId) return;
  const { default: NodeModel } = await import("../../seed/models/node.js");
  try {
    await NodeModel.updateOne(
      { _id: nodeId },
      { $set: { "metadata.modes.respond": "tree:book-coach" } },
    );
  } catch (err) {
    log.debug("BookWorkspace", `setBookResponseMode failed: ${err.message}`);
  }
}

// Walk up from a node to find its root (any ancestor whose own parent
// is null). Used by afterNote/afterNodeCreate to decide which project
// any SSE subscribers get notified about.
async function findRootOf(nodeId) {
  if (!nodeId) return null;
  const { default: Node } = await import("../../seed/models/node.js");
  let cursor = String(nodeId);
  let guard = 0;
  while (cursor && guard < 24) {
    const n = await Node.findById(cursor).select("_id parent").lean();
    if (!n) return null;
    if (!n.parent) return String(n._id);
    cursor = String(n.parent);
    guard++;
  }
  return null;
}

export async function init(core) {
  try {
    core.llm?.registerRootLlmSlot?.("book-plan");
    core.llm?.registerRootLlmSlot?.("book-write");
    core.llm?.registerRootLlmSlot?.("book-coach");
    core.llm?.registerRootLlmSlot?.("book-review");
    core.llm?.registerRootLlmSlot?.("book-ask");
  } catch {}

  core.modes.registerMode("tree:book-plan", planMode, "book-workspace");
  core.modes.registerMode("tree:book-write", writeMode, "book-workspace");
  core.modes.registerMode("tree:book-coach", coachMode, "book-workspace");
  core.modes.registerMode("tree:book-review", reviewMode, "book-workspace");
  core.modes.registerMode("tree:book-ask", askMode, "book-workspace");

  // Typed Workers. dispatch routes leaf groups here by workerType.
  core.modes.registerMode("tree:book-worker-build", bookWorkerBuild, "book-workspace");
  core.modes.registerMode("tree:book-worker-refine", bookWorkerRefine, "book-workspace");
  core.modes.registerMode("tree:book-worker-review", bookWorkerReview, "book-workspace");
  core.modes.registerMode("tree:book-worker-integrate", bookWorkerIntegrate, "book-workspace");

  // Register with governing's worker-type registry so dispatch finds
  // these typed Workers when resolving a leaf-group's workerType.
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (governing?.registerWorkspaceWorkerTypes) {
      governing.registerWorkspaceWorkerTypes("book-workspace", {
        build:     { modeKey: "tree:book-worker-build" },
        refine:    { modeKey: "tree:book-worker-refine" },
        review:    { modeKey: "tree:book-worker-review" },
        integrate: { modeKey: "tree:book-worker-integrate" },
        // Decomposition hints. The Planner reads these when planning
        // at any scope where book-workspace is active. Prose is
        // production work, not parallel engineering — defaulting to
        // branch-per-section mistakes the shape and stacks sub-Ruler
        // overhead onto atomic prose. The shape book Planners should
        // gravitate to:
        _decompositionHints: {
          defaultShape: "single-leaf-with-internal-structure",
          branchWhen:
            "Only when sections are genuinely independent surveys / anthologies / multi-author pieces. NOT for ordered chapters where one prose flow could carry the work.",
          leafWhen:
            "Default. A chapter, an essay, a section — emit one build leaf with a substantive spec describing the structure. The Worker writes the full prose as ONE note. Internal headings live inside the prose, not as branch decompositions.",
          integrateWhen:
            "Only when multiple sibling sub-Rulers produced separately-authored prose that genuinely needs unifying (e.g., an anthology with chapter prose by different sub-Rulers, where references must be coalesced). Skip integrate when the parent's research-notes already aggregated sources OR there are no sibling outputs to unify.",
          antiPatterns: [
            "branch-per-section for a single-authored chapter — sub-Ruler tax with no parallelism benefit",
            "integrate step at the end of every chapter — research-notes already aggregates citations; the Worker's prose carries inline citations",
            "splitting research → outline → prose into three leaves when one build leaf can produce well-structured prose directly",
            "creating a 'chapter-outline' leaf as scaffolding — the outline is in the spec, not a separate artifact",
          ],
          example:
            "A 4-chapter book: ROOT plan has 4 branch entries (one per chapter, each with a ONE-paragraph spec describing what the chapter covers, target word count, voice). Each chapter Ruler then emits a SINGLE build leaf whose spec describes the chapter's internal structure (intro, sections, conclusion as bullets within the spec). The book Worker writes the entire chapter as one prose note. References emerge inline; if a coalesced references node is needed, that's a root-level integrate leaf, not a per-chapter one.",
        },
      });
      log.info("BookWorkspace",
        "Registered typed Workers with governing: build/refine/review/integrate");
    }
  } catch (err) {
    log.warn("BookWorkspace", `worker-type registration failed: ${err.message}`);
  }

  try {
    core.llm?.registerModeAssignment?.("tree:book-plan", "book-plan");
    core.llm?.registerModeAssignment?.("tree:book-write", "book-write");
    core.llm?.registerModeAssignment?.("tree:book-coach", "book-coach");
    core.llm?.registerModeAssignment?.("tree:book-review", "book-review");
    core.llm?.registerModeAssignment?.("tree:book-ask", "book-ask");
    // Typed Workers reuse existing slots: build/refine/integrate use
    // book-write's slot (same writing-model profile); review uses
    // book-review's slot. Operators can override per type once they
    // care to.
    core.llm?.registerModeAssignment?.("tree:book-worker-build", "book-write");
    core.llm?.registerModeAssignment?.("tree:book-worker-refine", "book-write");
    core.llm?.registerModeAssignment?.("tree:book-worker-review", "book-review");
    core.llm?.registerModeAssignment?.("tree:book-worker-integrate", "book-write");
  } catch {}

  // enrichContext — inject book-workspace context at every node under
  // a book project.
  //   - At a chapter branch: position breadcrumb, declared contracts,
  //     sibling chapter summaries.
  //   - At the project root: TOC summary.
  core.hooks.register("enrichContext", async ({ context, meta, nodeId, rootId, dumpMode }) => {
    const bwData = meta?.["book-workspace"] || null;
    if (!bwData) return;

    // Pending premise from intake — populated by handleMessage when it
    // ran the intake drone. Inject into this turn's context and clear
    // the stash so subsequent turns don't re-inject it. One-shot.
    if (bwData?.pendingPremise?.premise) {
      const pending = bwData.pendingPremise;
      context.incomingPremise = pending.premise;
      context.incomingPremiseFields = pending.fields || {};
      try {
        await mutateMeta(nodeId, (draft) => {
          delete draft.pendingPremise;
          return draft;
        }, null);
      } catch {}
    }

    // Contracts flow from swarm — book-workspace contracts (characters,
    // setting, voice) are stored at metadata.swarm.contracts by the
    // architect mode when it emits [[CONTRACTS]].
    try {
      const sw = await swarm();
      if (sw?.readContracts) {
        let contracts = await sw.readContracts(nodeId);
        if (!contracts && rootId && rootId !== nodeId) {
          contracts = await sw.readContracts(rootId);
        }
        if (Array.isArray(contracts) && contracts.length > 0) {
          context.declaredContracts = contracts;
        }
      }
    } catch (err) {
      log.debug("BookWorkspace", `contracts enrichContext skipped: ${err.message}`);
    }

    // Position breadcrumb at chapter / scene nodes.
    if (bwData.role === "chapter" || bwData.role === "scene") {
      try {
        const pieces = [];
        pieces.push(`Role: ${bwData.role}`);
        if (bwData.title) pieces.push(`Title: ${bwData.title}`);
        if (bwData.targetWordCount) pieces.push(`Target: ~${bwData.targetWordCount} words`);
        if (bwData.order != null) pieces.push(`Order: ${bwData.order}`);
        if (bwData.lastDraftAt) pieces.push(`Last draft: ${bwData.lastDraftAt}`);
        context.bookPosition = pieces.join("\n");
      } catch {}
    }

    // Sibling chapters — actual prose from already-written siblings.
    let siblingData = null;
    if ((bwData.role === "chapter" || bwData.role === "scene" || bwData.role === "part") &&
        !dumpMode) {
      try {
        const sw = await swarm();
        if (sw?.readSiblingBranches) {
          const siblings = await sw.readSiblingBranches(nodeId, {
            includeNotes: true,
            maxNoteLength: 3000,
            maxDescendants: 40,
          });
          if (Array.isArray(siblings) && siblings.length > 0) {
            siblingData = siblings;
          }
        }
      } catch (err) {
        log.debug("BookWorkspace", `sibling enrichContext skipped: ${err.message}`);
      }
    }

    // TOC injection — ALWAYS at project, chapter, scene, and part roles.
    // The TOC lives on the PROJECT's subPlan; chapters need to see the full
    // list (prior + current + upcoming) so they know where they sit in the
    // arc, don't duplicate upcoming content, and don't drift from the
    // declared structure.
    const isInBook = ["project", "chapter", "scene", "part"].includes(bwData.role);
    if (isInBook) {
      try {
        // Walk to the project root and read the authoritative plan.
        // Branch kind steps are the chapter list. Map step shape back
        // to the legacy "branch entry" shape renderTOC expects so we
        // don't have to rewrite the TOC renderer.
        const project = bwData.role === "project"
          ? { _id: nodeId }
          : await findProjectForNode(nodeId);
        const planExt = (await import("../loader.js")).getExtension("governing")?.exports;
        if (project && planExt?.readPlan) {
          const planObj = await planExt.readPlan(project._id);
          const chapters = (planObj?.steps || [])
            .filter((s) => s.kind === "branch" || s.kind === "chapter")
            .map((s) => ({
              name: s.title,
              nodeId: s.childNodeId || null,
              status: s.status,
              spec: s.spec,
              path: s.path || null,
              files: s.files || [],
              summary: s.summary || null,
            }));
          if (chapters.length > 0) {
            context.bookTOC = renderTOC(chapters, String(nodeId));
            context.bookTOCEntries = chapters;
          }
        }
      } catch (err) {
        log.debug("BookWorkspace", `TOC enrichContext skipped: ${err.message}`);
      }
    }

    // Merge sibling prose into recency-ordered prior/current/upcoming view.
    // Sibling readSiblingBranches only returns chapters that exist as tree
    // nodes (have been dispatched already). Upcoming chapters are just spec
    // entries in the TOC. We render them differently.
    if (bwData.role !== "project" && Array.isArray(context.bookTOCEntries)) {
      try {
        const toc = context.bookTOCEntries;
        const currentIdx = toc.findIndex(b => b.nodeId && String(b.nodeId) === String(nodeId));
        const siblingByName = new Map();
        for (const s of siblingData || []) siblingByName.set(s.name, s);

        const priorChapters = [];
        const upcomingChapters = [];
        for (let i = 0; i < toc.length; i++) {
          const entry = toc[i];
          if (currentIdx !== -1 && i === currentIdx) continue;
          const payload = {
            name: entry.name,
            spec: entry.spec,
            status: entry.status,
          };
          if (currentIdx === -1 || i < currentIdx) {
            // Prior — attach actual prose if a sibling matches
            const sib = siblingByName.get(entry.name);
            if (sib) {
              payload.nodes = sib.nodes || [];
              payload.summary = sib.summary;
              payload.recency = currentIdx === -1
                ? "far" : (currentIdx - i) === 1 ? "immediate" : (currentIdx - i) <= 3 ? "near" : "far";
            }
            priorChapters.push(payload);
          } else {
            // Upcoming — spec only
            upcomingChapters.push(payload);
          }
        }
        context.priorChapters = priorChapters;
        context.upcomingChapters = upcomingChapters;
      } catch (err) {
        log.debug("BookWorkspace", `TOC merge skipped: ${err.message}`);
      }
    }
  });

  // Render the TOC with ✓ (done) / ▶ (you are here) / ⏳ (pending) markers.
  function renderTOC(entries, currentNodeId) {
    const lines = [];
    for (const b of entries.slice(0, 80)) {
      const isHere = b.nodeId && String(b.nodeId) === String(currentNodeId);
      const icon = isHere ? "▶" :
        b.status === "done" ? "✓" :
        b.status === "failed" ? "✗" :
        b.status === "running" ? "🟡" : "⏳";
      const hereTag = isHere ? " ← YOU ARE WRITING THIS" : "";
      lines.push(`${icon} ${b.name}${b.spec ? " — " + String(b.spec).slice(0, 180) : ""}${hereTag}`);
    }
    return lines.join("\n");
  }

  // swarm:afterProjectInit — a swarm project was just initialized under
  // book-workspace's territory. Stamp our own role + title so the book
  // compiler and enrichContext have our metadata.
  core.hooks.register("swarm:afterProjectInit", async ({ projectNode, owner, systemSpec }) => {
    if (!projectNode?._id) return;
    try {
      // Only adopt as a book if we're the extension that handled the
      // initiating message. The swarm owner hint tells us.
      if (owner && owner !== "book-workspace" && owner?.owner !== "book-workspace") {
        // Different domain's project. Leave alone.
        return;
      }
      await initProject({
        projectNodeId: projectNode._id,
        title: projectNode.name || "book",
        description: systemSpec || null,
        core,
      });
      await setBookResponseMode(projectNode._id);
      log.info("BookWorkspace", `Initialized book project at ${projectNode.name || projectNode._id}`);
    } catch (err) {
      log.warn("BookWorkspace", `afterProjectInit failed: ${err.message}`);
    }
  });

  // swarm:afterBranchComplete — a chapter (or scene, or part) branch
  // finished. Stamp its role on our namespace so enrichContext + the
  // review mode can find it. Role inference:
  //   - leaf branch (no children, has note content) → "chapter" or "scene"
  //   - internal branch (has child branches) → "part"
  // The distinction is cheap: look at children.
  core.hooks.register("swarm:afterBranchComplete", async ({ branchNode, rootProjectNode, branch, result }) => {
    if (!branchNode?._id) return;
    try {
      const project = await findProjectForNode(branchNode._id);
      if (!project) return; // not a book-workspace project
      const { default: Node } = await import("../../seed/models/node.js");
      const node = await Node.findById(branchNode._id).select("children").lean();
      const hasChildren = Array.isArray(node?.children) && node.children.length > 0;
      // A part is a branch whose role is to decompose; a chapter/scene
      // writes prose. If the branch's mode was tree:book-plan, it's a
      // decomposer (= part). Otherwise it's a leaf writer.
      const isPart = branch?.mode === "tree:book-plan" || hasChildren;
      await stampRole({
        nodeId: branchNode._id,
        role: isPart ? "part" : "chapter",
        title: branch?.name || node?.name || null,
        core,
      });
      await mutateMeta(branchNode._id, (draft) => {
        draft.lastDraftAt = new Date().toISOString();
        if (result?.summary) draft.lastSummary = String(result.summary).slice(0, 400);
        return draft;
      }, core);
    } catch (err) {
      log.debug("BookWorkspace", `afterBranchComplete stamp skipped: ${err.message}`);
    }
  });

  // Prose length cap. Before every create-node-note / edit-node-note
  // call targeting a chapter node, check the chapter's existing prose
  // against its declared targetWordCount. If prose is already over the
  // cap (target * 1.5), reject the tool call with a redirect instruction.
  // This stops runaway repetition loops where the model writes the
  // same closing phrase dozens of times trying to end the chapter.
  const CHARS_PER_WORD_EST = 6;
  const PROSE_CAP_MULTIPLIER = 1.5;
  core.hooks.register("beforeToolCall", async ({ toolName, args, cancel }) => {
    if (toolName !== "create-node-note" && toolName !== "edit-node-note") return;
    const targetNodeId = args?.nodeId || args?.branchId || null;
    if (!targetNodeId) return;

    // Reject notes containing swarm control markers — these are legacy
    // CONTROL SYNTAX from before the structured-emission cutover and
    // should never land in a note body. If they do, the book compiler
    // renders them verbatim and the reader sees "[[BRANCHES]] branch:
    // ch06..." as literal text in the book. Cancel the tool call so
    // the model re-emits without markers.
    const content = typeof args?.content === "string" ? args.content : null;
    if (content && /\[\[\s*\/?\s*(branches|contracts|premise)\s*\]\]/i.test(content)) {
      cancel(
        "Note content contains control markers ([[BRANCHES]], [[CONTRACTS]], or [[PREMISE]]). " +
        "These are parser directives; they must NEVER appear inside prose the book compiler will render. " +
        "If you meant to decompose into scene branches, DON'T call create-node-note AT ALL on this turn — " +
        "emit your [[BRANCHES]] block in the response text instead, then [[DONE]]. " +
        "If you meant to write the chapter, rewrite the note with the control markers stripped out — " +
        "the scenes inside your prose are narrative scenes, not dispatch blocks.",
      );
      return;
    }

    try {
      const { default: NodeModel } = await import("../../seed/models/node.js");
      const node = await NodeModel.findById(targetNodeId).select("metadata").lean();
      const bwMeta = node?.metadata instanceof Map
        ? node.metadata.get("book-workspace")
        : node?.metadata?.["book-workspace"];
      if (!bwMeta?.role || (bwMeta.role !== "chapter" && bwMeta.role !== "scene")) return;
      const target = bwMeta.targetWordCount;
      if (!target || !Number.isFinite(target) || target <= 0) return;

      const mongoose = (await import("mongoose")).default;
      const Note = mongoose.models.Note;
      if (!Note) return;
      const existingNotes = await Note.find({ nodeId: targetNodeId }).select("content").lean();
      const currentChars = existingNotes.reduce((n, note) => n + String(note.content || "").length, 0);
      const capChars = target * CHARS_PER_WORD_EST * PROSE_CAP_MULTIPLIER;

      if (currentChars > capChars) {
        const approxWords = Math.round(currentChars / CHARS_PER_WORD_EST);
        cancel(
          `This chapter already has ~${approxWords} words, over its ${Math.round(target * PROSE_CAP_MULTIPLIER)} word cap (target ${target}). ` +
          `Do NOT write more prose. Emit [[DONE]] immediately. If you were about to write a closing phrase or ` +
          `repeat earlier material, stop — the chapter's scope is spent. The next chapter will pick up where you end.`,
        );
      }
    } catch (err) {
      log.debug("BookWorkspace", `prose cap check skipped: ${err.message}`);
    }
  });

  // swarm:afterAllBranchesComplete — run the chapter scout across every
  // written chapter. Pure-code detectors: empty chapters (status done
  // but no prose), repetition loops (terminal-loop failure mode),
  // way-under-target drafts. Findings land on the chapter's inbox as
  // COHERENCE_GAP signals so the retry turn sees an actionable fix.
  core.hooks.register("swarm:afterAllBranchesComplete", async ({ rootProjectNode, results }) => {
    if (!rootProjectNode?._id) return;
    try {
      const project = await findProjectForNode(rootProjectNode._id);
      if (!project) return;
      const done = results.filter((r) => r.status === "done").length;
      const failed = results.filter((r) => r.status === "failed" || r.status === "error").length;
      log.info("BookWorkspace",
        `📖 Book "${project.name}" — ${done} chapters done, ${failed} failed. Read with /api/v1/root/${project._id}/book`,
      );
      broadcast(project._id, "update", `book complete: ${done} done, ${failed} failed`);

      // Chapter scout pass. Code-workspace's symbolCoherence catches
      // JS-level gaps; this scout catches prose-level gaps (empty
      // chapters, repetition loops, under-target drafts, pronoun drift).
      try {
        const sw = (await import("../loader.js")).getExtension("swarm")?.exports;
        const planExt = (await import("../loader.js")).getExtension("governing")?.exports;
        const contracts = sw?.readContracts ? await sw.readContracts(project._id) : [];
        const planObj = planExt?.readPlan ? await planExt.readPlan(project._id) : null;
        const scout = await scanChapters({ projectNodeId: project._id, contracts, plan: planObj });
        if (scout.skipped) {
          log.debug("BookWorkspace", `chapter scout skipped: ${scout.reason}`);
        } else if (!scout.ok) {
          log.warn("BookWorkspace",
            `🔍 Chapter scout: ${scout.findings.length} issue(s) across ${scout.scanned} chapters`);
          if (sw?.appendSignal) {
            for (const f of scout.findings) {
              // missed-chapter findings have no chapterNodeId (never
              // dispatched). Land those signals on the PROJECT root so
              // the operator sees them and the next reconcile picks
              // the entry up. All other findings land on their chapter.
              const signalTargetId = f.chapterNodeId || String(project._id);
              await sw.appendSignal({
                nodeId: signalTargetId,
                signal: {
                  from: "chapter-scout",
                  kind: "coherence-gap",
                  filePath: null,
                  payload: f,
                },
                core,
              });
              // Flip the corresponding result to failed (if there is
              // one) so swarm's retry loop re-dispatches. For
              // missed-chapter (no result entry), there's nothing to
              // flip — the next Start will reconcile and dispatch it.
              const r = results.find((x) => x.rawName === f.chapter || x.name === f.chapter);
              if (r && r.status === "done") {
                r.status = "failed";
                r.error = `scout: ${f.kind}`;
              }
              broadcast(project._id, "update",
                `scout: ${f.kind} in ${f.chapter}`);
            }
          }
        } else {
          log.info("BookWorkspace",
            `✅ Chapter scout passed: ${scout.scanned} chapters, no gaps found`);
        }
      } catch (err) {
        log.warn("BookWorkspace", `chapter scout crashed (non-blocking): ${err.message}`);
      }
    } catch (err) {
      log.debug("BookWorkspace", `afterAllBranchesComplete skipped: ${err.message}`);
    }
  });

  // Studio SSE broadcasts. Fire when a new node is created or a note
  // is written; the listener decides whether the change belongs to a
  // book project by walking to the root.
  core.hooks.register("afterNodeCreate", async ({ node }) => {
    try {
      const rootId = await findRootOf(node._id);
      if (!rootId) return;
      const project = await findProjectForNode(rootId);
      if (!project) return;
      broadcast(rootId, "update", `node created: ${node.name}`);
    } catch {}
  });

  core.hooks.register("afterNote", async ({ note, node }) => {
    try {
      const nodeId = note?.nodeId || node?._id;
      if (!nodeId) return;
      const rootId = await findRootOf(nodeId);
      if (!rootId) return;
      const project = await findProjectForNode(rootId);
      if (!project) return;
      const len = note?.content ? String(note.content).length : 0;
      broadcast(rootId, "update", `note saved on ${node?.name || nodeId} (${len}b)`);
    } catch {}
  });

  // After-boot wiring: resolve htmlAuth for the page route + register
  // the tree quick-link slot. Spatial scoping means the slot only
  // renders where book-workspace is active.
  core.hooks.register("afterBoot", async () => {
    try { resolveHtmlAuth(); } catch {}
    try {
      const { getExtension } = await import("../loader.js");
      const treeos = getExtension("treeos-base");
      treeos?.exports?.registerSlot?.(
        "tree-quick-links",
        "book-workspace",
        ({ rootId }) =>
          `<a href="/api/v1/${rootId}/bookstudio" class="back-link">Book Studio</a>`,
        { priority: 26, requiresScaffolding: true },
      );
    } catch (err) {
      log.debug("BookWorkspace", `afterBoot wiring skipped: ${err.message}`);
    }
  });

  // Surface the router so the loader mounts it at /api/v1. Also expose
  // workspace helpers + handleMessage (the orchestrator's pre-dispatch
  // intercept point where we run the intake drone for raw input).
  const { default: router } = await import("./routes.js");
  return {
    router,
    exports: {
      findProjectForNode,
      initProject,
      stampRole,
      countLeafChapters,
      handleMessage,
    },
  };
}

export { findProjectForNode, initProject, stampRole, countLeafChapters };

/**
 * handleMessage — called by the orchestrator BEFORE mode dispatch
 * whenever a message routes to book-workspace. Used to run the intake
 * drone as stage 1 when the user's input is raw (URL, long text, file
 * reference, ingestion-intent phrases). The distilled premise gets
 * stashed on the project node's metadata.book-workspace.pendingPremise;
 * enrichContext picks it up on the architect's turn and injects it into
 * the prompt, then clears the stash so it only fires once.
 *
 * Returns:
 *   null                       — no intake needed; orchestrator proceeds normally
 *   { mode: "tree:book-plan" } — intake ran and stashed a premise; orchestrator
 *                                dispatches plan mode which sees the premise
 *                                in its enrichContext
 */
export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  if (typeof message !== "string" || !message) return null;

  const { getExtension } = await import("../loader.js");
  const intakeExt = getExtension("intake");
  const needsIntakeFn = intakeExt?.exports?.needsIntake;
  const parsePremise = intakeExt?.exports?.parsePremise;
  if (typeof needsIntakeFn !== "function" || typeof parsePremise !== "function") return null;
  if (!needsIntakeFn(message)) return null;

  const projectId = targetNodeId || rootId;
  if (!projectId || !userId) return null;

  // Ensure the project exists so we have somewhere to stash the premise
  // and a place for the architect to land. If the caller's at a fresh
  // tree root with no book-workspace metadata, promote it.
  try {
    const { default: NodeModel } = await import("../../seed/models/node.js");
    const node = await NodeModel.findById(projectId).select("name metadata").lean();
    if (!node) return null;
    const bwMeta = node.metadata instanceof Map
      ? node.metadata.get("book-workspace")
      : node.metadata?.["book-workspace"];
    if (!bwMeta?.role) {
      await initProject({
        projectNodeId: projectId,
        title: node.name,
        description: message.slice(0, 500),
        core: { metadata: { setExtMeta: async (n, ns, data) => {
          await NodeModel.updateOne({ _id: n._id }, { $set: { [`metadata.${ns}`]: data } });
        } } },
      });
      // Self-promote the project to Ruler via governing. swarm-mechanism
      // bookkeeping (inbox, aggregatedDetail, events) initializes when
      // swarm.runBranchSwarm dispatches branches at this scope.
      const governing = getExtension("governing")?.exports;
      if (governing?.promoteToRuler) {
        await governing.promoteToRuler({
          nodeId: projectId,
          reason: `book-workspace project init: ${message.slice(0, 80)}`,
          promotedFrom: governing.PROMOTED_FROM?.ROOT,
        });
      }
    }
    // ALWAYS re-pin the response mode, even if the project was
    // initialized before this handler existed. Idempotent and cheap.
    // Without this, pre-existing book projects that predate the
    // position-hold feature would keep falling through to converse.
    await setBookResponseMode(projectId);
  } catch (err) {
    log.debug("BookWorkspace", `handleMessage project-init skipped: ${err.message}`);
  }

  // Register in the shared activeRuns store so the studio page sees
  // the CLI-initiated run as active, can show the Stop button, and can
  // actually abort it by clicking Stop. Any prior run on this project
  // (from either entry point) gets aborted first.
  const cliVisitorId = `book-cli:${userId}:${projectId}`;
  const controller = registerActiveRun({
    nodeId: projectId,
    projectNodeId: projectId,
    visitorId: cliVisitorId,
    source: "cli",
  });

  try {
    const { runChat } = await import("../../seed/llm/conversation.js");
    log.info("BookWorkspace", `🐝 Intake dispatched for raw input (${message.length} chars)`);
    broadcast(projectId, "update", `intake thinking (tree:intake)…`);
    const intakeResult = await runChat({
      userId, username,
      message,
      mode: "tree:intake",
      rootId: rootId || projectId,
      nodeId: projectId,
      // Tree-scoped intake lane — chains across intake runs on this project.
      scope: "tree",
      purpose: "intake",
      signal: controller.signal,
      onToolResults: (results) => {
        for (const r of results || []) {
          const name = r?.toolName || r?.name || "tool";
          broadcast(projectId, "update", `intake tool: ${name}`);
        }
      },
    });
    const intakeAnswer = (intakeResult?.answer || intakeResult?.content || "").trim();
    if (intakeAnswer) {
      const preview = intakeAnswer.length > 240 ? intakeAnswer.slice(0, 240) + "…" : intakeAnswer;
      broadcast(projectId, "update", `intake: ${preview.replace(/\n/g, " ")}`);
    }
    const parsed = parsePremise(intakeAnswer);

    if (parsed?.premise) {
      await mutateMeta(projectId, (draft) => {
        draft.pendingPremise = {
          premise: parsed.premise,
          fields: parsed.fields || {},
          distilledAt: new Date().toISOString(),
          sourceMessage: message.slice(0, 400),
        };
        return draft;
      }, null);
      log.info("BookWorkspace", `🐝 Intake produced premise (${parsed.premise.length} chars); forcing tree:book-plan`);
      broadcast(projectId, "update", `intake complete — premise stashed, architect next`);
    } else {
      log.warn("BookWorkspace", `Intake returned no [[PREMISE]] block — architect will run on raw input`);
      broadcast(projectId, "update", `intake returned no premise; architect will work from raw input`);
    }
  } catch (err) {
    if (controller.signal.aborted) {
      broadcast(projectId, "update", `intake aborted by stop signal`);
    } else {
      log.warn("BookWorkspace", `Intake stage failed (non-blocking): ${err.message}`);
      broadcast(projectId, "update", `intake error: ${err.message}`);
    }
  } finally {
    // Unregister — the architect stage that follows (dispatched by the
    // orchestrator, not by us) runs outside this handleMessage scope.
    // The shared activeRuns store is for observability + cooperative
    // abort; once we hand off to the orchestrator via { mode: ... },
    // the orchestrator's own session/abort plumbing takes over.
    unregisterActiveRun({ nodeId: projectId, projectNodeId: projectId, controller });
    broadcast(projectId, "update", `intake stage ended`);
  }

  return { mode: "tree:book-plan" };
}
