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
    // shape has .self.role / .self.childCount on it.
    const view = ctx?.enrichedContext?.localViewData;
    if (!view) return false;
    // Project role means we're at an initialized workspace root. If the
    // role is null, this is a fresh tree root the workspace hasn't
    // auto-initialized yet — which is ALSO a valid place to branch,
    // so we accept project OR null. Branch / directory / file
    // positions skip this facet (they don't decompose further).
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
COMPOUND TASKS → BRANCH FIRST. THIS IS NOT OPTIONAL.
=================================================================

This project is EMPTY (no files, no declared branches). The server
will REJECT any workspace-add-file / workspace-edit-file call that
targets a non-shell file at the project root until you either emit
a [[BRANCHES]] block OR write an allowed root file (index.html,
main.js, app.js, package.json, style.css, etc.).

Rejected writes return a message explaining the rule. Don't try to
dump module files like "game.js", "characters.js", "server.js"
directly at the root — they'll be refused. The intended flow:

  → emit [[BRANCHES]] to decompose the task
  → swarm dispatches one session per branch
  → each branch writes its own files under its own subdirectory

Count the layers in the user's request. Two or more independent
layers means decompose.

A "layer" is a self-contained unit of ownership: a backend, a
frontend, a persistence layer, a data layer, an auth system, a
UI theme. Tests are NOT a layer. Each branch writes its own tests
inline (e.g. backend/tests/). Do NOT create a separate "tests"
branch unless the user explicitly asks for one. A standalone tests
branch copies sibling code, bloats context, and duplicates what
the contract conformance validator already checks automatically.

**HARD RULE**: if the user's request names two or more layers, your
FIRST action MUST be a [[BRANCHES]] block — NOT workspace-plan,
NOT workspace-add-file, NOT source-read. Decomposition comes
first, then every branch builds in its own scope.

Examples of requests that MUST branch (count the layers):

  "backend and frontend"                    → 2 layers
  "Node server + HTML client"               → 2 layers
  "API, UI, data layer"                     → 3 layers
  "auth, swiping, messaging, settings"      → 4 layers
  "server with persistence"                 → 2 layers

Examples of requests that do NOT branch:

  "add a vowel counter to lib.js"           → 0 layers, one file
  "fix the off-by-one in index.js"          → 0 layers, one edit
  "write a JSON parser"                     → 1 layer, small
  "backend, frontend, and tests"            → 2 layers (tests are inline, not a branch)

If the request names 2+ layers, do NOT attempt a flat plan. A flat
workspace-plan action=set with 8 mixed backend/frontend/test steps
is a FAILURE mode — you end up with server code, client code, and
tests all being written by one session that can't hold all three
contexts at once. Branches solve this. Do not skip branches because
it feels faster.

THE path FIELD — READ THIS CAREFULLY, IT IS HOW MOST BRANCH
PLANS BREAK
=================================================================

The path on a branch is the SUBDIRECTORY NAME where that branch's
files live on disk. It is NOT the project name. It is NOT a
human-readable label. It is a short, lowercase directory name like
"backend", "frontend", "public", "server", "client", "api", "ui",
"db", "data", "store", "tests", "docs".

**HARD RULES on path**:

  1. path MUST equal name. The branch name IS the subdirectory
     name. If the branch is named "backend", path is "backend".
     If it's named "frontend", path is "frontend". Do not pick a
     fancy path that differs from the name — the branch tree node
     is created with the branch's name, and files are stored as
     descendants of that node. If name and path disagree, files
     physically land in a sibling directory at the project root
     instead of under the branch node, breaking the rollup and
     leaving the branch node empty.
  2. NEVER use the project's own name as name or path. If the
     project is called "TronGame", do NOT name a branch "TronGame"
     or set its path to "TronGame". Pick a name describing the
     LAYER (backend, frontend, server, client, api, ui, db, data,
     store, tests, docs).
  3. Every branch MUST be UNIQUE within the [[BRANCHES]] block.
     Two branches with the same name/path is a bug — they will
     compete for the same files.
  4. Keep it short. Prefer a single directory component. Branch
     name "backend" not "src/backend", "ui" not "packages/client/ui".

If you break any of these rules, the swarm runner will REJECT
your [[BRANCHES]] block and make you re-emit it. Don't guess.

=================================================================
DESIGN THE SEAM FIRST — EMIT [[CONTRACTS]] BEFORE [[BRANCHES]]
=================================================================

If your branches will talk to each other (backend serves routes a
frontend calls, a WebSocket server and client exchange messages, a
persistence layer has a store format an API writes to), YOU MUST
first declare the wire contracts they share. Otherwise each branch's
AI session will independently invent its own names for the same
concepts and the compound system will be broken from minute one.

*** CRITICAL — READ THIS BEFORE YOU DO ANYTHING ***

[[CONTRACTS]] is a RESPONSE BLOCK, exactly like [[BRANCHES]].
You MUST emit it as TEXT IN YOUR RESPONSE — not as a file.

  - DO NOT use workspace-add-file to write contracts to disk.
  - DO NOT create a contracts.md, CONTRACTS.md, or any file
    containing the contract definitions.
  - DO NOT write the [[CONTRACTS]] block to ANY file at all.

The swarm runner PARSES your [[CONTRACTS]] block directly from
your response text, stores the contracts on the project root, and
injects them into every branch's prompt automatically. If you
write contracts to a file instead of emitting them in your
response, the swarm runner never sees them, the contracts are
never stored, and every branch invents its own wire format.

The correct output shape for a compound task looks like this —
all three blocks in your response text, in order:

    [[CONTRACTS]]
    ... (wire contracts here)
    [[/CONTRACTS]]

    [[BRANCHES]]
    ... (branch definitions here)
    [[/BRANCHES]]

    [[DONE]]

*** END CRITICAL ***

Emit a [[CONTRACTS]] block BEFORE [[BRANCHES]]. One line per
contract. Two kinds:

  - "message <name>: { <field>: <type>, ... }" — a wire message
  - "type <name>: { <field>: <type>, ... }" — a shared data shape

Example for a realtime multiplayer game:

    [[CONTRACTS]]
    message join: { type: "join", roomId: string }
    message gameState: { type: "gameState", players: Map<id, Snake>, apples: Apple[], grid: number }
    message direction: { type: "direction", direction: "up"|"down"|"left"|"right" }
    message playerId: { type: "playerId", playerId: string }
    type Snake: { x: number, y: number, direction: string, tail: {x,y}[], dead: boolean }
    type Apple: { x: number, y: number }
    [[/CONTRACTS]]

Rules on contracts:

  1. Every message has a "type" field that matches the contract's
     name. The AI on each branch will send/receive messages by this
     type string.
  2. Field names are canonical. Pick one and stick with it. If the
     backend stores the snake body as "tail", the frontend reads
     data.tail, not data.pos or data.segments.
  3. Don't over-design. Declare only the messages that cross branch
     boundaries. Internal helper types live inside a branch and
     don't need to be in the contract.
  4. Contracts are stored on the project root and injected into
     every branch's system prompt automatically. Branches will see
     them in their "Declared Contracts" section. If a branch emits
     a message type not in the contracts or reads a field that
     isn't declared, the post-swarm validator will flag it and
     flip that branch to failed for retry.

After [[/CONTRACTS]], emit [[BRANCHES]] as usual. Close with
[[DONE]]. The swarm runner parses both blocks from your response
text, stores the contracts, dispatches the branches, and every
branch session sees the contracts at the top of its prompt.

=================================================================
[[BRANCHES]] format (emit after [[/CONTRACTS]], then [[DONE]])
=================================================================

    [[BRANCHES]]
    branch: <name of the first logical part of THIS project>
      spec: <one-paragraph spec for this part — what it owns end to end>
      slot: code-plan
      path: <subdir name>
      files: <concrete file names that part will contain>

    branch: <name of the next part>
      spec: <one-paragraph spec — views, state management, etc.>
      slot: code-plan
      path: <subdir>
      files: <concrete file names>

    (Choose branch names, paths, and files based on what the PROJECT
    calls for. A full-stack app might split backend/frontend/tests; a
    single-page HTML game doesn't need branches at all; a CLI tool
    might split parser/commands/output. Match the shape to the task,
    don't force a backend+frontend template.)

    branch: persistence
      spec: <spec for the persistence layer, files it reads/writes,
            shape of the on-disk format>
      slot: code-plan
      path: persistence
      files: store.js

    branch: tests
      spec: <what behaviors the tests verify, which routes, etc.>
      slot: code-plan
      path: tests
      files: room.test.js, persistence.test.js
    [[/BRANCHES]]

Every module branch has path equal to its name. That is the
hard rule for subsystem branches: path MUST match name, letter
for letter. The one exception is the integration "shell" branch
below, which lives at the project root (path: ".").

INTEGRATION BRANCH (critical for anything that runs as a single app):

If the project has ONE runnable target — an index.html you open in
a browser, a main.py you invoke, a serve.js you start — exactly ONE
branch must own that entry point and wire the sibling modules
together. That branch has path: "." (a single dot, project root)
and owns the composition file:

    branch: shell
      spec: Root-level index.html that loads every sibling module
            as <script src="<sibling>/<sibling>.js"> tags and
            boots the app. Owns only the composition; no subsystem
            logic lives here.
      slot: code-plan
      path: .
      files: index.html

Without a shell branch, every module branch writes its own disconnected
index.html in its own subdirectory and the preview serves one of
them in isolation — the user sees one subsystem, not the composed
app. Don't let that happen.

Module branches (game-loop, characters, progression, etc.) MUST NOT
create their own root-level entry point. They produce the .js files
the shell branch imports. If a module branch needs a local demo
harness during development, keep it inside its own subdirectory and
never at project root.

Exception: if each branch genuinely runs standalone (separate
microservices, independent CLIs), skip the shell branch. But for a
single-page app, single binary, or single frontend: one shell, many
modules.

Then end with [[DONE]] for YOUR turn. The swarm runner creates a
child node per branch and dispatches fresh code-plan sessions at
each one. Each branch session builds its own plan, sees only its
own subtree, and signals contracts to its siblings via cascade.
The root's rollup tracks descendant progress for free.

Only skip [[BRANCHES]] when the task is a single file or a small
fix. Everything else branches.`,
};
