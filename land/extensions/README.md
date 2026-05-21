# Extensions — Developer Guide

This is the working shape for building TreeOS extensions after the
2026-05 architectural cleanup. The reference contract for manifest
fields and lifecycle is in [EXTENSION_FORMAT.md](./EXTENSION_FORMAT.md);
this README covers the **substrate model** every extension speaks to:
roles, verbs, tools, operations, beings, and the prompt assembler.

If you are building a new extension, read this first. It explains what
seed does for you so your role and tool files stay small.

---

## The substrate in one paragraph

TreeOS has three primitives and four verbs. The primitives are
**Space** (a position, the structural primitive), **Matter** (something
at a position, content with an `origin` tag), and **Being** (an
addressable identity that acts). The verbs are **SEE** (read),
**DO** (write), **SUMMON** (wake a being), and **BE** (identity, claim,
release, switch, create-being). Beings are the only entities that emit
verbs. Spaces and Matter are what verbs act on.

An extension extends the substrate by registering some combination of:
roles (templates of being behavior), tools (LLM-callable functions),
operations (the DO vocabulary), hooks (lifecycle reactions), and seeds
(plantable scaffolds). The kernel hosts; you compose.

---

## The four verbs and what they target

| Verb | Targets | Use |
|---|---|---|
| SEE | space, matter, being | Read state. Returns descriptors and content. |
| DO | space, matter, being | Mutate state. Each call audits as a Did. |
| SUMMON | being | Wake a being with a message. Goes to its inbox. |
| BE | self (left stance) | Identity operations: register, claim, release, switch, create-being. |

A tool registers with a `verb` tag that matches what it actually does.
Tools without a verb are rejected at registration. The role's
declarative capability lists (`canSee` / `canDo` / `canSummon` / `canBe`)
each contain tool names whose verb tags match.

---

## File layout

```
extensions/your-extension/
├── manifest.js           Declares what you need and what you provide.
├── index.js              init(core) returns live registrations.
├── roles/                One file per role.
│   └── yourRole.js
├── tools/                One file per tool (or grouped — your call).
│   └── yourTool.js
├── operations/           DO operations (kernel + extension vocabulary).
│   └── yourOp.js
├── seeResolvers.js       (Optional) Named resolvers for role.see.
├── state/                (Optional) Your domain state helpers.
└── routes.js             (Optional) HTTP shims into IBP.
```

Not every folder is required. A read-only extension might have just
`manifest.js`, `index.js`, and `roles/`. A pure-tool extension might
have only `tools/`.

---

## Defining a role

A role is a template of being behavior. When a being with role `planner`
is summoned, the seed loads the planner role spec and runs its summon
dispatch with the spec's tools and prompt.

The clean shape — everything the role file writes:

```javascript
// extensions/your-extension/roles/yourRole.js

import { YOUR_PROMPT_BODY } from "./prompts/yourPrompt.js"; // or inline

export const yourRole = {
  // Identity
  name: "your-role-name",

  // Reply mode (optional).
  //   "asker"          reply lands in whoever summoned this being's inbox
  //   "chain-initial"  reply lands at the chain-opening asker (Ruler-style)
  //   omitted          no automatic reply; return value is the only output
  replyTo: "asker",

  // Preloaded prompt content. Each name resolves through a registered
  // seeResolver to a string the assembler inlines before the
  // capability list. See "Preloaded see content" below.
  see: ["this-space", "ancestor-contracts"],

  // Exploratory SEE tools the LLM may call to read more.
  canSee: ["your-extension-read-thing"],

  // DO tools (state mutations).
  canDo: ["your-extension-write-thing"],

  // SUMMON targets (wakes other beings).
  canSummon: ["your-extension-hire-helper"],

  // BE tools (creating new beings). Rare; most roles omit.
  canBe: [],

  // Architectural exit gate (optional). If declared, the summon loop
  // will not terminate until the named tool fires at least once.
  // Use this when the role MUST produce a specific deliverable.
  exit: { requires: "your-extension-write-thing" },

  // LLM loop config (optional).
  maxMessagesBeforeLoop: 12,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 2,

  // The role's voice. The assembler prepends identity, preloaded see
  // blocks, and the capability list; appends a [Time] block. The body
  // is the role's domain instructions.
  prompt: () => YOUR_PROMPT_BODY,
};
```

**What seed derives so you do not write it:**

- `permissions` is computed from `canSee` / `canDo` / `canSummon` / `canBe` / `see`.
- `respondMode` defaults to `"async"`. Override only if needed.
- `triggerOn` defaults to `["message"]`. Override only for cron / hook triggers.
- `summon(message, ctx)` is auto-wrapped with `seed/cognition/defaultSummon.js`
  unless you provide a custom function. Custom dispatch is for roles
  with structural routing (e.g., the Foreman, which routes by content
  shape between dispatch and judgment).
- `buildSystemPrompt(ctx)` is auto-assembled from `prompt`, `see`,
  and the `canX` lists. Custom assemblers are legacy.

**What seed does at summon time:**

1. Builds the system prompt: identity + preloaded see + capability list + your `prompt()` body + time.
2. Pushes the SUMMON envelope.content as the first user message.
3. Loops: assistant turn → tool calls → tool results → assistant turn, until the LLM emits text with no tool call (or `exit.requires` is unsatisfied).
4. Returns `{ text, summonId }` to the caller.
5. If `replyTo` is set, emits a reply SUMMON to the appropriate stance.

---

## Defining a tool

A tool is an LLM-callable function. Every tool declares its verb so the
prompt assembler and authorization layer know what kind of action it
performs.

```javascript
// extensions/your-extension/tools/your-tool.js

export default {
  name: "your-extension-do-thing",

  // verb is REQUIRED. One of "see" | "do" | "summon" | "be".
  // The verb determines what kind of action this tool performs and
  // which authorization gate runs before the handler.
  verb: "do",

  description:
    "Mutate the thing at this scope. Use when the user asks to change " +
    "state. Returns ok or an error reason.",

  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string", description: "What to modify." },
      value:  { type: "string", description: "The new value." },
    },
    required: ["target", "value"],
  },

  // The handler runs after stance authorization passes. ctx carries
  // the calling being, position, role, and signal.
  async handler({ params, ctx }) {
    // params.target, params.value
    // ctx.being, ctx.position, ctx.role, ctx.signal
    await core.do(ctx.position, "your-extension:write-thing", {
      target: params.target,
      value:  params.value,
    });
    return { ok: true };
  },
};
```

**Tool naming convention:**

- Kernel tools: bare names (`create-child`, `set-meta`).
- Extension tools: `<ext-name>-<action>` (`governing-emit-plan`,
  `coders-read-file`).
- Operations the tools dispatch to follow the same naming with a colon:
  `governing:ratify-plan` (operation), `governing-ratify-plan` (tool).

**Choosing the verb tag:**

- **SEE** — reads state and returns it. No side effects. Examples:
  `read-plan-detail`, `get-tree-context`.
- **DO** — writes state. Mutates space, matter, or being. Examples:
  `ratify-plan` (writes metadata), `set-meta`, `archive-plan`.
- **SUMMON** — wakes another being with a message. The being's inbox
  receives a SUMMON envelope. Examples: `hire-planner`,
  `route-to-foreman`, `respond-directly`. Behind the scenes the
  handler may need to create the being first (BE) before waking it
  (SUMMON), but the tool is summon-tagged because waking is the point.
- **BE** — creates / claims / releases / switches identity. Most
  extensions never write BE tools. The auth-being handles register /
  claim / release / switch / create-being.

---

## Defining a DO operation

Operations are the substrate's write vocabulary. Tools are the LLM
surface; operations are what tools and code call to actually mutate
state. The kernel ships a core set (`create-child`, `set-name`,
`set-meta`, etc.); extensions add their own under their namespace.

```javascript
// extensions/your-extension/operations/ratify-plan.js

export default {
  name: "your-extension:ratify-plan",

  // Target kinds this operation accepts.
  targets: ["matter"],

  async handler({ target, params, identity, summonCtx }) {
    // target is the matter being ratified (resolved by the dispatcher)
    // params is the operation-specific payload
    // identity is the being doing it
    // summonCtx is the originating summon context (for audit attribution)

    await core.do(target, "set-meta", {
      namespace: "your-extension",
      data: { ratifiedAt: new Date().toISOString() },
    });

    return { ratified: true };
  },
};
```

**What the dispatcher does:**

1. Looks up the operation by name.
2. Validates the target kind against `targets[]`.
3. Runs the read-only-origin gate (filesystem-origin matter is
   rejected unless an extension opted out).
4. Calls your handler.
5. Auto-writes a Did unless `skipAudit: true`.

You write the handler; the dispatcher handles the surrounding policy.

---

## Creating beings (use BE, not DO)

Identity operations belong on the BE verb. Use `core.be(...)`, not
`core.do(...)`, when creating beings:

```javascript
// Creating a sub-being (Planner, Contractor, Foreman, etc.)
const planner = await core.be("create-being", {
  name:           `planner-${shortId()}`,    // optional for AI; auto-generated if omitted
  password:       null,                       // optional for AI; auto-generated
  operatingMode:  "ai",                       // "human" | "ai"
  role:           "planner",                  // required for AI beings
  homeSpace:      ctx.position.spaceId,       // existing space
  // OR homeParent: parentSpaceId            // creates a new home child space
  parentBeingId:  ctx.being._id,              // being-tree lineage; defaults to caller
  llmDefault:     null,                       // optional LlmConnection id
});

// planner now has: { beingId, name, beingAddress, operatingMode, roles, parentBeingId }
```

**Why BE and not DO:** the philosophy notes lock this. BE is the verb
for identity (`register`, `claim`, `release`, `switch`, `create-being`).
DO mutates space and matter. Creating a being is identity creation, not
a state write on space.

For roles that need to spawn helpers, encapsulate `create-being` +
`summon` inside a SUMMON-tagged tool. The Ruler's `governing-hire-
planner` is the canonical example: the tool's handler creates a Planner
if none exists at scope, then summons it with the brief. From the
LLM's perspective it is one tool call; the BE+SUMMON sequence is
plumbing.

---

## Preloaded see content (the `see` field on a role)

A role's `see` array names blocks the prompt assembler should embed
before the capability list. Each name resolves through a registered
**see-resolver** to a string.

**Registering a resolver:**

```javascript
// extensions/your-extension/seeResolvers.js

import { registerSeeResolver } from "../../seed/cognition/seeResolvers.js";
import { renderYourSnapshot } from "./state/yourSnapshot.js";

export function registerYourExtensionResolvers() {
  registerSeeResolver("your-snapshot", async (ctx) => {
    const spaceId = ctx.currentNodeId || ctx.targetNodeId || ctx.rootId;
    if (!spaceId) return null;
    try { return await renderYourSnapshot(spaceId); }
    catch { return null; }
  }, "your-extension");
}
```

**Calling it from init:**

```javascript
// extensions/your-extension/index.js
export async function init(core) {
  const { registerYourExtensionResolvers } = await import("./seeResolvers.js");
  registerYourExtensionResolvers();
  // ... register roles, tools, operations
}
```

**Referencing it from a role:**

```javascript
export const yourRole = {
  name: "your-role",
  see: ["your-snapshot", "ancestor-contracts"],
  // ... rest of role
};
```

Resolvers run in parallel; the assembler joins their non-empty results
in declaration order between the identity line and the capability list.
Returning `null` opts out (use this when a block is only relevant in
some contexts, e.g. sub-Ruler lineage at sub-scope).

**Resolvers shipped by seed:**

- `this-space` — one-line summary of where the being is now.

**Resolvers shipped by governing:**

- `ruler-snapshot` — full domain state (plan, contracts, execution).
- `execution-stack` — Foreman's execution-record view.
- `ancestor-contracts`, `ancestor-plan`, `ruler-lineage`, `active-workspace`.

---

## The exit gate (`exit.requires`)

Use this when the role MUST produce a specific deliverable. The summon
loop will not let the LLM end its turn until the named tool fires.

```javascript
export const plannerRole = {
  name: "planner",
  canDo: ["governing-emit-plan"],
  exit: { requires: "governing-emit-plan" },
  // ...
};
```

If the LLM emits a terminal text turn without calling the required
tool, the loop pushes a corrective system message (`"You have not yet
called governing-emit-plan. Your turn cannot end until that tool
fires."`) and re-enters. Capped by `maxIterations` so a stubborn model
cannot loop forever.

**When to use it:** the role's purpose IS to produce a specific
deliverable via a specific tool. Planner (must emit-plan). Contractor
(must emit-contracts). A code-review role that must call
`emit-review-report`.

**When not to use it:** the role's exit is free-form. Ruler (writes
prose synthesis). Worker (returns a summary). Coder (returns what it
changed). For these, the prompt body teaches exit shape; the kernel
does not enforce it because there is no specific tool to enforce.

---

## What seed gives you (so role files stay small)

The seed cognition layer handles the following for every role you
write through the new shape:

| What | Where | What you get |
|---|---|---|
| Default summon dispatch | `seed/cognition/defaultSummon.js` | runChat invocation, abort handling, error wrapping, reply emission |
| System prompt assembly | `seed/cognition/buildPrompt.js` | identity + see + capabilities + your prompt body + time |
| Reply emission | `seed/cognition/replyEmission.js` | emitReplyToAsker, emitReplyToStance, findChainInitialCaller |
| Tool resolution | `seed/cognition/runChat.js` | role.canX → registered tools, permission filter, per-position scope |
| Exit-gate enforcement | `seed/cognition/runChat.js` | runs if you declared `exit.requires` |
| Permissions derivation | `seed/being/roles/registry.js` | computed from your canSee/canDo/canSummon/canBe |
| Did audit logging | `seed/ibp/verbs.js` | every DO writes a Did unless `skipAudit` |
| Stance authorization | `seed/ibp/authorize.js` | runs before every verb |

You stop writing the same 60 lines of dispatch boilerplate that every
governing role used to carry.

---

## Worked example: a minimal extension

Suppose you want a `feedback` extension that lets a being collect
short feedback notes at any scope and emit a daily digest.

**manifest.js:**

```javascript
export default {
  name: "feedback",
  version: "1.0.0",
  description: "Collect short feedback notes; emit a daily digest.",
  needs: { services: ["hooks", "metadata"], models: ["Space"] },
  provides: { tools: true },
};
```

**roles/collector.js:**

```javascript
export const collectorRole = {
  name: "feedback-collector",
  replyTo: "asker",
  see: ["this-space"],
  canDo: ["feedback-add-note"],
  exit: { requires: "feedback-add-note" },
  prompt: () => `You are a Feedback Collector. The user has sent you
a short observation about this scope. Call feedback-add-note exactly
once with the text they sent, then exit with [[DONE]].`,
};
```

**tools/add-note.js:**

```javascript
export default {
  name: "feedback-add-note",
  verb: "do",
  description: "Append a feedback note to the current scope's queue.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  async handler({ params, ctx }) {
    await core.do(ctx.position, "feedback:append", { text: params.text });
    return { ok: true };
  },
};
```

**operations/append.js:**

```javascript
export default {
  name: "feedback:append",
  targets: ["node"],
  async handler({ target, params }) {
    await core.qualities.qualities.space.pushQuality(
      target,
      "feedback",
      "notes",
      { text: params.text, at: new Date().toISOString() },
      50,                                  // keep last 50
    );
    return { appended: true };
  },
};
```

**index.js:**

```javascript
import { registerRole } from "../../seed/being/roles/registry.js";
import { collectorRole } from "./roles/collector.js";

export async function init(core) {
  registerRole("feedback-collector", collectorRole, "feedback");
  return {
    tools: [
      (await import("./tools/add-note.js")).default,
    ],
    operations: [
      (await import("./operations/append.js")).default,
    ],
  };
}
```

That is the whole extension. The role file is 10 lines plus its prompt
body. The tool file is 15 lines. The operation file is 10 lines. The
seed handles dispatch, the prompt assembly, reply emission, exit
enforcement, and audit logging.

---

## Anti-patterns

Things you might be tempted to do that the architecture rejects.

**Writing your own `summon` function when the default works.**
The seed's default summon dispatch handles 90% of cases. Reach for a
custom summon only when the role needs structural routing (the
Foreman is the canonical case — it routes by content shape between
dispatch and judgment). For a role that wakes, calls runChat, and
returns text, just declare `prompt` and let seed wrap.

**Putting `create-being` on the DO verb.**
Identity is BE's territory. Use `core.be("create-being", ...)`. The
auth-being honors this operation. Putting it on DO confuses the verb
matrix.

**Declaring `permissions` on a role.**
Derived. The registry computes permissions from your `canX` lists. If
you declare it, you are doing duplicate work the seed already does.

**Skipping the `verb` tag on a tool.**
Rejected at registration. Every tool must declare which verb it fires
so authorization and the prompt assembler can categorize it. There is
no permissive default.

**Embedding the SUMMON message in your role's prompt body.**
The seed pushes the message as the first user-role message in the
chat. Do not duplicate it in the system prompt; the LLM sees it twice
and gets confused about what to react to.

**Using "scope" in role identity language when you mean "space."**
A Ruler's space happens to be its governance scope. Other roles
(Planner, Contractor, Worker) are at spaces that are not scopes. The
prompt says "at <space>," not "at <scope>." Reserve "scope" for the
governance-specific term.

**Bypassing the operation registry for direct database writes.**
Operations write a Did automatically. Direct Mongoose calls do not.
Audit trail diverges. Use `core.do(target, "operation-name", params)`
when you can.

---

## Cross-references

- **Manifest contract:** [EXTENSION_FORMAT.md](./EXTENSION_FORMAT.md).
- **Substrate philosophy:** `seed/philosophy/` (the four hand-written
  pages from Tabor Holly, 2026-05-18).
- **Seed kernel internals:** `seed/SEED.md`.
- **Role registry behavior:** `seed/being/roles/registry.js` (header
  comment).
- **Prompt assembler:** `seed/cognition/buildPrompt.js` (header
  comment).
- **Default summon:** `seed/cognition/defaultSummon.js`.
- **Reply emission helpers:** `seed/cognition/replyEmission.js`.
- **The four verbs in code:** `seed/ibp/verbs.js`.

If something here disagrees with the seed source, the source is right
and this document is stale. File an issue or update it.
