/**
 * Compound branches facet.
 *
 * Injected whenever the AI is at an EMPTY project root with no
 * dispatched subPlan yet. This is the "decompose a fresh task"
 * moment regardless of session turn count — a user who bounces
 * between several empty projects in one session hits turn 2+ on
 * every subsequent one, but each of those is still a fresh task
 * that needs decomposition. Keying on isFirstTurn was the old bug:
 * only the very first request of a session ever got the facet,
 * every request after that missed the HARD RULE.
 *
 * Three conditions, any one skips injection:
 *   - position is not a project root / uninitialized tree root
 *   - project already has children (writes are underway; EXTEND,
 *     don't decompose)
 *   - subPlan already has branches (a swarm was proposed/dispatched
 *     here; extending with amendMissingLayer handles add-on work)
 *
 * Keeps ~2KB out of every continuation turn and every branch dispatch
 * because those positions either have children, have a subPlan, or
 * aren't a project root.
 */
export default {
  name: "compound-branches",

  shouldInject(ctx) {
    // Use the raw view object (localViewData), NOT the formatted string
    // at localView. The string is for prompt rendering; only the raw
    // shape has .self.role / .self.swarmRole / .self.type / .self.childCount on it.
    const view = ctx?.enrichedContext?.localViewData;
    if (!view) return false;
    // Skip for sub-branch builders. Branches sit INSIDE a swarm
    // dispatch — they don't decompose further; the depth cap rejects
    // it, and the architect-orientation framing in this facet's text
    // (the "EMPTY project" warning, the "HARD RULE: branch first"
    // directive) is misleading noise inside a branch's prompt.
    // swarmRole comes from metadata.swarm.role (set by initBranchRole).
    if (view.self?.swarmRole === "branch") return false;
    // Skip for plan-type nodes themselves — a plan node is the
    // coordinator, not a decomposition target.
    if (view.self?.type === "plan") return false;
    // Project role (code-workspace) means we're at an initialized
    // workspace root. If the role is null AND we're not inside a
    // branch (already filtered above), this is a fresh tree root the
    // workspace hasn't auto-initialized yet — also a valid place to
    // branch. Code-workspace's directory / file positions skip.
    const selfRole = view.self?.role;
    if (selfRole && selfRole !== "project") return false;
    // Skip the facet if a plan has already been proposed/dispatched at
    // this position. context.planSummary is set by the enrichContext
    // handler when metadata.plan.steps has entries — its presence alone
    // means the project has been decomposed already and amendMissingLayer
    // will guide any add on work instead.
    if (ctx?.enrichedContext?.planSummary) return false;
    // Note: we INTENTIONALLY do NOT skip when childCount > 0. Earlier
    // versions of this facet only fired at a perfectly empty project.
    // That breaks the common case where a previous failed run left
    // orphan children behind: the project has children (so the facet
    // skipped) but no plan (so amendMissingLayer didn't fire either),
    // and the architect just explores stale state instead of
    // decomposing the user's new compound request. Firing the facet
    // whenever there's no plan handles both fresh empty projects AND
    // projects littered with prior cruft — the user's compound
    // request still triggers a fresh [[BRANCHES]] decomposition.
    return true;
  },

  text: `=================================================================
COMPOUND TASKS → DECOMPOSE WITH [[BRANCHES]]
=================================================================

This project is empty. Module file writes at the root will be
rejected (only shell files are allowed: index.html, main.js,
app.js, package.json, etc.). If the request names 2+ independent
layers (backend+frontend, server+client, api+ui+data), your FIRST
action MUST be a [[CONTRACTS]] + [[BRANCHES]] response. Tests are
NOT a layer — each branch writes its own tests inline.

Single-file tasks ("add a vowel counter", "fix off-by-one") do NOT
branch. Just write the file.

=================================================================
RESPONSE SHAPE (text blocks, NOT files)
=================================================================

[[CONTRACTS]] and [[BRANCHES]] are RESPONSE BLOCKS. Emit them as
text in your reply. Do NOT call workspace-add-file with them. Do
NOT create contracts.md. The swarm runner parses these blocks from
your response text directly.

    [[CONTRACTS]]
    ... wire contracts ...
    [[/CONTRACTS]]

    [[BRANCHES]]
    ... branch definitions ...
    [[/BRANCHES]]

    [[DONE]]

=================================================================
[[CONTRACTS]] — declare shared vocabulary BEFORE branches
=================================================================

If branches will reference each other (storage keys, DOM ids, event
names, exported globals, message types, function signatures), declare
them here. Without this each branch invents its own names for the
same concept and integration breaks immediately.

One line per contract. Format: NAMESPACE name: { ...values, scope }

NAMESPACES: storage-key, identifier-set, dom-id, event-name,
message-type, method-signature, module-export.

SCOPES: shared:[branch-a,branch-b], local:branch, global. Default
to NARROW. Use global ONLY for vocabulary every branch must comply
with (project-wide storage keys, identifier sets, app-wide events).
A dom-id that only the branch creating the DOM and the branch
manipulating it touch is shared:[creator, user] — NOT global.
Over-globalizing dumps noise into branches that don't reference it.

CLASS EXPORTS: when the export is a class, declare its public
methods alongside globals. Without methods, consumers can't tell
what they're allowed to call without reading your code — which is
the failure mode contracts exist to prevent.

Example:

    [[CONTRACTS]]
    identifier-set characterIds: { values: ['yellow','red','blue','green'], scope: global }
    storage-key flappyState: { shape: '{ totalXP, unlockedChars, highScore }', scope: shared:[game,progression] }
    dom-id canvasId: { value: 'gameCanvas', scope: shared:[game,shell] }
    dom-id menuId: { value: 'menuOverlay', scope: shared:[shell,ui] }
    event-name onScore: { detail: '{ score: number }', scope: shared:[game,ui] }
    module-export GameEngine: { globals: 'window.GameEngine = class', methods: 'startGame(birdType), stopGame(), on(event, handler)', scope: shared:[game,shell] }
    module-export ProgressionManager: { globals: 'window.ProgressionManager = { addXP(n), getTotal(), unlock(charId) }', scope: shared:[progression,game,ui] }
    [[/CONTRACTS]]

Rules: declare shared vocabulary only (not internal helpers).
Field names are canonical — pick one and every branch uses it
verbatim.

=================================================================
[[BRANCHES]] format
=================================================================

ALL branches go in ONE [[BRANCHES]] block. Do NOT emit a separate
[[BRANCHES]]...[[/BRANCHES]] per branch. The parser used to silently
drop everything past the first block; even now that it's tolerant,
multiple blocks are wasted tokens and harder to revise.

    [[BRANCHES]]
    branch: <name-1>
      spec: <one paragraph — what this branch owns end to end>
      slot: code-plan
      path: <name-1>
      files: <concrete files this branch will write>

    branch: <name-2>
      spec: ...
      slot: code-plan
      path: <name-2>
      files: ...

    branch: <name-3>
      spec: ...
      slot: code-plan
      path: <name-3>
      files: ...
    [[/BRANCHES]]

HARD RULES:
  • path MUST equal name (letter for letter). Validator rejects
    anything else. Exception: ONE integration branch with path: "."
    that owns the root entry file (index.html / main.js / server.js).
  • NEVER use the project's name as a branch name or path. Use
    layer names (backend, frontend, ui, api, db, tests, docs).
  • Branches must be unique. Keep names short and lowercase.
  • One [[BRANCHES]] block holds every branch. Open once, list all
    branches inside, close once.

INTEGRATION BRANCH (required for single-target apps):

If the project produces ONE runnable thing (an index.html, a
serve.js, a main.py), exactly ONE branch owns the root entry file
with path: "." — example:

    branch: shell
      spec: Root index.html loading sibling modules via script tags.
      slot: code-plan
      path: .
      files: index.html

Module branches produce .js files the shell imports. They MUST NOT
create their own root index.html — the shell owns composition.

Skip the integration branch only if branches genuinely run standalone
(separate microservices, independent CLIs).

Close your response with [[DONE]] after [[/BRANCHES]]. The swarm
runner creates a child node per branch and dispatches one session
each. Branches see scoped contracts, not other branches' contracts.`,
};
