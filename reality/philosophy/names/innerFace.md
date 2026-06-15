# innerFace: the one face all souls see

Sibling doctrine to [stamperUpgrade.md](stamperUpgrade.md). stamperUpgrade
named the orientation: roles do the architectural work, soul is just
the cognition label. This doc pins the concrete invariant that follows:
one inner face per moment, shared across all souls, and that shared
face is what makes `role.canSee` actually mean something.

## The concept

Every moment computes ONE inner face. The three souls (human, llm,
scripted) all consume the same inner face. The cognition type determines
how the face is PRESENTED to the soul (LLM gets prompt context, human
gets a portal view, scripted gets the descriptor as a data argument)
and how the decision is processed back into an act. The face itself is
identical for all three.

`role.canSee` is the load-bearing filter. The role declares what gets
into the inner face. Whichever soul is animating the Name, they see
what the role permits, and nothing else.

## How it stands today

The mechanism is in place under two names that should be one.

**facadeSnapshot.** [reality/seed/present/beats/2-fold/facadeSnapshot.js](../../seed/present/beats/2-fold/facadeSnapshot.js)
defines the bounded record of the face the act was committed under.
[Act.facadeSnapshot](../../seed/past/act/act.js) carries it on the
chain. Captured at seal per INNER-FOLD §6 ("no half-records on the
act-chain"). The schema field exists today.

**innerFace.** [reality/seed/past/act/innerFace.js](../../seed/past/act/innerFace.js)
defines `Act.qualities.innerFace = { hash, descriptor }`, written by
the cross-world responder when a foreign reality's descriptor comes
back over the wire. Separate field, parallel name, same architectural
role.

Two names. One concept. They should be the same field.

## Current behavior gaps

**LLM path.** Goes through llmMoment which calls
`resolveCanSee(role.canSee, ctx)` and inlines the face blocks into the
system prompt. The LLM sees a rich, role-filtered face. canSee MEANS
something here.

**Scripted path.** `role.summon(message, ctx)` runs at
[3-momentum.js:91](../../seed/present/beats/3-momentum.js). The
moment falls back to `applyFallbackSnapshot` at
[moment.js:383](../../seed/present/moment.js) which records the
orientation, role name, and capabilities but writes
`face: { space, occupants: [] }`. No canSee resolution. The script
acts blind to what canSee declared, even though canSee was the
mechanism that should have shown it the world.

**Human path.** Portal builds its own view of the inbox and the world
view independently of `Act.facadeSnapshot`. The act ends up with a
snapshot recorded (via the same fallback), but the portal didn't read
from that snapshot to choose what to display. canSee may or may not
filter the portal view today; in practice the portal's perception
shape is wired separately from the role's canSee declaration.

**Cross-world path.** Already does the right thing for its case: the
foreign reality computes its descriptor (its own inner face), ships it
back, the responder attaches it to the actor's Act. Uses a different
field name and a separate attach call, but the concept is the same.

So today canSee is load-bearing for LLM, decorative for scripted,
fuzzy for human, and structurally separate for cross-world. The
mechanism for unification exists; it's just not wired uniformly.

## The unified target

One inner face per moment, computed at the fold beat (2-fold) by
resolving the active role's canSee against the current position. The
moment's summonCtx carries it (`ctx.innerFace`). All four paths read
from there:

- **LLM** reads `ctx.innerFace`, formats it into prompt context.
- **Scripted** reads `ctx.innerFace.descriptor` as a data object.
- **Human** portal reads from the act's innerFace field for its view,
  or computes it via the same canSee pipeline.
- **Cross-world** writes the foreign reality's descriptor into the
  same field on the actor's act (overrides the local face).

`Act.innerFace` is the one storage location. The field today named
`facadeSnapshot` becomes `innerFace`; the field today at
`qualities.innerFace` collapses into the top-level. One field, one
name, one concept.

## What this unlocks

**canSee actually means something for every soul.** The same role used
by an LLM, a script, and a human produces the same perception for all
three. Switching a role's canSee changes every cognition's view. No
soul gets a different view because of a code-path that didn't consult
canSee.

**Code-cognition beings become honest auditees.** [project_code_cognition_beings](../../seed/done/) says
scripted beings are first-class citizens alongside LLM and human
beings. Today their decisions are opaque to replay (we know the act
they emitted but not what they saw). With the unified inner face,
every scripted decision carries the same audit trail as every LLM and
human decision.

**Cross-world doctrine collapses into local doctrine.** The cross-world
"inner face" is the same field. The foreign reality's contribution is
"whose descriptor populates the face." The mechanism stays. The doctrine
shrinks to: every act has an inner face. Period.

**The fold engine optimization path opens up.** Once canSee is the
load-bearing filter, [stamperUpgrade.md](stamperUpgrade.md)'s
role-scoped fold becomes the natural follow-up. The fold engine only
computes what canSee admits. Today the LLM path already does this via
resolveCanSee; the broader fold engine just adopts the same shape.

## Mechanics

1. **Fold beat computes the inner face.** Move canSee resolution out
   of llmMoment.js into the 2-fold beat. The fold produces a
   descriptor object with the face blocks resolved per canSee. Output
   shape matches today's facadeSnapshot extended with the resolved
   face.

2. **Inner face attaches to summonCtx.** The 3-momentum dispatcher
   carries it on the ctx it hands to role.summon. Scripted code reads
   `ctx.innerFace.descriptor` (or whatever shape is canonical).

3. **LLM path reads from ctx.** Stop rebuilding in llmMoment;
   consume what the fold already produced. Removes the per-path
   rebuild and the divergence risk.

4. **Human portal reads from Act.innerFace.** The portal's display
   pulls from the same field every other soul reads. canSee changes
   show up in the portal automatically.

5. **Seal attaches to Act.innerFace.** Rename the schema field.
   facadeSnapshot retires. Mongo migration not needed at fresh-build.

6. **Cross-world responder writes the same field.** Same target
   field, different source (foreign descriptor instead of local
   fold). The responder still runs post-seal; the field name aligns.

Each step is independently shippable. The rename comes last; the
unification of the build site is the architectural work.

## Open questions to resolve before building

**How does the inner face render to a human?** LLM gets prompt blocks,
scripted gets the descriptor object. Human gets a GUI. The portal
needs a renderer that takes the inner face structure and produces the
view. That renderer is the portal's responsibility, not the substrate's,
but the substrate has to produce a structure rich enough for the portal
to render against. Likely: the descriptor object includes both the face
blocks (per canSee) and any structural fields the portal needs.

**What does `face` look like when canSee is empty?** A role with no
canSee declares no perception. The current fallback writes empty
occupants and bare orientation. Should that case still produce a
substantive inner face from canDo + canSummon + canBe (the verbs the
soul COULD invoke), or should it be genuinely empty? Probably the
latter: an empty canSee means "this role doesn't perceive anything,"
and the cognition layer routes that through. A role with action
capabilities but no perception is a valid shape.

**Soul-renamed terminology in the doctrine docs.** Today's docs
(INNER-FOLD.md, MODEL.md, CROSS-WORLD.md) use "cognition" and
"facadeSnapshot." The rename to "soul" and "innerFace" can land in a
single doctrine sweep alongside the code rename.

## See also

- [stamperUpgrade.md](stamperUpgrade.md) on roles as the architectural
  work, soul as the cognition routing label.
- [names.md](names.md) on the Name/Soul/Being separation.
- [reality/seed/past/act/innerFace.js](../../seed/past/act/innerFace.js)
  on the cross-world attach mechanism (the half of the rename that's
  already named innerFace).
- [reality/seed/present/beats/2-fold/facadeSnapshot.js](../../seed/present/beats/2-fold/facadeSnapshot.js)
  on the local snapshot mechanism (the half that becomes innerFace).
