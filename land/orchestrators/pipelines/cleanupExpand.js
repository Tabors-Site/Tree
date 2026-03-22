// orchestrators/pipelines/cleanupExpand.js
// Scans nodes with dense notes and expands them into subtree structure.
// Pipeline: find candidates -> scan each (tool-less) -> create branches via tree:structure -> delete notes via tree:notes.

import { OrchestratorRuntime } from "../runtime.js";
import { SESSION_TYPES } from "../../ws/sessionRegistry.js";
import Node from "../../db/models/node.js";
import Note from "../../db/models/notes.js";
import User from "../../db/models/user.js";

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const MAX_CANDIDATES_PER_RUN = 10;
const MIN_NOTE_LENGTH = 300;
const MIN_NOTE_COUNT = 3;

function parseNewBranchId(text) {
  if (!text) return null;
  const str = typeof text === "object" ? JSON.stringify(text) : String(text);
  const match = str.match(/Root ID:\s*(\S+)/);
  return match ? match[1] : null;
}

/**
 * Walk the tree and find nodes with dense notes worth scanning for expansion.
 */
async function findExpansionCandidates(rootId) {
  const candidates = [];

  async function walk(nodeId, depth) {
    if (candidates.length >= MAX_CANDIDATES_PER_RUN) return;

    const node = await Node.findById(nodeId).select("_id name type prestige children").lean();
    if (!node) return;

    const notes = await Note.find({
      nodeId: node._id,
      version: String(node.prestige ?? 0),
      contentType: "text",
    })
      .select("_id content userId")
      .lean();

    if (notes.length > 0) {
      const totalLength = notes.reduce((sum, n) => sum + (n.content?.length || 0), 0);

      if (totalLength >= MIN_NOTE_LENGTH || notes.length >= MIN_NOTE_COUNT) {
        candidates.push({
          nodeId: node._id,
          nodeName: node.name,
          nodeType: node.type || null,
          prestige: node.prestige ?? 0,
          children: node.children || [],
          notes,
          totalLength,
        });
      }
    }

    if (node.children?.length && depth < 6) {
      for (const childId of node.children) {
        if (candidates.length >= MAX_CANDIDATES_PER_RUN) break;
        await walk(childId, depth + 1);
      }
    }
  }

  await walk(rootId, 0);
  candidates.sort((a, b) => b.totalLength - a.totalLength);
  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

export async function orchestrateExpand({
  rootId,
  userId,
  username,
  source = "orchestrator",
}) {
  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username,
    visitorId: `cleanup-expand:${rootId}:${Date.now()}`,
    sessionType: SESSION_TYPES.CLEANUP_EXPAND,
    description: `Cleanup expand: ${rootId}`,
    modeKeyForLlm: "tree:cleanup-expand-scan",
    source,
    lockNamespace: "cleanup-expand",
  });

  const initialized = await rt.init();
  if (!initialized) {
    console.log(`Cleanup expand already running for tree ${rootId}, skipping`);
    return { success: false, error: "already running", sessionId: null };
  }

  console.log(`Cleanup expand started for tree ${rootId}`);

  try {
    // STEP 1: FIND CANDIDATE NODES
    const candidates = await findExpansionCandidates(rootId);

    if (candidates.length === 0) {
      console.log("No dense notes found, nothing to expand");
      rt.setResult("No expansion candidates", "cleanup-expand:complete");
      return { success: true, expanded: 0, sessionId: rt.sessionId };
    }

    console.log(`Found ${candidates.length} candidate node(s) with dense notes`);

    let totalExpansions = 0;

    // STEP 2: SCAN + EXPAND EACH CANDIDATE
    for (const candidate of candidates) {
      if (rt.aborted) break;

      // Resolve child names for context
      let childrenNames = [];
      if (candidate.children.length > 0) {
        const childNodes = await Node.find({ _id: { $in: candidate.children } })
          .select("name")
          .lean();
        childrenNames = childNodes.map((c) => c.name);
      }

      // Resolve usernames for notes
      const notesWithUsernames = [];
      for (const note of candidate.notes) {
        let noteUsername = "system";
        if (note.userId) {
          const noteUser = await User.findById(note.userId).select("username").lean();
          if (noteUser) noteUsername = noteUser.username;
        }
        notesWithUsernames.push({ ...note, username: noteUsername });
      }

      // SCAN PHASE (tool-less)
      const { parsed: scanPlan } = await rt.runStep("tree:cleanup-expand-scan", {
        prompt: `Evaluate the notes for "${candidate.nodeName}" and determine if any should be expanded into subtree structure.`,
        modeCtx: {
          nodeName: candidate.nodeName,
          nodeId: candidate.nodeId,
          nodeType: candidate.nodeType,
          notes: notesWithUsernames,
          childrenNames,
        },
        input: `Scan "${candidate.nodeName}" (${candidate.notes.length} notes, ${candidate.totalLength} chars)`,
      });

      if (!scanPlan?.expansions?.length) {
        console.log(`  "${candidate.nodeName}", notes are fine, no expansion needed`);
        continue;
      }

      // EXECUTE EXPANSIONS
      for (const expansion of scanPlan.expansions) {
        if (rt.aborted) break;

        // Create branch via tree:structure
        const { parsed: buildData, raw: buildResult } = await rt.runStep("tree:structure", {
          prompt: `Create this branch structure under the current node: ${JSON.stringify(expansion.newBranch)}. Reason: ${expansion.reason}`,
          modeCtx: { targetNodeId: candidate.nodeId },
          input: `Create branch "${expansion.newBranch?.name}" under "${candidate.nodeName}"`,
          treeContext: (data) => ({ targetNodeId: candidate.nodeId, stepResult: data ? "success" : "failed" }),
        });

        if (!buildData) {
          console.warn(`  Failed to create branch for expansion in "${candidate.nodeName}"`);
          continue;
        }

        // Transfer original note to new branch via tree:notes
        if (expansion.deleteOriginalNote && expansion.noteId) {
          const newBranchId = parseNewBranchId(buildResult?.answer || buildResult);

          if (newBranchId) {
            await rt.runStep("tree:notes", {
              prompt: `Transfer note ${expansion.noteId} to node ${newBranchId}. Its content has been expanded into that branch structure.`,
              modeCtx: {
                targetNodeId: candidate.nodeId,
                prestige: candidate.prestige,
              },
              input: `Transfer note ${expansion.noteId} to ${newBranchId}`,
              treeContext: (data) => ({ targetNodeId: candidate.nodeId, stepResult: data ? "success" : "failed" }),
            });
          } else {
            // Fallback: delete if we couldn't parse the new branch ID
            await rt.runStep("tree:notes", {
              prompt: `Delete note ${expansion.noteId}. Its content has been expanded into a new branch structure.`,
              modeCtx: {
                targetNodeId: candidate.nodeId,
                prestige: candidate.prestige,
              },
              input: `Delete note ${expansion.noteId} (fallback)`,
              treeContext: (data) => ({ targetNodeId: candidate.nodeId, stepResult: data ? "success" : "failed" }),
            });
          }
        }

        totalExpansions++;
        console.log(`  Expanded note in "${candidate.nodeName}" -> branch "${expansion.newBranch?.name}"`);
      }
    }

    rt.setResult(`Expanded ${totalExpansions} note(s) across ${candidates.length} candidate(s)`, "cleanup-expand:complete");
    console.log(`Cleanup expand complete: ${totalExpansions} expansion(s)`);
    return { success: true, expanded: totalExpansions, sessionId: rt.sessionId };
  } catch (err) {
    console.error(`Cleanup expand error for tree ${rootId}:`, err.message);
    rt.setError(err.message, "cleanup-expand:complete");
    return { success: false, error: err.message, sessionId: rt.sessionId };
  } finally {
    await rt.cleanup();
  }
}
