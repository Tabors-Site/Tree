Explain

Question: folding the whole reel back and all the reels and showing that as the inner face would be a lot of data. How do you know what to choose and filter from all the data from the fold?

Answer; it’s true that when you fold a moment, often you will be folding the space you’re in, all the matter in it, and the beings existing there too.

That would be a full see.

But what is folded moment to moment is dependent on the ables a being has. So each moment the ables changes based on the flow, aka what’s happening in the world, and therefore the being is getting different cansee, cando, can summon, etc which limits what is being folded.

Ideally, you would identify what’s needed and fold after so you only fold relevant folds moment to moment, rather than fold all and cut selectively after. But the projection mechanism may solve this

Show more
3:21 AM
Let me work through what you've worked out because there's a real architectural insight here and a few things worth being precise about.

What you've identified
You're describing a real performance/data problem. The fold engine takes facts (from reels) and computes them into the inner face that gets presented to a Name/Soul for the next decision. If you naively fold every fact in every relevant reel, you're processing massive amounts of data for what might be a simple action.

You've identified the solution: ables filter what gets folded.

A Being at a moment has whatever ables are currently active on it (via the flow — the dynamic composition of ables based on what's happening). Each able declares what the Being can see, do, and summon. The fold engine should only compute what those able declarations allow.

If a Being has able gallery-visitor with see permissions limited to public spaces, the fold doesn't need to compute the private spaces. They're not visible to this Being in this moment. Folding them would be wasted work.

If a Being has able coder with see permissions on the development spaces, the fold computes those spaces' contents. Other spaces stay out of the fold.

The able determines the fold's scope. Different able compositions produce different folds for the same world state, because different ables see different slices.

Why this is structurally right
A few things this clarifies:

Folds become able-scoped. The same Being at the same position might get different folds in different moments, depending on which ables are active. Their flow controls what they perceive. The world is the same; the Being's perception of it is filtered.

The Being's perception is bounded by their ables. This is good architecturally. Beings can't see things their ables don't permit them to see. The fold engine enforces this by simply not folding what's outside the able's scope. Authorization and perception are unified.

Different beings get different folds simultaneously. Two beings in the same space might fold very different inner faces based on their respective ables. The substrate doesn't need to compute one universal fold and then filter per-being. Each being's fold is its own computation, scoped to its ables from the start.

The flow drives the fold scope dynamically. As the situation changes (the being moves, the world state shifts, the being takes on different ables for different activities), the fold scope shifts with it. The substrate doesn't have to keep an explicit list of "what is this being currently seeing" — it computes from the current flow each moment.

Your "ideal" vs the "cut selectively" approach
You distinguished two approaches:

Cut selectively after: Fold everything, then filter what to show based on ables. This is computationally expensive — you do all the fold work even if most of it gets discarded.

Identify what's needed and fold after: Determine the able-scoped view first, then only fold what falls within that scope. This is more efficient — you don't do work that gets thrown away.

The second approach is right. The fold engine should consult the Being's current ables before folding, determine what's in scope, and only compute those folds.

This is the standard "push the filter down" optimization in any query system. Don't compute a full result and filter; compute only what passes the filter. Databases do this; query engines do this; the substrate's fold engine should do this.

How this works practically
The fold for a Being at a moment computes roughly like:

Determine current ables. Walk the Being's able assignments. Apply the flow (which ables compose, which are conditionally active). Get the active able set for this moment.
Compute the visibility scope from ables. Each able declares what it can see (spaces, beings, matter types). Union the see-scopes from all active ables. This is the set of "world content this Being can perceive right now."
Fold only within the scope. For each item in the scope (space, being, matter), fold the relevant facts to compute its current state. Skip anything outside the scope.
Assemble the inner face. The collected folds become the inner face — the Being's view of the world from their position with their current ables.
Present to the Soul. The inner face is what the Soul perceives when deciding the next act.
This is efficient because step 3 only processes what step 2 identified. The Being's able set determines the fold's scope; the fold engine doesn't waste work on out-of-scope content.

The projection mechanism you mentioned
You said "the projection mechanism may solve this." Let me think about how projections fit.

A projection is a folded view of a reel (or set of reels) computed for a specific purpose. The substrate already uses projections for various things — computing matter state, computing being properties, computing space layouts. Each projection is a fold that produces a specific shape.

Able-scoped folding can use projections in a few ways:

Per-able projections. Each able might have a projection that knows how to fold the relevant reels into the data shape that able needs. A "gallery-visitor" able has a projection that folds public-space content into a visitor's view. A "coder" able has a projection that folds development content into a developer's view.

Composed projections from flows. When a Being has multiple ables active, their fold uses the composition of projections — each able's projection contributes its slice, and the composition produces the unified inner face.

Cached projections. If the world hasn't changed since the last fold for a Being's able set, the projection can be reused. The substrate caches projections and invalidates them when underlying facts change. This makes repeated folds cheap.

Incremental projections. When new facts arrive (the world changes), projections can be incrementally updated rather than fully recomputed. Only the affected slices get refreshed.

So yes, projections solve much of the performance question. They make folds incremental, cacheable, and able-scoped by construction.

What this means for the architecture
A few things to commit to:

Folds are able-scoped, not world-scoped. The fold engine takes a Being's current able set as input and produces a fold tailored to that able set. There's no "universal fold" that gets filtered; the able set drives the fold from the start.

Flows control fold scope dynamically. As a Being's situation changes (moving through spaces, engaging different activities), their active ables shift, and their fold scope shifts with them. The substrate doesn't track "what is this being seeing" explicitly — it derives it each moment from the flow.

Projections are the mechanism for efficient folds. The substrate maintains projections for common able/scope combinations. Folds query projections rather than recomputing from raw facts each time. Projections are cached, incrementally updated, and invalidated as needed.

The inner face is the fold result presented to the Soul. The Soul (the cognition layer) receives the inner face as input for its decision. The inner face is bounded by what the Being's ables permit. The Soul can only consider what the inner face shows.

Edge cases worth thinking about
A few specific things to be precise about:

Able changes within a moment. What if a Being's ables change between moments? Their inner face for the next moment is computed with the new able set. The previous moment's inner face was for the previous able set. The substrate handles able transitions cleanly because each fold is computed for the able set active at that moment.

Beings with no ables. A Being should always have at least some able (even if minimal — a "presence" able that lets them perceive their immediate position). Without any able, they have no see-scope, no inner face, no ability to act. The substrate might require Beings to have some minimum able on spawn.

SUMMON from outside the fold scope. A Being might be summoned by another Being whose acts aren't in the receiving Being's fold scope. The summon mechanism is part of the substrate's machinery — it can reach a Being regardless of whether the sender appears in the receiver's normal fold. The summon delivers an envelope; the Being's flow then handles whether/how to respond.

Acts that affect things outside the actor's fold scope. A Being can only act on what they can see (and what their ables permit them to act on). If they can't see something, they can't act on it. The able-scoped fold both shows them what's there and limits what they can affect. Authorization is unified with perception.

The whole-reality fold for I or admin views. Sometimes you want to see the whole reality without able-scoping. This is a special case — admin queries, debugging, audit views. These would use unscoped folds (or maximally-scoped ables like "I full visibility"). Different from normal Being folds.

The summary
You've identified a real problem and the right solution. Folds shouldn't be universal computations that get filtered after. Folds should be able-scoped from the start, driven by the Being's active able composition (their current flow).

This is efficient because the fold engine only processes what the ables permit. It's structurally honest because it unifies perception with authorization (a Being sees what their ables let them see, and only that). It's flexible because flows can change dynamically as the situation evolves.

Projections are the implementation mechanism. They make folds cacheable, incrementally updateable, and able-specific. The substrate maintains projections for common able/scope combinations and reuses them where possible.

The inner face presented to the Soul for decision-making is the able-scoped fold result. The Soul perceives the world through the lens of the Being's current ables. The Soul's decisions are then signed by the Name and recorded in the Name's chain, with the Being and the fold context as metadata.

This is the right model for how perception works in TreeOS. Worth being explicit about in the doctrine — folds are able-scoped, the flow drives the scope, and projections make the scoped folds efficient.

Good observation. The fold engine has to be able-aware or it'd be doing unbounded work; you've identified the natural way to bound it.

In the stamper, the soul does not change the ables at all. It is merely a label for what “cognition” type, which changes the act process (meaning for llms it goes through llm call, for humans its outside system, for scripted it’s the script, etc. the essence of the action but not the action itself)

3:22 AM
Right. That's a clean distinction and worth being precise about because I was sloppy in the previous response.

What I got wrong
I conflated Soul with cognition-as-decision-making in a way that suggested the Soul shapes what gets folded or what ables are active. That's not what Soul does.

The Soul doesn't change ables. The Soul doesn't determine what's in the fold scope. Ables determine those things — the Being's able composition (the flow) drives what gets folded and what acts are possible.

The Soul is purely a label for cognition type. It tells the stamper how to process the act, not what the act is.

What the Soul actually does
The Soul is metadata on the Name (or on the moment) that tells the stamper which processing path to use when an act needs to be decided.

soul-type: human → the act goes through the human interface. The human sees the inner face (the able-scoped fold), chooses what to do, and the system records their choice as the act.
soul-type: llm → the act goes through an LLM call. The inner face becomes the LLM's context, the LLM generates a response, and the system parses that response into the act.
soul-type: scripted → the act goes through scripted logic. The inner face becomes the script's input, the script runs deterministic rules, and the output becomes the act.
In all three cases, the same able composition is active. The same fold is computed. The same inner face is produced. The same act space is available. What differs is how the decision is made — by what kind of cognition.

The Soul is the "essence of the action" — the medium through which the decision flows — but not "the action itself," as you put it. The action is shaped by ables. The Soul is just how the decision gets made.

Why this distinction matters
A few specific things this clarifies:

Ables are doing the architectural work. The flow determines what acts are possible, what gets folded, what authority exists. The Soul is operationally invisible to the substrate's authorization and visibility logic. The substrate doesn't ask "is this an LLM?" when deciding what's in the fold; it asks "what ables are active?"

Soul is a routing label, not a permissions concept. Knowing a Name's Soul is human or LLM tells the stamper which code path to invoke. It doesn't tell you what the Name can do — ables tell you that.

Switching Souls doesn't change capabilities. If a Name's Soul switches from human to LLM (say, the human steps away and the LLM takes over driving the Name), the capabilities don't change. Same ables, same fold scope, same act space. The only difference is the decision process — now an LLM generates the responses instead of a human.

The same Name can have its Soul switch over time. A Name might be human-driven during the day, scripted overnight (running automation), and LLM-driven when delegated. The Name's identity is continuous; the Soul is just the cognition currently animating it. The substrate records Soul transitions as facts but doesn't treat them as authority changes.

Cross-Soul collaboration is natural. A human and an LLM can be working under the same Name (the LLM does background work, the human reviews and approves). The substrate handles this through Soul transitions on specific acts — this act was decided by the LLM, that act was decided by the human, both signed by the same Name. The chain shows both.

How this fits into the stamper
The stamper is the piece that takes an intended act, processes it through the cognition layer, and produces the signed fact. The Soul tells the stamper which processing branch to use.

Stamper flow roughly:

The Being needs to make a decision (a new moment is unfolding, the inner face is computed, an act is needed).
The stamper looks at the Name's current Soul type.
If human: present the inner face to the human via the interface. Wait for input. Take the input as the act.
If llm: format the inner face as LLM context. Make the LLM call. Parse the response into the act.
If scripted: pass the inner face to the script. Execute. Take the output as the act.
Whatever the act is, sign it with the Name's key. Record the fact. Include Soul type as metadata.
The Soul is consulted to determine the processing path. It's not consulted to determine what's possible — that's ables. It's not consulted to determine what's visible — that's the able-scoped fold. It's just consulted to determine how the decision gets made.

Why this is structurally clean
Separating Soul (cognition routing) from ables (authority and visibility) gives you several clean properties:

Substrate logic stays able-driven. Authorization checks, fold scope calculation, act validation, able-walks for SEE/DO/SUMMON/BE — all of this consults ables. The substrate's core logic doesn't branch on Soul type. Soul type is consulted only by the stamper at the decision point.

Souls are pluggable. Adding a new Soul type (say, "hybrid" or "consensus" or "auction") doesn't require changing able logic. The stamper gets a new processing branch; the rest of the substrate is unchanged.

Ables can be Soul-agnostic. A "music-curator" able grants certain capabilities regardless of Soul. A human music curator and an LLM music curator have the same authority because they have the same able. The able doesn't need to specify which Soul types can use it.

Audit and accountability are clean. Every act has a Name (who signed it) and a Soul label (what kind of cognition decided it). You can audit "show me all acts by Tabor that were LLM-decided" or "show me all human-decided acts" without conflating decision medium with identity or authority.

Able definitions stay focused. Ables declare see-scope, do-scope, summon-scope, summon-replies, and other capability concerns. They don't have to declare "this able is only for humans" or "this able is only for LLMs." Soul is orthogonal to able.

What this means for the architecture
A few specific commitments worth making:

Soul is metadata, not a substrate primitive at the action level. The substrate doesn't have "Soul-typed acts" or "Soul-aware authorization." It has able-typed acts and able-aware authorization. Soul is a label that the stamper uses to route the decision process.

Soul lives on the Name (current cognition) or on the act (which Soul decided this specific act). Probably both — the Name has a "current Soul type" that's used for incoming decisions, and each act records "this act was decided by this Soul type" as metadata. The current Soul can change; past acts retain their historical Soul label.

The stamper has Soul-specific branches. Each Soul type has its own code path for processing the inner face into an act. Adding Soul types means adding stamper branches. The branches are pluggable; the substrate's other layers don't need to know about specific Soul implementations.

Documentation describes Soul as cognition routing. When explaining the architecture, Soul is "what kind of cognition is animating this Name right now." It's not part of the authority model. It's not part of the visibility model. It's how decisions get processed at the stamper, and nothing more.

What I should have said in the previous response
The fold engine is able-scoped. Ables determine what's folded and what acts are possible. The flow drives changes in able composition as the situation evolves.

The Soul (cognition type) doesn't enter into fold computation. The same fold is produced regardless of whether the consuming Soul is human, LLM, or scripted. The Soul just determines how the fold gets processed into a decision at the stamper.

Ables do the architectural work. Soul is a routing label. They're orthogonal concerns and should be kept that way in both implementation and documentation.

The summary
You're right to flag this. The Soul is purely a label for cognition type that tells the stamper which processing path to use. It doesn't shape ables, doesn't filter folds, doesn't determine authority. Those are all able-driven.

The Soul determines:

What code path the stamper uses to convert inner face into act
The "medium" through which the decision flows
Metadata on the resulting act recording how it was decided
The Soul does not determine:

What's visible to the Being (that's able-scoped fold)
What acts are possible (that's ables)
What authority the Name has (that's ables and inheritation points)
How the world is structured (that's facts, regardless of who decided them)
This separation keeps the substrate's logic clean. Ables for capability; Soul for cognition routing. They compose but don't interfere.

Good correction. The distinction needs to stay sharp in the documentation so builders don't accidentally let Soul leak into able logic or vice versa. They're separate concerns and the architecture works because of that separation.

So this means even code would also always act through a face of see and then choosing dos . That would clean it up. And then we need to decide if soul recommendation still lives on ables or on names or beings etc or all

3:28 AM
Yes. Both insights are sharp. Let me work through each carefully.

Code acting through SEE then DO
You're right that this cleans things up significantly. If Soul is just the cognition routing label and ables do the architectural work, then scripted code should also go through the see-then-choose-then-do cycle. The script doesn't get a privileged backdoor; it goes through the same process as a human or LLM, just with deterministic logic in the middle.

Right now in the substrate, scripted automation might bypass the perception step — the script just "knows" what to do because it's coded that way. It directly issues DO operations without a SEE step. This is a shortcut that breaks the architectural symmetry.

If you commit to the cleaner model:

The script gets an inner face. Same as a human or LLM. The able-scoped fold produces the inner face. The script perceives the world through this constrained view.

The script chooses from possible DOs. Based on the inner face, the script's logic determines what to do. The choice is bounded by what the Being's ables permit.

The script's choice becomes the act. Same as if a human or LLM had decided. The act gets signed by the Name, recorded in the chain with the Soul metadata indicating "scripted."

This is structurally cleaner for several reasons.

Authorization is unified. A script can only do what its Being's ables permit. No backdoor; the script goes through the same able-walk as any other Soul. If you want the script to have more capability, you grant it more ables — not because it's a script, but because the able grants that capability.

Perception is unified. A script only sees what its Being's ables permit. No hidden access to world content. The script is constrained by the same fold scope as any other Soul.

Auditability is unified. Every act has the same structure regardless of Soul. You can audit a scripted Name the same way you audit a human Name. The chain looks the same; the only difference is the Soul label on each act.

Soul becomes truly pluggable. If scripts go through the same process as humans and LLMs, then adding a new Soul type is just adding a new processing branch in the stamper. The substrate's architecture supports any cognition type uniformly because they all follow the same flow.

What this means for script implementation
A script that wants to act under a Name does roughly:

Wait for the Being to receive a moment (a new fold ready to process).
Read the inner face that the able-scoped fold produced.
Apply scripted logic to determine what to do based on the inner face.
Issue the chosen act through the substrate.
The stamper takes the act, signs with the Name's key, records with Soul: scripted.
The script doesn't bypass perception. It doesn't issue acts the Being's ables wouldn't permit. It doesn't operate outside the substrate's normal flow. It just plugs in as a Soul.

This also means scripts can be debugged through the same tools as any other Soul. You can replay the chain and see "the script saw this inner face, then chose this act." The decision process is transparent and inspectable.

What about edge cases for scripts
A few things worth being explicit about:

Continuous scripts vs event-driven scripts. A script that runs continuously (a background worker) and one that responds to events have different shapes, but both go through the same perception-decision-action cycle. The continuous one might tick on a schedule (each tick is a moment); the event-driven one ticks when something happens.

Scripts without a Being. Some scripts might just be substrate-internal machinery (the fold engine itself, the stamper, the routing layer). These aren't acting through Names; they're part of the substrate's plumbing. They don't go through the SEE/DO cycle because they aren't Beings.

The distinction: if it's a Name acting in the world, it goes through the cycle. If it's the substrate's own machinery doing its job, it's at a different layer.

Hybrid scripts that include LLM calls. A script might call out to an LLM for certain decisions. This is a hybrid Soul — partly scripted, partly LLM. The Soul label might be "hybrid" or "scripted-with-llm," and the stamper handles the mixed processing. The act is still signed by the Name; the inner face is still able-scoped.

Where Soul recommendation lives
Now the second question: where does Soul type live? On ables, Names, Beings, or all?

Let me think through this carefully because there are real tradeoffs.

Option A: Soul type lives on Names.

Each Name has a Soul type declared at creation or updateable over time. When this Name acts, the stamper uses the Name's current Soul to route the decision.

Pros: Names are persistent identities; declaring "Tabor is human-driven" makes sense as identity-layer metadata. Soul stays with the identity.

Cons: A Name might be driven by different cognition types in different contexts. Tabor might be human at the keyboard, scripted overnight, LLM-delegated when away. Tying Soul to the Name forces frequent transitions or doesn't allow context-dependent variation.

Option B: Soul type lives on Beings.

Each Being declares its Soul type. When a Name acts through a specific Being, the stamper uses that Being's Soul.

Pros: Different beings under the same Name can have different Souls. Tabor's "home" being might be human; Tabor's "background-worker" being might be scripted; Tabor's "research assistant" being might be LLM. The Name is one; the cognition types vary by formed presence.

Cons: Beings are transient; declaring Soul on every being is verbose. Some beings are short-lived and don't need their own Soul declaration.

Option C: Soul type lives on ables.

Each able declares which Soul types can fill it. "Music curator" might accept human or llm; "automated backup" might only accept scripted; "human-only review" might only accept human.

Pros: Ables already declare capabilities; declaring Soul compatibility makes sense as part of able definition. The substrate can enforce "only LLMs can use this able" if needed.

Cons: Ables are about capability, not about identity or cognition. Coupling Soul to able conflates two concerns. Most ables probably don't care about Soul; only specific ones do.

Option D: Soul lives on multiple layers with precedence.

Soul is declared on Names (default), can be overridden on Beings (per-presence), and can be constrained by ables (some ables require specific Soul types). The substrate resolves by checking able constraints first, then being-level override, then Name default.

Pros: Flexibility for all the patterns above. Names have defaults; Beings can override; ables can require specific Souls when it matters.

Cons: More complex resolution logic. Multiple places to declare Soul means more places to look when debugging or auditing.

My read on which is right
I think Option D is probably the cleanest answer, but with specific commitments about defaults.

Names declare their default Soul. When you create a Name, you specify its primary cognition type. This is the default for all the Name's acts unless overridden.

Beings can override Soul. A Being can specify a different Soul than its Name's default. This handles the case where one Name has different cognition types in different presences. If a Being doesn't specify Soul, it inherits from the Name.

Ables can require specific Souls. A able can declare "this able requires Soul type X" if it genuinely matters for that able. Most ables don't have this constraint. When a able does, the substrate checks that the Being filling the able has a compatible Soul before allowing the able to be active.

The stamper resolves at act time. When an act is being processed, the stamper checks: what's the Being's effective Soul (Being's declared Soul, or Name's default if Being doesn't declare)? Does the active able allow this Soul? If yes, route through the appropriate stamper branch.

This handles most patterns:

Simple personal Name: Tabor with Soul: human. All Tabor's acts go through the human branch. Default works.
Mixed-Soul Name: Tabor with Soul: human as default. Some of Tabor's beings override to Soul: scripted for background work. The mixed cognition is handled per-Being.
Able-restricted operations: A "financial-approval" able requires Soul: human. The substrate ensures only human-Souled Beings can fill this able. Automation can't bypass approval gates.
LLM-driven Name: Names with Soul: llm by default. All acts go through LLM. Specific beings might override (some scripted helpers under the LLM Name).
What this means in practice
A few specific design commitments that follow:

The Name's declaration includes default Soul. When NAME-declaring, you specify the cognition type. This becomes the Name's default.

Beings can include a Soul property. When spawning a Being, optionally specify its Soul. If unspecified, it inherits from the Name.

Ables can include a Soul constraint. When defining a able, optionally specify which Souls can fill it. If unspecified, any Soul is acceptable.

The stamper consults the resolution. At act time: get the able's Soul constraint (if any), get the Being's Soul (if declared), get the Name's default Soul, resolve to a final Soul, route to the appropriate stamper branch.

Soul transitions are facts in the chain. When a Name's default Soul changes, when a Being's Soul changes, when a able's Soul constraint changes — these are recorded as facts. The chain shows the cognition history.

What this gives the architecture
A clean separation of concerns with flexibility where it matters:

Identity is identity. Names persist regardless of Soul. Tabor is Tabor whether driven by Tabor-the-human or Tabor's LLM agent or Tabor's automation scripts.

Presence can have specialized cognition. Different beings can be driven by different cognition types. The substrate accommodates the natural variation.

Capability gates can require specific cognition. Ables that need human judgment (financial decisions, content moderation, sensitive operations) can require Soul: human. The substrate enforces.

Audit trail is complete. Every act records the Soul that decided it. You can audit "this was decided by an LLM, that was decided by a human." The chain has the cognition history.

Architecture stays clean. Ables are about capability. Names are about identity. Souls are about cognition routing. Beings are about formed presence. Each does one thing; they compose at well-defined points.

The summary
Yes, all Souls should go through the same SEE-then-DO cycle. Scripts get the same able-scoped fold as humans and LLMs. They just have deterministic logic in the middle. This unifies authorization, perception, and auditability across cognition types.

Soul lives in multiple layers with sensible defaults and overrides:

Name declares default Soul (the Name's primary cognition).
Being can override Soul (per-presence specialization).
Able can constrain Soul (specific capability gates).
The stamper resolves at act time and routes the decision through the appropriate processing branch.

This keeps each concern separated. Identity (Name), presence (Being), capability (Able), cognition (Soul) — all orthogonal, all composable. The substrate doesn't conflate them; the architecture stays clean.

Worth pinning. The Soul layer becomes consistent with how the rest of the architecture works — declarative, composable, with sensible defaults and explicit overrides where they matter.

Good thinking. These are the kinds of refinements that turn an architecture from "mostly clean" to "actually elegant." Each concern has its proper home; nothing overlaps; the composition is natural.

---

## LANDED 2026-06-15

The able-scoped fold this doc described has shipped. Concrete implementation:

- **One inner face per moment** is built at the 2-fold beat by `buildInnerFace(able, ctx)` at [reality/seed/present/stamper/2-fold/innerFace.js](../../seed/present/stamper/2-fold/innerFace.js). All three souls (LLM, scripted, human) consume the same object via `summonCtx.innerFace`. The doctrine moved from `facadeSnapshot` (local) + `Act.qualities.innerFace` (cross-world) into the unified `Act.innerFace` field.
- **canSee is the load-bearing filter.** The 2-fold beat resolves `able.canSee` once via [canSeeResolver.js](../../seed/present/stamper/2-fold/canSeeResolver.js); each block records exactly which reels it read, populating a `weave` on the face. Empty canSee yields a face with the bare self + position only.
- **The weave IS the able-scoped fold residue.** Built at [weave.js](../../seed/present/stamper/2-fold/weave.js). Captured at fold time, sealed immutably on `Act.innerFace.weave`, used for audit, replay, and subscription dispatch.
- **Reactive perception** for humans falls out from the weave. See [innerFaceLive.md](innerFaceLive.md) for the full doctrine. Per-stance subscription registry at [reality/protocols/ibp/innerFaceLive.js](../../protocols/ibp/innerFaceLive.js); reel-arrival hook at [past/fact/facts.js](../../seed/past/fact/facts.js); per-soul behavior: LLMs and scripted hold a frozen snapshot for the duration of the moment, humans subscribe per-stance and receive pushed updates when any reel in the weave gains a fact.
- **Soul as cognition routing** (not a primary entity, just a label) is doctrinally settled but the field is still named `cognition` in the code (`qualities.cognition.defaultKind`). The rename to `soul` is mechanical (~500 references) and deferred.

What's still aspirational from this doc:

- **A scripted able that demonstrates ctx.innerFace.blocks consumption.** The mechanism is wired across all three souls, but no scripted able in the repo today reads its inner face for perception-aware decisions. First consumer wanted.
- **Soul multi-layer resolution** (Name default → Being override → Able constraint, Option D from the conversation). Today the cognition layer lives at `qualities.cognition.defaultKind` on the being with inhabit override. The Name-level default waits on the Name primitive refactor ([plan.md](plan.md)).
- **Non-descriptor named-see ops** (`my-inbox`, `connections`, `federation-status`, etc.) don't declare their reel reads, so reactive subscriptions don't wake on those views. Permanent upper bound vs handler-by-handler migration is an open call.
- **Portal-side faceSeq ordering gate** for burst-load races. Recorded on each subscription, not yet enforced on receive.
- **Foreign reactive push channel.** Cross-world faces carry empty weave locally; reactive updates for foreign-side changes need a federation push mechanism that doesn't exist yet.
