// Worker flag tools.
//
// Workers (the four typed variants — Build, Refine, Review,
// Integrate) call governing-flag-issue when they encounter a contract
// issue during their work: missing vocabulary, ambiguity, conflict,
// a needed sibling artifact, or a forward-looking gap. The flag
// accumulates on the parent Ruler's queue. Pass 2 courts adjudicate
// when they run; Pass 1 just accumulates.
//
// governing-read-pending-issues is the Ruler's read tool — it fetches
// the full queue when the Ruler needs to judge against accumulated
// material (typically before synthesizing a build summary at
// swarm-completed).

import { z } from "zod";
import Space from "../../seed/models/space.js";
import log from "../../seed/system/log.js";
import {
  FLAG_KINDS,
  readPendingIssues,
} from "./state/flagQueue.js";

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

// Cap on free-text fields so a runaway model doesn't write a novella
// into a flag. The Pass 2 court reads these — terse is better than
// verbose; the artifactContext carries the precise location.
const LOCAL_CHOICE_CAP = 2000;
const PROPOSED_RESOLUTION_CAP = 2000;
const FIELD_CAP = 200;

/**
 * Resolve the Ruler scope to attach the flag to. The flag's owning
 * Ruler is the nearest Ruler scope at or above the caller's current
 * node. Workers run at their own scope (which IS a Ruler scope after
 * promotion), so the resolve typically lands on the caller's own
 * node id.
 */
async function resolveRulerForFlag(spaceId) {
  if (!spaceId) return null;
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (governing?.findRulerScope) {
      return await governing.findRulerScope(spaceId);
    }
  } catch {}
  // Fall back: read the node directly and check if it's a Ruler.
  const direct = await Space.findById(spaceId).select("_id name metadata").lean();
  if (!direct) return null;
  const meta = direct.metadata instanceof Map
    ? Object.fromEntries(direct.metadata)
    : (direct.metadata || {});
  return meta?.governing?.role === "ruler" ? direct : null;
}

// Infer the workerType from the active role name at this scope. Worker
// roles follow the convention "worker-<type>" (build/refine/review/integrate)
// or "<workspace>-worker-<type>". Best-effort — if the role name doesn't
// fit the pattern, we return null and sourceWorker.workerType stays null.
function inferWorkerTypeFromRole(roleName) {
  if (typeof roleName !== "string") return null;
  const m = roleName.match(/worker-([a-z]+)$/);
  return m ? m[1] : null;
}

export default function getFlagTools(_core) {
  return [
    // ───────────────────────────────────────────────────────────────
    // governing-flag-issue
    //
    // Workers call this when they encounter a contract issue during
    // their work. The flag accumulates on the parent Ruler's queue
    // for future court adjudication. Workers continue their work
    // after flagging — the tool does NOT halt the turn or escalate
    // immediately (Pass 1 has no court yet).
    //
    // "blocking" in Pass 1 is a severity marker, not an actual halt.
    // Workers that flag blocking still make a local choice and
    // continue; the severity tells future courts that this issue was
    // judged "should not have been resolvable locally" at the time
    // of flagging. Once Pass 2 courts exist, blocking flags can
    // trigger immediate court convening.
    // ───────────────────────────────────────────────────────────────
    {
      name: "governing-flag-issue",
      verb: "do",
      description:
        "Flag a contract issue you encountered during your work. Use when " +
        "you hit ambiguity, missing vocabulary, conflict, a needed sibling " +
        "artifact, or a forward-looking gap that the parent scope's contracts " +
        "didn't cover. The flag accumulates on the Ruler's queue; Pass 2 courts " +
        "will adjudicate. Flagging does NOT halt your turn — make a local " +
        "choice, document it in localChoice, continue your work. The flag is " +
        "your honest report of what you discovered.\n\n" +
        "Five kinds carve real joints:\n" +
        "  • missing-contract — vocabulary the parent didn't commit but " +
        "you needed (e.g., type names two siblings ended up redeclaring).\n" +
        "  • contract-ambiguity — the contract names a thing but leaves an " +
        "axis open (e.g., event name committed but transport not pinned).\n" +
        "  • contract-conflict — two contracted commitments disagree at the " +
        "integration surface.\n" +
        "  • discovered-dependency — you needed a sibling-scope artifact " +
        "that the contracts didn't expose (e.g., a type defined in core/).\n" +
        "  • discovered-need — vocabulary gap that wasn't blocking THIS work " +
        "but would help future scopes (forward-looking).\n\n" +
        "proposedResolution is optional. If you have a clear view of the " +
        "right answer, include it. If you don't, omit — courts decide what " +
        "should have been; you report what you observed and chose.",
      schema: {
        kind: z.enum(FLAG_KINDS).describe(
          "One of: missing-contract, contract-ambiguity, contract-conflict, " +
          "discovered-dependency, discovered-need. Pick the kind that best " +
          "matches what you encountered.",
        ),
        artifactContext: z.object({
          file: z.string().optional().describe(
            "The file where the issue surfaced (relative path within this scope).",
          ),
          function: z.string().optional().describe(
            "Optional: the function or symbol the issue was inside.",
          ),
          scope: z.string().optional().describe(
            "The Ruler scope name where you were working (e.g. branch name " +
            "for sub-Rulers, project name at root).",
          ),
        }).describe(
          "Where the issue surfaced. The richer this is, the more useful " +
          "Pass 2 courts can be — they read artifactContext to determine " +
          "which scope the ruling should apply to.",
        ),
        localChoice: z.string().describe(
          "What you did in response. Be specific: 'redeclared the ToolConfig " +
          "interface inline at tools/types.ts because core hadn't exported it', " +
          "'used a CustomEvent on document because no transport was specified', " +
          "etc. This is what the court reads when adjudicating drift.",
        ),
        blocking: z.boolean().describe(
          "True = you judged this as 'should not be locally resolvable'. " +
          "In Pass 1, blocking is a severity marker — make a local choice and " +
          "continue anyway. In Pass 2 (future), blocking flags can trigger " +
          "immediate court convening.",
        ),
        proposedResolution: z.string().optional().describe(
          "Optional: your view on the right answer, if you have one. Skip " +
          "if you don't — Workers shouldn't invent rationalizations.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { beingId, spaceId, role: roleName } = args;
        if (!spaceId) {
          return text("governing-flag-issue: no spaceId in context; substrate bug.");
        }

        // Validate fields explicitly so we can return phrased errors
        // the model can act on. The zod schema gates kind + types,
        // but length caps are easier to surface here.
        const localChoice = typeof args.localChoice === "string" ? args.localChoice.trim() : "";
        if (!localChoice) {
          return text("governing-flag-issue: `localChoice` is required (what you did in response).");
        }
        if (localChoice.length > LOCAL_CHOICE_CAP) {
          return text(
            `governing-flag-issue: \`localChoice\` exceeds ${LOCAL_CHOICE_CAP} chars (got ${localChoice.length}). ` +
            `Trim — describe what you did, not a full essay; the artifactContext carries the location.`,
          );
        }
        const proposedResolution = typeof args.proposedResolution === "string"
          ? args.proposedResolution.trim()
          : "";
        if (proposedResolution && proposedResolution.length > PROPOSED_RESOLUTION_CAP) {
          return text(
            `governing-flag-issue: \`proposedResolution\` exceeds ${PROPOSED_RESOLUTION_CAP} chars (got ${proposedResolution.length}). ` +
            `Trim — your view in 1-3 sentences; the court does the synthesis.`,
          );
        }
        // Length caps on artifactContext fields. None are required
        // individually, but the model can still send absurdly long
        // strings the cap defends against.
        const ac = args.artifactContext || {};
        for (const f of ["file", "function", "scope"]) {
          if (ac[f] && typeof ac[f] === "string" && ac[f].length > FIELD_CAP) {
            return text(
              `governing-flag-issue: \`artifactContext.${f}\` exceeds ${FIELD_CAP} chars; trim to identifier-length.`,
            );
          }
        }

        const ruler = await resolveRulerForFlag(spaceId);
        if (!ruler) {
          return text(
            `governing-flag-issue: no Ruler scope resolvable from ${String(spaceId).slice(0, 8)}. ` +
            `Flags attach to a Ruler scope's queue; if you're running outside a Ruler scope, ` +
            `this is a substrate bug — surface it.`,
          );
        }

        const workerType = inferWorkerTypeFromRole(roleName);
        // Phase 3c ([[project_seed_four_verbs_only]]): dispatch through
        // the registered DO operation. Same handler runs; auto-Did fires.
        // This proves the wire-verb-surface round-trip: extension code
        // and external callers (e.g. another extension, future MCP-over-
        // IBP) reach the same operation through the same dispatcher.
        const flag = await _core.do(ruler._id, "governing:flag-issue", {
          kind: args.kind,
          artifactContext: {
            file: ac.file || null,
            function: ac.function || null,
            scope: ac.scope || ruler.name || null,
          },
          localChoice,
          blocking: !!args.blocking,
          proposedResolution: proposedResolution || null,
          sourceWorkerScopeId: spaceId,
          sourceWorkerType: workerType,
        }, {
          identity: beingId ? { beingId } : null,
        });

        if (!flag) {
          return text(
            `governing-flag-issue: appendFlag returned null. Either ${String(ruler._id).slice(0, 8)} ` +
            `is not a Ruler, the kind was invalid, or a persistence error occurred. Check logs.`,
          );
        }

        return text(JSON.stringify({
          ok: true,
          flagged: true,
          id: flag.id,
          kind: flag.kind,
          rulerSpaceId: String(ruler._id),
          rulerName: ruler.name || null,
          contentHash: flag.contentHash,
          blocking: flag.blocking,
          note:
            "Flag recorded. Make your local choice and continue your work — " +
            "Pass 1 does not halt on flags. Pass 2 courts will adjudicate.",
        }, null, 2));
      },
    },

    // ───────────────────────────────────────────────────────────────
    // governing-read-pending-issues
    //
    // The Ruler's read tool. Returns the full unresolved-flags queue
    // at this scope. Typically called before synthesizing a build
    // summary at swarm-completed, when the Ruler wants to honestly
    // report what was flagged during execution.
    //
    // Read-only; doesn't end the Ruler's turn.
    // ───────────────────────────────────────────────────────────────
    {
      name: "governing-read-pending-issues",
      verb: "see",
      description:
        "Read the full pending-flags queue at this Ruler scope. Returns every " +
        "unresolved flag with its kind, artifactContext, localChoice, blocking " +
        "status, and proposed resolution if any. Use when synthesizing a build " +
        "summary at swarm-completed (be honest about what was flagged), or when " +
        "judging whether the situation has accumulated enough material to " +
        "warrant escalation. Read-only — does NOT end your turn.",
      schema: {},
      annotations: { readOnlyHint: true },
      async handler(args) {
        const { spaceId } = args;
        if (!spaceId) {
          return text("governing-read-pending-issues: no spaceId in context.");
        }
        const ruler = await resolveRulerForFlag(spaceId);
        if (!ruler) {
          return text(
            `governing-read-pending-issues: no Ruler scope at ${String(spaceId).slice(0, 8)}.`,
          );
        }
        const flags = await readPendingIssues(ruler._id);
        return text(JSON.stringify({
          ok: true,
          rulerSpaceId: String(ruler._id),
          rulerName: ruler.name || null,
          total: flags.length,
          flags: flags.map((f) => ({
            id: f.id,
            timestamp: f.timestamp,
            kind: f.kind,
            artifactContext: f.artifactContext,
            localChoice: f.localChoice,
            blocking: f.blocking,
            proposedResolution: f.proposedResolution,
            sourceWorker: f.sourceWorker,
          })),
        }, null, 2));
      },
    },
  ];
}
