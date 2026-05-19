// TreeOS governing — typed Worker roles.
//
// Four typed workers — build, refine, review, integrate. Each is a
// distinct cognitive shape the Planner picks per leaf step. The role
// definition carries BOTH dispatch (summon, honoredIntents, …) AND
// LLM behavior (buildSystemPrompt, toolNames, modeKey, …) in one
// frozen spec. See memory `role-subsumes-mode`.
//
// Worker beings are materialized lazily at the execution node when
// the Foreman first needs them. Foreman dispatches workers via
// SUMMON + handoff: each worker SUMMON gets an `attachHandoff` whose
// `onResponse` feeds an `aggregate()` collector. Workers just return
// their content; the scheduler invokes the handoff; the aggregator
// counts the reply, and the Foreman continues.

import log from "../../../seed/log.js";
import { runChat } from "../../../seed/llm/conversation.js";
import { resolveBeingInOut } from "./_shared.js";
import { buildWorkerPrompt, WORKER_BASE_CONFIG } from "./workerBase.js";

// ─────────────────────────────────────────────────────────────────────
// BUILD — bring something new into existence at this scope
// ─────────────────────────────────────────────────────────────────────
const BUILD_BODY = `WHAT BUILD MEANS

Build is the act of bringing something new into existence at this
scope. The spec describes what doesn't yet exist; your job is to
make it exist correctly the first time.

Rules of Build:

  • The spec is the contract. Realize EXACTLY what it asks for, no
    more. If the spec says "write a vowel counter," write a vowel
    counter — don't also add a consonant counter, don't add a CLI
    flag the spec didn't ask for, don't scaffold a test suite the
    plan didn't include.

  • Smallest correct thing first. New code starts from the minimum
    that satisfies the spec. Adornment, configurability, and
    extension points are for Refine to add later when actual
    requirements force them.

  • Use the contracts in force. If your Ruler ratified an event
    name, a storage key, or a function signature, use that name
    verbatim. Inventing parallel vocabulary is forbidden; surface
    a missing contract instead.

  • One file per leaf. The spec → one artifact. Cross-cutting work
    that needs two artifacts to be coherent is two leaves, not one.

  • Don't pre-build for the future. A Build that adds five
    "for-later" hooks the spec didn't ask for is wrong. Land the
    spec; let Refine add the hooks if and when they're needed.`;

// ─────────────────────────────────────────────────────────────────────
// REFINE — improve an existing artifact, minimum surface area
// ─────────────────────────────────────────────────────────────────────
const REFINE_BODY = `WHAT REFINE MEANS

Refine is the act of improving an existing artifact. The artifact
already exists; your job is to read it, judge what's worth
preserving, and make the minimum correct change.

Rules of Refine:

  • READ FIRST, WRITE SECOND. Open the file. Understand what it
    does. Identify what the spec is asking you to change. Only
    then write. A Refine that begins with a write is a Build
    pretending — that's a different cognitive shape.

  • Preserve what works. Existing behavior that the spec didn't
    flag is load-bearing — other code depends on it, the user
    depends on it, the contracts depend on it. A Refine that
    breaks unrelated behavior is a failed Refine.

  • Minimum surface area. The change should be as small as
    possible while satisfying the spec. Five-line fixes are not
    fifty-line rewrites. Resist the temptation to "while I'm in
    here" — that's scope creep, not Refine.

  • Surface ambiguity rather than guessing. If the spec is unclear
    about what aspect to refine, or two valid readings exist, end
    with [[NO-WRITE: spec needs disambiguation: <which two
    readings>]] and exit. Don't pick one and rewrite under it.

  • Use the contracts in force. A Refine never renames a contracted
    identifier (event names, storage keys, signatures) without an
    explicit contract revision. If the spec asks for a rename of
    something contracted, surface that as a contract change first;
    don't perform the rename and orphan the consumers.`;

// ─────────────────────────────────────────────────────────────────────
// REVIEW — judge an artifact without modifying it
// ─────────────────────────────────────────────────────────────────────
const REVIEW_BODY = `WHAT REVIEW MEANS

Review is the act of judging an existing artifact. You read, you
think, you produce structured findings. You do NOT modify the
artifact under review — that's a different cognitive shape and a
different role's job.

Rules of Review:

  • READ-ONLY DISCIPLINE. Do not call write tools that modify the
    artifact you are reviewing. Notes attached at this scope are
    your output; the artifact stays unchanged. If you find yourself
    reaching for workspace-edit-file or similar, stop — you are
    drifting into Refine.

  • Structured findings. Output organized by severity (blocker /
    concern / observation) with a one-line summary per finding and
    enough evidence (line number, exact phrase, contract reference)
    that another role can act on it without re-reading the whole
    artifact.

  • Cite the contracts. When you find a contract violation, name
    the specific contract by its canonical identifier and quote
    the conflicting code or text. "Doesn't match the contract" is
    not a finding; "uses 'gameTick' where the event-name contract
    binds 'tick' (line 47, server/game.js)" is a finding.

  • Adjacency matters. A review of a single file should also note
    when it conflicts with siblings — peer files at this scope, or
    the parent plan's commitments. The Review's value is in
    surfacing the SEAM cases that single-scope writers miss.

  • Calibrate confidence. Don't hedge everything. If something is
    clearly broken, say so plainly. If something is a judgment
    call, name the judgment and the trade-off. A review of pure
    hedges is noise.`;

// ─────────────────────────────────────────────────────────────────────
// INTEGRATE — reconcile sibling outputs at this scope
// ─────────────────────────────────────────────────────────────────────
const INTEGRATE_BODY = `WHAT INTEGRATE MEANS

Integrate is the act of reconciling sibling outputs at this scope.
Sub-Rulers ran below you and produced their artifacts. Your job is
to write the seam — the minimum file(s) at THIS scope that make the
sibling outputs cohere into a single working surface.

Rules of Integrate:

  • READ THE SIBLINGS. Before writing your integration file, look
    at what the sub-Rulers actually produced. Their plan emissions,
    their files, their contracts. The integration must match what
    is THERE, not what you imagined they would build.

  • Don't recreate sibling work. The sub-Rulers own their
    directories. Your file at this scope ties them together; it
    does NOT reach into a sibling's directory and rewrite their
    output. If a sibling's output is wrong, surface a Review
    finding — don't paper over it from the integration scope.

  • Use the contracts the parent ratified. Cross-domain contracts
    (scope: shared:[X,Y]) are what make integration possible. Your
    integration file binds the contracted identifiers verbatim. A
    package.json that names a script the contracts don't ratify, or
    a router that mounts at a path the contracts don't bind, is
    drifting — fix the contract first or fix the integration.

  • Minimum surface, top-level only. Integration files at this
    scope are project-level integration: package.json, README,
    top-level index.html (only when no client/ sub-Ruler owns it),
    top-level configuration. Do NOT create new sub-directories
    from an Integrate Worker; if a new sub-domain is needed,
    self-promote (the [[BRANCHES]] path below).

  • Surface inconsistency rather than guessing. If two siblings
    produced incompatible outputs and the contracts didn't bind
    the disputed name, end with [[NO-WRITE: integration blocked
    by inconsistency: <what conflicts>]] and exit. Don't pick a
    winner unilaterally — that's a Ruler judgment, not an
    Integrate Worker's.`;

// ─────────────────────────────────────────────────────────────────────
// Typed-worker registry
// ─────────────────────────────────────────────────────────────────────
const TYPED_WORKERS = [
  { name: "worker-build",     modeKey: "tree:governing-worker-build",     emoji: "🔨", label: "Build Worker",     body: BUILD_BODY     },
  { name: "worker-refine",    modeKey: "tree:governing-worker-refine",    emoji: "🪓", label: "Refine Worker",    body: REFINE_BODY    },
  { name: "worker-review",    modeKey: "tree:governing-worker-review",    emoji: "🔍", label: "Review Worker",    body: REVIEW_BODY    },
  { name: "worker-integrate", modeKey: "tree:governing-worker-integrate", emoji: "🧵", label: "Integrate Worker", body: INTEGRATE_BODY },
];

function makeWorkerRole({ name, modeKey, emoji, label, body }) {
  // Self-reference closed over by summon so runChat receives the role
  // spec directly (the new path). `role` is fully assigned and frozen
  // by the time summon executes.
  const role = {
    // Dispatch contract
    name,
    // Worker reads its leaf-step context and writes artifacts at scope.
    // SEE + DO. No SUMMON — Workers don't delegate; sub-Ruler dispatch
    // is Foreman's responsibility.
    permissions: ["see", "do"],
    respondMode: "async",
    triggerOn: ["message"],

    // LLM behavior contract (mirrored to mode registry via registerRole)
    ...WORKER_BASE_CONFIG,
    modeKey,
    emoji,
    label,
    bigMode: "tree",
    buildSystemPrompt(ctx) {
      return buildWorkerPrompt(ctx, { typeLabel: label, body });
    },

    // Summon function — kernel scheduler invokes this on inbox arrival.
    async summon(message, ctx) {
      const startMs = Date.now();
      const workNodeId = ctx.nodeId || ctx.resolved?.nodeId;
      if (!workNodeId) {
        log.warn(`Worker/${name}`, "summon without nodeId; returning empty");
        return { content: `Internal error: no work node.`, intent: "chat" };
      }
      log.info(`Worker/${name}`,
        `${emoji} summons at ${String(workNodeId).slice(0, 8)} ` +
        `(from=${message.from || "?"}, correlation=${message.correlation?.slice(0, 8) || "?"})`);

      const { beingIn, beingOut, username } = resolveBeingInOut(ctx);
      const messageBody = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);

      let result;
      try {
        result = await runChat({
          beingId: beingIn,
          beingIn,
          beingOut,
          username,
          message: messageBody,
          role,
          rootId:  ctx.resolved?.rootId || null,
          nodeId:  workNodeId,
          signal:  ctx.signal,
        });
      } catch (err) {
        if (ctx.signal?.aborted) {
          log.info(`Worker/${name}`, `summon aborted (${err.message})`);
          return null;
        }
        log.warn(`Worker/${name}`, `LLM call failed: ${err.message}`);
        return { content: `${name} error: ${err.message}`, intent: "chat" };
      }

      const exitText = result?.answer || `(${name} done)`;
      const durationMs = Date.now() - startMs;
      log.info(`Worker/${name}`,
        `${emoji} summons complete at ${String(workNodeId).slice(0, 8)} in ${durationMs}ms`);

      // Just return. The dispatcher (Foreman, or the user's socket via
      // the verb handler) receives this through its handoff.
      return {
        content:  exitText,
        intent:   "chat",
        summonId: result?.summonId || null,
      };
    },
  };
  return Object.freeze(role);
}

export const workerRoles = TYPED_WORKERS.map((spec) => ({
  spec,
  role: makeWorkerRole(spec),
}));

export const allWorkerRoles = workerRoles;
