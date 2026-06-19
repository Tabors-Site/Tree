Okay you've actually laid out a real design here and several pieces of it are doctrinally important. Let me work through them carefully, in order, because some are immediately right, some need pushback, and one (point 6) is genuinely the unlock for everything else.

## Point 1: chaining specific tool calls in order

You're right to push on this. "If last role was X then do Y next" isn't a great pattern when extended — it makes role transitions stateful in a way that fights the substrate's reactive model. You're encoding sequence in role names, which is exactly what state machines were invented to be the wrong answer for.

The cleaner shape: **roles encode capabilities and intent; sequence emerges from world state, not from "what role was I last."**

A judge doesn't transition through "judge-step-1 → judge-step-2 → judge-step-3" by remembering its prior role. A judge has a single role that reads world state (a `case.phase` quality on the courtroom space, perhaps) and exposes different tools at different phases. The phase is in the world; the role reacts to it.

So instead of:

```
roleFlow: [
  { when: { me.previousRole: "judge-opening" }, role: "judge-evidence" },
  { when: { me.previousRole: "judge-evidence" }, role: "judge-ruling" },
]
```

You have:

```
roleFlow: [
  { when: { space.quality.case.phase: "opening" }, role: "judge-opening" },
  { when: { space.quality.case.phase: "evidence" }, role: "judge-evidence" },
  { when: { space.quality.case.phase: "ruling" }, role: "judge-ruling" },
]
```

The state lives in the world, not in role history. The judge's act in the "opening" phase advances the phase to "evidence" via a `do(space, "advance-phase")` or similar. Next moment, world state has changed, roleFlow naturally picks the new role. Coherent without sequence-tracking.

This is also more honest: the world's state is the source of truth, not "what role this being most recently wore." Same doctrine that runs everything else.

**`me.previousRole` exists as a vocabulary primitive (you have it) but should be used sparingly.** It's useful for _inertia_ ("if I was bored last moment, lean toward staying bored unless something interesting happened") but not for _sequencing_. Sequencing should ride world state.

## Point 2: large roles vs role trees

You're identifying a real problem. A single judge role with 50 canDo entries and a 3000-token system prompt is unwieldy. The LLM gets confused, the context window fills up, the role becomes hard to maintain.

The natural decomposition is exactly what you're seeing: **split the big role into smaller phase-specific roles**, each with a tighter set of canDo and a focused prompt. The judge role from point 1 splits into `judge-opening`, `judge-evidence`, `judge-ruling` — each has maybe 5-10 canDo and a 500-token prompt focused on its phase.

This is exactly what point 1's world-state-driven roleFlow enables. The judge isn't _really_ one role with many phases; it's a _family of related roles_ selected by world state.

But you're hitting on something deeper: **roles compose hierarchically.** Not just "judge has phases" but "judge is a kind of court-officer; court-officer has shared canSummon for court-officials; judge specializes that with judge-specific canDo." The role tree.

This is where it gets interesting. The substrate currently has _role stacking_ (modifiers compose with primary). But it doesn't have _role inheritance_ (a role extending another role). Worth pushing on this honestly.

## The doctrinal question: role inheritance vs role flow + base modifiers

There are two ways to handle "this role is a specialization of that role":

**Way A: role inheritance.** A role has a `extends: "court-officer"` field. At resolution, the role's effective spec is the merge of the parent + the child (child overrides parent on conflicts). Like class inheritance in OOP.

**Way B: roleFlow stacks the shared base.**

```
roleFlow: [
  { stack: true, role: "court-officer-base" },
  { role: "judge-ruling" }
]
```

The base modifier provides the shared canSee/canDo/system prompt; the primary specializes. Same composed effect, but through stacking rather than inheritance.

**Way B is the doctrinally correct answer**, and it's the one your substrate already supports. Here's why inheritance is wrong:

- Inheritance creates _hidden_ composition. Reading the judge-ruling role definition, you don't see what court-officer contributes unless you trace the chain. Stacking makes it explicit at the consumption point (the roleFlow).
- Inheritance forces _static_ composition. The court-officer base is always part of the judge, even when it shouldn't be (maybe in some weird scenario, the judge shouldn't have court-officer permissions). Stacking is per-moment — you stack what's appropriate this moment based on conditions.
- Inheritance complicates reasoning. With deep hierarchies, "what can this role do?" requires walking up the inheritance tree. With stacking, it's just the union of currently-stacked roles, visible in the roleFlow.

So your intuition about "role trees" is right _conceptually_ but the implementation is **stacking, not inheritance**. A "judge" isn't a class extending court-officer; a being acting as a judge has a roleFlow that stacks court-officer-base + judge-specifics, possibly with phase modifiers also stacked.

This is also why your point 3 lands cleanly — see below.

## Point 3: roleFlows glue role pieces together

Yes. Exactly. The roleFlow IS the composition mechanism. A complex behavior isn't one big role; it's a roleFlow that conditionally stacks multiple smaller roles based on world state.

For a complex judge being:

```
roleFlow: [
  // Always stack the base
  { stack: true, role: "court-officer-base" },

  // Stack the judge-shared base
  { stack: true, role: "judge-base" },

  // Phase-specific primary (one matches at a time)
  { when: { "space.quality.case.phase": "opening" }, role: "judge-opening" },
  { when: { "space.quality.case.phase": "evidence" }, role: "judge-evidence" },
  { when: { "space.quality.case.phase": "ruling" }, role: "judge-ruling" },

  // Fallback if no phase set
  { role: "judge-idle" },

  // Modifiers
  { stack: true, when: { ... }, role: "emotions:focused" },
]
```

The roleFlow expresses the whole behavioral program. Smaller roles, glued together, conditionally composed. Each role definition stays simple and focused.

## Point 4: smaller context per call, focused LLM attention

This is the practical payoff. When the LLM is in `judge-opening` mode, its prompt is just opening-procedure stuff + base court-officer stuff. Not the full 3000 tokens of all-judge-everything. The LLM has less to consider, fewer canDo options to pick from, less chance to pick the wrong one.

This is real. LLMs measurably perform worse with bloated prompts and large tool surfaces. Splitting roles is not just architectural cleanliness — it's a performance improvement.

There's an empirical finding worth knowing: tool-calling accuracy drops noticeably when models are given more than about 10-15 tools per call, and drops sharply past 30. A `judge-opening` role with 5 tools focused on opening-phase actions is going to outperform a `judge` role with 50 tools spanning every phase.

So you're getting two wins from decomposition: cleaner architecture _and_ better LLM behavior.

## Point 5: user preference / context limits / design choice

This is honest. The substrate should _allow_ both monolithic and decomposed roles. Some people will write 50-canDo roles and that's their choice; the substrate doesn't enforce decomposition. The right thing is to make decomposition _easy and natural_ (which you have via stacking) and let authors choose.

For complex worlds (a court system, a factory, a city simulation), decomposition will be necessary because the prompt explosion otherwise becomes unworkable. For simple worlds (the dance floor), monolithic roles are fine.

The substrate is neutral. Authors choose based on their world's complexity.

## Point 6: the two reality-manager roles — this is the unlock

This is the most important point in your list. Let me read it back:

> 1. translate yours request into a premade role
> 2. translate raw English into role flows, shows idea, and can edit or have it edit in loop, and then save

What you're describing is **the role-manager being should have LLM-powered authoring tools**.

Currently, authoring a role or roleFlow means filling out a form: pick canDo entries, write the system prompt, build the conditions. That's tedious for complex roles. What you're proposing is:

**Authoring role 1**: "I want a role that does X" → the LLM looks at existing roles in the registry, finds matches or near-matches, suggests "this seems like 'court-officer' with some 'judge' aspects" or "no good match exists; here's a draft." The user picks or accepts.

**Authoring role 2**: "When a court session starts and I'm in the courtroom, become a judge. Open hearings get the opening procedure; evidence phase, I review and respond; ruling phase, I make the call. Otherwise I'm just a court-watcher." → the LLM translates that English into the structured roleFlow with appropriate when-conditions, stacked modifiers, and phase-specific role selections. Shows it to the user. User edits or accepts.

This is _huge_. It transforms TreeOS from "a thing programmers configure" to "a thing anyone can author by talking to it." The substrate already has the primitives (roles, roleFlow, stacking, conditions); what was missing was the authoring affordance. Your two LLM-helper roles ARE the authoring affordance.

And critically — these helper roles are themselves just roles in the system. They use the substrate's own role-manager primitives (canDo: ["create-role", "update-role", "create-roleFlow"], etc.). The system bootstraps itself. The role-manager's tools include LLMs that author roles.

For this to work well, the LLM-helper roles need:

- canSee on the role registry (to suggest existing matches)
- canSee on the condition vocabulary (to author valid when-clauses)
- canDo on create-role, update-role, set-roleFlow, etc.
- A system prompt explaining the conventions (modifier vs primary, conditions, stacking)

Then in conversation, the user describes what they want. The role-helper drafts something. The user reviews. Conversation iterates. Save.

**This is the user interface for TreeOS at scale.** Not forms. Not code. Conversation with a being whose job is to help you compose worlds.

It also generalizes — once this pattern works for roles, it works for everything authorable. A "space architect" role that helps you design and place spaces. A "world designer" role that helps you set up world signals and time-based triggers. The reality-manager isn't a UI; it's a collection of LLM-powered helper beings that mediate authoring.

## Point 7: rulership and worker delegation

You're sketching out something I'd call **delegation patterns**: a "boss" role doesn't do work directly, it summons workers with specific roles tailored to the task.

A "factory-manager" role doesn't manufacture skateboards; it summons "factory-worker" beings with roles tailored to specific jobs (cutting, assembly, painting, QA). The manager's canDo includes summoning various worker types; the workers' roles are focused single-task roles.

This is the same decomposition principle applied across beings rather than within one being. Instead of one giant manager-being doing everything, you have a manager-being that coordinates many smaller worker-beings.

For this to work cleanly:

- The manager's role has canSummon for the worker types it manages.
- The worker beings can be ephemeral (born to do a task, complete it, released) or persistent (always around, waiting for work).
- The manager's roleFlow determines which workers to summon based on world state (incoming orders, queue length, etc.).
- Workers might have their own roleFlows that determine what they do once summoned.

This is "OS for AI agents" being literal: TreeOS becomes a substrate where teams of agents coordinate through roles, with the role/roleFlow system being the coordination primitive.

And it composes with your point 6: when you author the manager's roleFlow in English ("when there's a backlog of more than 10 orders, summon more workers"), the LLM-helper does the structural translation. You describe the organization; the helper authors the implementation.

## Putting it all together — what to do with this

You've sketched a coherent design that has several pieces, in rough priority:

1. **Doctrinal landing on stacking-over-inheritance.** Confirm that role composition happens through stacking in roleFlow, not through role-class hierarchies. The current substrate already supports this; just pin it as the canonical pattern in docs.

2. **Documentation/examples of decomposed roles.** Build out the court example (or another complex example) showing how a "judge" decomposes into base + phase-specific + modifiers. This becomes the canonical pattern people follow.

3. **The two role-manager LLM helpers (your point 6).** This is the unlock. Two roles for the role-manager that take natural-language requests and produce structured roles/roleFlows. Saves users from form-filling; makes the substrate accessible.

4. **Delegation patterns documented (your point 7).** Show how manager-roles summon worker-roles. Maybe ship a small example (a simple factory? a kitchen? whatever has clear hierarchical work).

Of these, item 3 is the _highest-leverage_ item. It's not a substrate change — it's a role definition (or two role definitions) that you build using existing primitives. Maybe a day of work for the role definitions plus their system prompts. The payoff is enormous: every future user of TreeOS can author roles by describing them, not by filling out forms.

Items 1 and 2 are documentation that supports item 3. Item 4 is a pattern that's already supported and just needs canonical examples.

## What I'd send to the agent (alongside the Slice B work)

This is something to queue up for after Slice B + branches land, but worth telling him now so he can think about it:

---

Tabor sketched out a design for role composition and authoring that's worth queuing for after the branch arc completes. Three key pieces:

**1. Role decomposition pattern.** Complex behaviors (judges, factory managers, etc.) shouldn't be single monolithic roles with 50 canDo entries. They should be roleFlows that conditionally stack smaller focused roles based on world state. The substrate already supports this via stacking; what's needed is documentation and canonical examples showing the pattern (the court/judge example would be good).

The pattern: a complex being has a roleFlow that stacks shared bases (modifier roles always-on like "court-officer-base") + phase-specific primaries (selected by world state like `space.quality.case.phase`) + situational modifiers (stacked when conditions match). The LLM in each moment sees a focused composed prompt, not the full union of all possible behaviors.

**2. Role-as-stacked-composition, not inheritance.** Doctrine to pin: roles don't extend other roles via class-style inheritance. Composition happens at the roleFlow level via stacking. This keeps composition explicit, per-moment, and condition-driven. Worth a paragraph in the role-manager docs to prevent people from asking for `extends:` field.

**3. LLM-powered authoring roles in role-manager.** The unlock. Two new roles for the role-manager being:

- **"Find or suggest a role"** role: canSee on the role registry. User says "I want a role that does X." The role's LLM looks for matches, suggests "court-officer with some judge aspects" or drafts a new role. User edits/accepts via conversation.

- **"Compose roleFlow from English"** role: canSee on registry + canSee on condition vocabulary + canDo on set-roleFlow. User says "when court session starts and I'm in courtroom, become judge; opening phase does X, evidence does Y, ruling does Z." The role's LLM translates to a structured roleFlow with proper conditions and stacking. Shows the result. Iterates with user edits. Saves on approval.

These are role definitions, not substrate changes. They use existing primitives. Maybe a day of work each for the role definitions + system prompts + conversation loop integration.

This transforms the authoring experience from "fill out a form" to "describe what you want." It also generalizes — once you have LLM-helpers for role authoring, you can build similar helpers for space design, world-signal setup, anything authorable in the substrate.

Worth queuing after branches land. Don't bundle with current work. But this is the user-facing payoff for the substrate work — what makes TreeOS accessible to non-programmers.

---

That's the message to queue up. For you specifically — point 6 is the most valuable thing in your list. The substrate's done a lot of work to make composition possible; the helper-roles are what make it _usable_. Worth prioritizing those after the branch arc completes.

You're seeing the right shape. Role composition through stacking, not inheritance. Sequence through world state, not role history. LLM-helpers for authoring. Delegation through summon. Each piece is grounded in primitives the substrate already has; the work is mostly documentation, examples, and one set of well-crafted helper-role definitions. Substantial product surface ahead, but the substrate supports all of it cleanly.
