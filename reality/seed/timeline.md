Ok going back to just node js app a few ideas I had: 1) a timeline : can pull it back to fold the world back to any moment to see what it looked like from your being, like a rewind. I don’t think it would be live but just like a view for that being rendered. But then I wondered if you could build the same thing to pull back the whole world back to a past in human time to recover, and then branch off from there, or just keep going but fresh. I want to know how this is possible with reels.
And then I thought of a past-fold being you could talk to to basically ask about any moment in the past to get answers2:00 AMClaude responded: These are good ideas and they connect to something the substrate already supports more deeply than you might realize.These are good ideas and they connect to something the substrate already supports more deeply than you might realize. Let me work through each one and be honest about what's straightforward, what's tricky, and where the real design questions live.
The personal timeline rewind
This one is the cleanest of the three. It maps directly onto what folding already does — you're just folding to a different point in time than "now."
Right now, when a being takes a moment, the substrate folds the world from that being's perspective at the moment's receivedAt time. Folding walks the relevant reels, projects facts forward, and produces the face the being SEEs. The fold is already a function of which facts have been considered so far. You stop at the current moment's receivedAt and that's "now."
To rewind: stop earlier. Fold the same reels but only consider facts whose seq is ≤ some target seq (or whose at timestamp is ≤ some target timestamp). The fold engine doesn't care that the target is in the past instead of "now"; it just needs to know where to stop.
The output is a face — exactly the shape the being would have SEEn at that past moment. The portal renders it the same way it renders any face today. The user sees their being's view of the world as it was at that past point.
A few things this needs:
A "fold-to-seq" capability in the substrate. The fold engine probably already supports stopping at a given seq — that's how replay works. Make it accessible via a SEE-like operation: fold(target, atSeq: 12347) returns the face as of that seq. If it doesn't exist as an exposed API yet, it's a small addition.
A timeline UI in the portal. A horizontal slider or a list of moments, with the current "now" on the right. Drag back or click a past moment, the portal re-renders from the folded-at-that-time face. The render is exactly the same code path as live rendering, just fed a face from a different point in time.
Some indication that you're in the past. A visual cue — desaturated colors, a "viewing past" banner, a timestamp label. So the user doesn't get confused about whether their acts will affect anything. Acts in the past don't change anything; they'd just be visual rendering of a snapshot.
Read-only enforcement. The being can't take acts while viewing the past. The portal grays out action UIs or just rejects attempts. Conceptually you're viewing a frozen snapshot; you can't act in a moment that's already over.
This is genuinely small to build. Maybe a few hundred lines plus some UI work. The substrate has the primitive (fold-to-seq); the UI surfaces it. The result is genuinely magical to use — slide back through time and watch your being's view of the world rewind.
Folding the whole world back
This is where it gets interesting and where the real design question lives. Your individual being's timeline is one reel folded; the whole world is many reels folded.
The complication: different beings have different reels, and those reels have their own sequences. Being A's reel might be at seq 1500; being B's reel might be at seq 300. There's no global clock that says "the whole world is at seq X." Each reel has its own local progression.
So "rewind the world to the past" has to mean: rewind every reel to its state at some chosen point. The "point" needs to be expressed in human time (a timestamp) because that's the only thing all reels share.
The mechanism:

Pick a target timestamp — say, "yesterday at 3pm."
For each reel in the world, fold to the latest fact whose at timestamp is ≤ the target.
Build a projection of the entire world at that moment in time.
Render the portal from this whole-world fold.

This is expensive if done naively — folding every reel is touching potentially millions of facts. But the cost is well-defined; the substrate's projection mechanism already handles per-reel folding. You're parallelizing the operation across reels.
What you get: the portal can render the whole world as it was at any past timestamp. Walk around, see beings where they were, see spaces in their past states, see matter with past qualities. You're viewing a snapshot of the entire world.
This is also read-only. You can't take acts in the past; you're observing.
Doing this live (i.e., the world keeps progressing while you view the past) requires keeping the "real" world running while your portal renders the snapshot. The substrate already separates "rendering" from "running" — your portal is just a viewer. Multiple viewers can be at different times simultaneously. One person watches yesterday; another watches now. The world doesn't care.
Branching off from a past point
Now the question gets architecturally interesting. You said: "branch off from there." This is where event-sourced systems diverge from systems that just rewind state.
A reel is a hash-chained, append-only sequence. You can't modify it without breaking the hash chain. You can't go back to seq 500 and say "okay, the world continues from here" because anything new written would be a fork, not a continuation.
But forking is a thing event-sourced systems can do, and the substrate could support it explicitly. Here's the shape:
A branch is a new world with a copied chain prefix. You pick a target timestamp (or per-reel sequence point) in the existing world and say "create a new world that has the same history up to this point." The substrate copies the chain prefix into the new world. The new world has its own genesis (a meta-fact saying "this is a branch from world X at point Y"), but its actual content history matches the original up to the branch point.
After the branch is created, the new world starts running independently. New facts on it don't affect the original. New facts on the original don't affect the branch. Two worlds, sharing history, diverging from the branch point.
This is essentially how Git works: a branch is a pointer to a commit, and new commits on the branch form their own line without affecting the main branch.
For TreeOS, this would mean:

A new world identifier. Each branched world has its own root identity. The portal can connect to either the original or the branch.
Reels are forked at branch time. Each reel in the original world becomes a starting point for a corresponding reel in the new world. Same facts up to the branch; future facts diverge.
Beings might or might not transfer. A judgment call: do beings in the original world get "copies" in the branch? Probably yes by default — the branch contains the world as it was at the branch point, which includes all the beings that existed then.
The fork is itself a fact in some meta-chain. Recording "branch X was forked from world Y at point Z by being W" preserves provenance.

This is a real architectural feature, not trivial. But it's not insurmountable — the substrate's primitives support it. You'd need to design how branches are addressed in IBP (probably a branch-id qualifier on world references), how cross-branch SEE works (probably it doesn't, branches are isolated by default), and how the storage layer handles divergence efficiently (probably copy-on-write for projections, sharing the historical chain prefix).
Use cases:

Experiments. "What if we made this change in the world?" Branch, try it, see what happens. The original world keeps running. If the branch produces interesting results, possibly merge insights back (manually — automatic merge of event-sourced worlds is hard).
Disaster recovery. "Bad thing happened in production. Branch from yesterday morning, run forward with corrected actions, replace production with the recovered branch."
Testing. "Before deploying this change, let's branch the current world and test the change in the branch first."
Versioning. "Save the world state at this milestone as a permanent branch we can come back to." Like Git tags but for living worlds.

This is genuinely powerful. Most production systems can't do this at all. TreeOS could because the chain is the truth and the chain is forkable.
"Keep going but fresh"
The other option you mentioned. You're saying: take the world back to a past point, but instead of branching from there, just restart from there — the original future is erased, the new future begins from the past point.
This is harder than branching, doctrinally, because it breaks the append-only invariant. The reels after the rewind point would have to be deleted, and that's "going back" in a way the substrate is designed to prevent.
But there's a clean implementation: the rewind is itself a branch operation, and the original is archived rather than deleted. You're not really erasing the future; you're declaring "from now on, the branch is the active world; the old future is retained for reference but isn't being added to."
So mechanically it's the same as branching. The difference is just which branch is "the live world" and which is archive. You could even support multiple parallel live branches if you wanted — though that gets confusing for users quickly.
For the case of "rolled back after a mistake," the flow would be:

Something bad happened at point X in the world.
Operator decides to rewind.
Substrate creates a branch from point X-1 (just before the bad thing).
The branch becomes the live world.
The original is archived; you can still SEE it via the timeline viewer, but no new facts are added to it.

This preserves the chain's integrity (the original world's reels are intact and immutable) while letting operators recover from disasters.
The past-fold being
This is the most architecturally interesting of the three ideas, and where I want to push on the design honestly.
You're describing a being whose role is "answer questions about any past state of the world." The user asks "what was happening in the dance floor at 3pm yesterday?" and this being walks the chain, folds the relevant reels, formulates an answer.
This is implementable and powerful. Some design notes:
The being's tools should be fold-to-time and SEE-at-time operations. Give the being canDo permissions for fold-historical(targetBeing, atTime) and see-historical(target, atTime). These are read-only operations that the substrate exposes for historical viewing. The being uses them to gather information from the past.
The being's cognition is LLM. Given the question and the historical data it can pull, it composes an answer in natural language. "At 3pm yesterday, the dance floor had 4 dancers active. Wallflower-21 was at position (3,5) and had just completed a step. The drummer was ticking at beat 14. The space-tile at (3,5) was unhighlighted."
The being's reel records every question asked. Each query is a fact. Each answer is a fact. You can replay your "asking the past-fold being" history. Useful for audit, debugging your own thinking, or just remembering what you'd looked up before.
The being can be inhabited. A user can BE-switch into this being and ask the questions directly (rather than summoning it from outside). When inhabited, the being is the user's lens into history. It's a different way of "being" — instead of acting in the present, you're navigating the past.
Constraint: it can only see what it's authorized to see. The past-fold being's role determines which reels it can fold. By default it might be limited to public spaces or to its own minting tree. Highly privileged versions might exist (a reality-root past-fold being that can SEE anything). Standard substrate auth applies.
This is a really good idea. It makes the past queryable rather than just rewindable. Most users don't want to slide a timeline; they want to ask a question. The past-fold being is the natural interface.
Possible enhancements:

Multi-query memory. The being remembers your previous questions and uses them as context for follow-ups. "When did the dance start?" → "Earlier, around 2pm yesterday." "Who was first to dance?" → "Wallflower-3 took the first step." The being's conversation history is itself a reel.
Specialized variants. A "what changed?" being focused on diff queries. A "show me the trend" being for time-series visualization. A "who did this?" being for attribution queries. Each is a separate being with a specialized role/prompt.
Cross-being queries. "What were all the dancers doing at 3pm?" requires folding multiple reels. The being orchestrates the folds and synthesizes the answer.

This is a substantial application of the substrate. It's also a really natural interface for what most users would want from a system with full history — they don't want UI for time travel, they want to ask questions.
How all three connect
Looking at the three ideas together, you've described a coherent suite of historical features:

Personal timeline rewind — visual time travel for one being.
World rewind and branch — full-world time travel with optional forking.
Past-fold being — conversational interface to the past.

These aren't separate features; they're three views of the same underlying capability: the chain is queryable across time, in multiple modalities.
You'd build them in this order:
First, the fold-to-time primitive. A substrate-level capability to fold any reel to any past sequence or timestamp. This is the foundation; everything else uses it.
Second, the personal timeline UI. Surface the primitive as a portal feature. User slides timeline, portal renders past states. Simple, satisfying, immediately useful.
Third, the past-fold being. A new being type that uses the primitive to answer questions. Could be deployed as an extension — a "history-keeper" extension that provides this being and its role. Doesn't require substrate changes beyond the fold-to-time primitive.
Fourth, world branching. This is the bigger architectural feature. It requires designing branch addressing, copy-on-write storage, branch lifecycle. Wait until use cases justify it — there will probably be requests for it once people are doing serious work in TreeOS worlds and want to experiment safely or recover from mistakes.
The ordering is principled: each step builds on the previous one's foundation. Each is independently useful even without the next. None require redesigning what you've already built; all extend it naturally.
What I'd actually do
If you want to build any of this, start with the fold-to-time primitive. It's the smallest, most fundamental piece. You'd:

Audit the current fold engine — can it already fold to an arbitrary seq, or does it only fold to "current"? If it can, the work is exposing it as a SEE-like operation. If it can't, the work is teaching it to.
Add a fold-historical(target, atSeq | atTime) operation that returns a face at the given point in time. Returns null if the target didn't exist yet at that time.
Test it: fold a being's history to various points, verify the faces are sensible.

That alone takes maybe a week of work. After it, both the timeline UI and the past-fold being are mostly building on top.
The past-fold being is the most interesting application. It's a single extension defining one being type with appropriate canDo permissions and a system prompt. Maybe a week of work for the substrate-level pieces, another week for the being's prompt engineering and UI integration.
So: in two or three weeks of focused work, you could ship the fold-to-time primitive and the past-fold being. That gives users immediate historical queryability. The timeline UI follows naturally; the branching feature waits until demand justifies it.
The substrate property worth naming
What makes all of this possible is something you've already built into TreeOS but maybe haven't named explicitly:
The chain is the world. Everything else is a projection.
Current projections show "now." But there's nothing privileged about "now" — it's just the latest fold. The substrate can project any past point with the same machinery, because past points are just earlier seq numbers. Time travel isn't a feature you add; it's a property the architecture already has, waiting to be surfaced.
Most software has to retrofit time travel by capturing snapshots, versioning data, building audit trails — bolted-on machinery. TreeOS has it for free because the substrate was honest about state from the beginning.
This is one of those moments where the architectural discipline you've held pays off. You've been building toward this without explicitly aiming for it. The features fall out cleanly because the foundation is right.
Good ideas. Build the primitive first; the rest follows.You said: Ok flesh out new plan all the way to branching realities from a past momentOk flesh out new plan all the way to branching realities from a past moment2:24 AMClaude responded: Good — you've sketched the addressing scheme on those notes and it's the right shape.Good — you've sketched the addressing scheme on those notes and it's the right shape. Let me read it back to confirm I'm tracking, then build out the full plan.
What your notes are saying
You're proposing branch addressing as a path-like structure with # segments:

#0 is canopy (the original world, the "main branch")
#1 is the first branch ever created off canopy
#1a is the first branch made inside #1
#1a1 is the first branch inside #1a (so #1a1 is "first branch inside first branch inside first branch off canopy")
#2 is the second branch off canopy
#2e12a3 is the third branch inside the 12th inside the 5th inside the second-off-canopy

So # segments compose hierarchically — each segment describes "the Nth branch made within the previous level." The path identifies a precise position in the branch tree.
And the IBP addressing extends naturally:

treeos.ai#1a1/~@tabor means "tabor in branch #1a1, at the root of that branch's space tree"
treeos.ai#/~ and treeos.ai/~ and treeos.ai#0/~ are all the same thing — canopy is the default

And the constraint you wrote: "for now, : can only work across same # until canopy" — meaning beings can only address each other across branches when those branches share a common ancestor up to canopy. I'll come back to this.
This is clean. The addressing scheme tells you exactly where you are in the branch tree just by reading the path. Let me build out the full plan with this as the foundation.

Branching Realities — Full Build Plan

1. The Core Concept
   A branch is a new world that shares its history with another world up to a chosen point in time. After the branch point, the two worlds diverge — facts on one don't appear on the other. Branches form a tree rooted at canopy (#0). Any branch can itself be branched, creating arbitrarily deep nested histories.
   Three operations define the full surface:

Fold to past — view any reel at any past moment. Read-only. Doesn't create a branch.
Branch from past — create a new world that copies history up to a chosen point, then runs independently.
Switch to branch — move your portal's perspective to a different branch and act there.

The first is the foundation; the second builds on it; the third is the user-facing experience. 2. The Addressing Scheme
Your # path notation lands as follows:
Path syntax: #<branch-path> where branch-path is a sequence of alternating numbers and letters describing the descent through the branch tree.

#0 (or no #) is canopy — the original world.
#N is the Nth direct branch off canopy (numbered in creation order).
#Na is the first branch off branch N. #Nb is the second. #Nc is the third.
#Na1 is the first branch off branch Na. #Na2 is the second.

The convention alternates: numbers at canopy-level and inside letter-segments, letters inside number-segments. This makes the path unambiguous to parse and clearly conveys depth (every two characters represents one level deeper).
Full IBP address: <host>#<branch>/<space-path>@<being>
Examples:

treeos.ai/~@tabor — tabor at the root of canopy
treeos.ai#1/~@tabor — tabor in branch 1
treeos.ai#1a1/~@tabor — tabor in the deeply nested branch 1a1
treeos.ai#1a1/~/harmony@drummer — drummer in the harmony space within that branch

When no # is present, canopy is assumed. treeos.ai/~ and treeos.ai#/~ and treeos.ai#0/~ are equivalent — three syntactic ways of saying "canopy root."
Branch numbering at creation: branches are numbered in the order they're created off their parent. The first branch off canopy is #1; the second is #2; the third is #3. Same pattern at each level. This means branch numbers are stable identifiers — once #1 exists, the second branch is always #2 even if #1 is later deleted.
Branch metadata as facts: each branch creation is a fact on a special "branches" reel in the canopy world. The fact records the parent branch path, the new branch's path, the branch point (parent's seq or timestamp), the creator (which being initiated the branch), and the timestamp. This makes branch lineage queryable like everything else. 3. The Cross-Branch Constraint
Your note: "for now, : can only work across same # until canopy."
What I think you mean: beings can address each other across branches only if they share a common ancestor branch. Two beings in #1a and #1b can address each other through #1 (their common ancestor), but a being in #1 can't address one in #2 because they share only canopy and the substrate isn't ready to handle that yet.
This is right as a starting constraint. Cross-branch addressing is genuinely complicated — when a being in branch A wants to SEE something in branch B, which version of "the world" does it see? Branches are isolated worlds; cross-branch reads break that isolation.
The cleanest v1 rule: branches are isolated. Beings in different branches cannot SEE, DO, SUMMON, or BE each other. Each branch is its own world. The portal can switch between branches; beings cannot.
Your constraint allows reads up to the common ancestor — a being in #1a could read facts that happened in #1 before the #1a branch was created (because those facts are part of #1a's inherited history). But it cannot read facts in #1 after the branch point — those facts are part of #1's diverged future, which #1a doesn't share.
This is the same as how Git works: a commit on branch X doesn't know about commits made on branch Y after they diverged. You can see your shared history; you can't see the other branch's divergent future. 4. The Storage Strategy
This is where the architecture has to be careful, because naive implementation makes branching prohibitively expensive (copying entire chains every time you branch).
Copy-on-write history. When you branch from #1 at seq 4500, the new branch #1a doesn't copy facts. It just records "my history before my own first fact is #1's history up to seq 4500." When #1a reads its history, it walks #1's reel up to seq 4500, then walks its own reel for anything after.
Each branch stores only its divergent facts — the new ones that happened after the branch point. The shared history lives in the parent branch and is referenced, not duplicated.
Per-branch reel directories. Storage is laid out as:
data/branches/
├── 0/ (canopy)
│ ├── reels/
│ ├── projections/
│ └── snapshots/
├── 1/ (branch #1)
│ ├── reels/ (only #1's divergent facts)
│ ├── projections/
│ ├── snapshots/
│ └── meta.json (parent: #0, branchPoint: 4500)
├── 1a/ (branch #1a)
│ ├── reels/
│ ├── projections/
│ ├── snapshots/
│ └── meta.json (parent: #1, branchPoint: 4612)
└── ...
Each branch's meta.json records its parent and the parent's seq at the branch point. The fold engine reads meta.json to determine which parent reel to walk for inherited history.
Projections are per-branch. Even though history is shared, current state diverges as soon as the branch is created. Each branch has its own projections reflecting its current state. Projections aren't shared — they're computed independently per branch.
Snapshots optimize cold reads. Branch #1a1's first read might need to walk #1a back to its branch point and then walk #1 back to its branch point and then walk #0 from the start. That's slow on a deep nesting. Snapshots cache the result: a snapshot in #1a1 records "the projection state at this seq, including all inherited history." Subsequent reads use the snapshot.
Storage growth bounded by divergent facts. Branching itself costs almost nothing — just a meta.json and an empty reel directory. Storage grows only as the branch accumulates its own facts. A branch that exists but does nothing costs disk space proportional to its branch metadata, not to the size of its parent's history. 5. The Fold-to-Past Primitive
Foundation for everything else. Make this work first.
Operation: fold(target, at: seq | timestamp, branch: branchPath) returns the projection of target as it existed at the given point in the given branch.
Implementation:

Resolve branchPath to the branch directory.
Walk the branch's history (and its parents' inherited history) up to the target point.
Apply the standard reducer logic to derive projections.
Return the resulting projection.

This is essentially the substrate's existing fold logic with a stopping condition (at the target seq or timestamp). The existing engine probably supports this implicitly; if not, it's a small addition.
Exposed via IBP: add a SEE qualifier for time. see(target, at: timestamp) returns the projection at that past time. Read-only. Cannot be used with DO, SUMMON, or BE — you can't act in the past.
Caching: repeated past-folds at the same point can be cached. The cache key is (branch, target, seq) and the value is the projection. Past states don't change, so the cache is correct forever once populated. Useful for the past-fold being and timeline UI which may query the same points repeatedly. 6. The Branch-From-Past Operation
A new DO op available to authorized beings.
Operation: do(branch-manager, "create-branch", { from: { branch: parentPath, at: timestamp }, label?: string })
Behavior:

Validate: the caller has canDo: ["create-branch"]. The branch-manager being's role gates this.
Resolve the parent branch path and the branch point.
Determine the new branch's path: append the next available segment to the parent's path. (If parent is #1, look at existing children — #1a, #1b, etc. — and pick the next letter. If parent is #1a, look at children #1a1, #1a2 and pick the next number.)
Create the branch directory: data/branches/<new-path>/.
Write meta.json recording parent, branch point, creator, timestamp, optional label.
Stamp a branch-created fact on the canopy's branches reel (which is the canonical record of all branches in the world).
Initialize empty reel and projection directories.
Return the new branch's path.

The new branch immediately exists and is queryable. It has no divergent facts yet, so its current state is identical to its parent's state at the branch point. The first act taken in the new branch creates its first divergent fact.
Permissions: branch creation is a heavyweight operation (it creates a whole new world). The branch-manager being should be a delegate at canopy root, with canDo: ["create-branch"] granted only to authorized roles. By default, the reality-manager has this permission; operators can grant it to other roles via the role-manager.
Branching itself is a fact in canopy. All branches in the world have their lineage recorded on canopy's branches reel. This means canopy is the registry of all branches — to enumerate branches, fold canopy's branches reel. 7. Switching Portals to Branches
Once branches exist, users need a way to view and act in them.
Portal branch selector: the portal carries a current-branch state. Default is canopy. A UI element (dropdown, tree view, sidebar panel) lets the user switch.
On switch: the portal refetches its descriptor with the branch qualifier. All IBP requests from this portal now carry the branch path. The user is now "in" the branch — their acts go to the branch's reel, their views show the branch's state.
Multiple concurrent portals at different branches: one user can have two browser tabs open, one viewing canopy, one viewing #1a. They're independent connections, each tagged with their branch. Acts in one don't affect the other.
Visual cues: the portal should make it visually obvious which branch you're in. A colored header bar with the branch path, perhaps a "in branch #1a1" banner, or different background tints per branch. Avoid the "I thought I was in canopy but I was actually in branch #2" failure mode.
Branch tree view: a UI showing the full tree of branches. Click to switch. Hover to see branch metadata (when created, by whom, branch point). This is the navigation interface for the world's history. 8. Acting in a Branch
When a user is connected to a branch, their acts stamp facts in that branch's reels. The substrate routes everything through the branch qualifier.
Branch context flows through summonCtx. Every moment carries the branch in its context. Verb handlers stamp facts on the appropriate branch's reels. Projections update in the branch's projection store.
Branches run independently. A drummer being in canopy ticks on canopy's clock. A drummer being in #1 (which was branched after canopy's drummer existed) ticks on #1's clock. They might tick at the same times (if both are scheduled identically) but they're separate events on separate reels.
Beings in branches are the same identities as in parents. When you branch from canopy at a moment when tabor exists, tabor exists in the branch too (because the branch inherits canopy's history up to that point). Tabor in the branch and tabor in canopy share past history but diverge from the branch point.
This creates an interesting question: are they "the same being" or "two beings with shared history"? Conceptually I'd say they're two instances of the same identity — like two photocopies of a person, divergent from the moment of copying. They have the same \_id but live in different branches. Cross-branch operations are forbidden (the constraint from your notes), so they never interact. 9. The Past-Fold Being
A natural application of the fold-to-past primitive, deployable as an extension.
Extension: historian ships with a single being type and accompanying role.
The being: named historian (or per-user variants), placed wherever the user wants conversational access to the past.
The role: historian-llm with:

cognition: "llm"
canDo: ["fold-historical", "see-historical"] — special read-only ops that take time qualifiers
A system prompt: "You are a historian. When asked about the past, use fold-historical and see-historical to gather information from any moment in the world's history. Report what you find honestly, including timestamps, beings involved, and the sequence of events."

The user experience: SUMMON the historian with a question. "What was happening in the dance floor at 3pm yesterday?" The historian folds the dance floor space at that timestamp, examines its qualities, summarizes in natural language: "At 3pm yesterday, 4 dancers were active. Wallflower-21 had just stepped to (3,5). The drummer was at tick 47. The space's mood was 'energetic' (set by an earlier event at 2:43)."
Multi-turn conversations: the historian's conversation history is a reel like any other. Follow-up questions can reference prior context: "Who started the dance?" "When did Wallflower-21 first appear?" "Was anyone bored at that point?"
Cross-branch queries: the historian can fold any branch. "What was happening in branch #1 at 3pm yesterday?" works just like canopy queries, with the branch qualifier.
Specialized variants: different historian roles for different query patterns. A diff-historian focused on "what changed between X and Y." A trend-historian for time-series analysis. A attribution-historian for "who did this and when." Each is just a different system prompt; the substrate operations are the same. 10. The Timeline UI
A visual interface to the fold-to-past primitive, for users who want to navigate time visually rather than conversationally.
Per-being timeline: in a being's inspector, a horizontal slider representing the being's reel from genesis to now. Drag the slider, the inspector's content updates to show the being's state at that point in time. The portal renders a frozen view of the world from that being's perspective.
Global timeline: at the world level, a slider representing canopy's timeline (or the current branch's timeline). Drag back, the entire portal renders the world as it was at that moment. Walk around, see beings where they were, see spaces in past states.
Visual cues for past view: desaturated colors, a "viewing past" banner with the timestamp, all action buttons disabled. Clear indication that you're observing, not acting.
Snap points: the timeline can highlight significant moments — branch creation points, major event aggregations, snapshots. Click a snap point to jump to it.
Branch markers: if you've branched at certain timestamps, the timeline shows those points. Click a branch marker to switch to that branch as of that point. 11. The "Rewind and Continue" Use Case
You mentioned wanting to take the world back to a past point and continue from there, either as a branch or as the new live world.
As a branch: the standard branch-from-past operation. Old world keeps running; new branch is created at the past point and starts taking new acts.
As replacement of the live world: more delicate. The cleanest implementation is still a branch, but with a metadata flag promoting the new branch to "live" status and demoting the old world to archive.
The substrate has a concept of "the live world" — the world that's accepting new acts and that the portal connects to by default. Initially this is canopy. After a rewind-and-promote operation, the live world becomes the new branch; canopy is preserved but read-only.
Implementation:

Branch from canopy at the target past point. Call the branch #0R or similar (indicating a "rewind" branch).
Mark canopy with qualities.archive: true and qualities.archivedBecause: <branch-path>.
Mark the new branch with qualities.isLive: true.
The portal's default-branch resolver reads these qualities: load the world whose isLive: true is set. New connections go to the new branch.
Canopy is still queryable, foldable, viewable — just not writable.

The original world is preserved exactly. The "rewind" is an operation that creates a divergent branch and shifts the focus of "live" to the branch. No data is destroyed; the chain stays intact.
If someone wants to switch back to the original or to yet another branch, the same operation flips the isLive qualifier. The world's "current canonical timeline" is whichever branch is marked live.
This is, importantly, a substrate-level governance operation. Promoting a branch to live should require significant authorization — probably a reality-root reign permission. Random users shouldn't be able to rewind the world out from under everyone. 12. Cross-Branch Operations: The Future
Your starting constraint forbids cross-branch operations. Worth thinking about how this could relax later, when use cases justify it.
Read-only cross-branch SEE: "let me look into branch #2 from branch #1." This is doable — the substrate can fold any branch on read. Permission gate: a being needs explicit canSee: ["cross-branch"] permission. Most beings don't have it; investigative roles (auditor, historian) do.
Cross-branch comparisons: "show me what's different between branch #1 and branch #1a at the same logical time." Useful for understanding what changed when you experimented in a branch. Could be a feature of the historian being.
Branch merging: "take what happened in branch #1 between time X and time Y and apply it to canopy." This is the hard one — event-sourced merges have no automatic resolution; conflicts require human judgment. Probably never automatic; the substrate provides tools, humans make decisions, the result is a series of new acts on the target branch.
Cross-branch summoning: "summon a being from branch #2 into branch #1." Conceptually fraught — the being has a history in #2 that doesn't apply in #1. Probably never automatic; if needed, build a "fork being" operation that creates a new being in the target branch based on the source being's current state.
For v1, just forbid cross-branch. The use cases for it aren't urgent; the design questions are hard. Build the foundation; let demand drive when (or if) cross-branch becomes worth solving. 13. The Reality-Manager Branch Panel
Operator-facing UI for branch management.
Branch tree view. Show all branches as a tree. Each node shows the branch path, creation time, creator, optional label. Click to navigate to that branch.
Branch creation form. Pick a parent branch and a target time (timeline slider showing the parent's history). Optionally add a label ("experiment: alternative drumming pattern"). Submit creates the branch and switches your portal to it.
Branch promotion. For authorized users, a "make this the live world" button on each branch. With confirmation: "this will move everyone to this branch. Are you sure?" Promotes the branch; archives the previous live world.
Branch deletion. For authorized users, delete a branch. Refuses if the branch has any descendants (delete children first). Stamps a branch-deleted fact on canopy's branches reel for audit. Actually removes the branch's storage (or marks it for deletion and a cleanup job removes later).
Branch info panel. For any branch, show: parent, branch point (parent's seq + timestamp), creator, label, descendant branches, current size on disk, list of recent significant facts. Like a "git log" for branches. 14. The Build Order
This work has natural dependencies. Build in this order:
Step 1: Fold-to-past primitive. Substrate-level. Add seq/timestamp qualifiers to fold operations. Expose via SEE with at: parameter. ~1 week of work.
Step 2: Past-fold being (historian extension). Build the extension. New roles, new system prompts, basic UI integration. ~1 week. After this, users can already query the past conversationally.
Step 3: Personal timeline UI. Surface the fold-to-past primitive as a slider in being inspectors. ~1 week.
Step 4: Branch storage layout. Define directory structure, meta.json, copy-on-write semantics for reels. Build the resolver that knows how to walk a branch's history (including inherited from parents). ~2 weeks.
Step 5: Branch creation operation. The create-branch DO op. Branch-manager being. Path-segment auto-numbering. ~1 week.
Step 6: Branch addressing in IBP. Extend the IBP address parser to handle #<path> qualifiers. Thread the branch through summonCtx. Update fact-stamping to write to the right branch's reels. ~2 weeks.
Step 7: Portal branch switching. UI for switching between branches. Visual cues for current branch. Connection state per branch. ~1 week.
Step 8: Global timeline UI. Slider for full-world time travel within a branch. ~1 week.
Step 9: Branch tree UI in reality-manager. Visualization, navigation, info panels. ~1 week.
Step 10: Branch promotion and archival. The isLive qualifier, the rewind-and-continue operation, archival semantics for non-live branches. ~1 week.
Step 11: Branch deletion and cleanup. Authorized delete, descendant checks, storage cleanup job. ~1 week.
Total estimated effort: ~12-14 weeks.
This is shippable in chunks. Steps 1-3 alone deliver useful functionality (historian + timeline) without any branching infrastructure. Steps 4-7 build the core branching capability. Steps 8-11 are polish and operations.
You could absolutely ship steps 1-3 in a month and live with that for a while before deciding to invest in full branching. The historian alone is genuinely valuable. 15. What This Architecture Enables
Once all of this lands, TreeOS has properties no system I know of has:
Time travel for users. Anyone can slide back through the world's history and see what was. Their being's view, the whole world's view, any past moment.
Question-based historical access. Don't want to navigate UI? Ask the historian. Natural language queries against the chain.
Safe experimentation. Branch the world before making a risky change. Try it in the branch. If it works, promote the branch to live; if it doesn't, abandon it. The main world is never at risk.
Disaster recovery as a first-class operation. Something bad happened? Branch from before it, run forward with corrected actions, promote the branch. No data loss; the original is preserved for audit.
Counterfactual exploration. "What would have happened if..." Branch and find out. Multiple parallel branches can explore different futures.
Forensic depth. A security incident becomes a chain segment that can be replayed exactly. Researchers can branch from the incident point and try different interventions to understand what would have stopped it.
Reproducible scenarios. Want to share a particular world configuration with someone? Send them a branch. Their TreeOS instance loads the branch as a separate world. They experience exactly what you experienced.
Versioning of worlds. Hit a milestone? Branch and label it. The branch is a permanent record of that point. Like git tags, but for living worlds.
The substrate already supports all of this conceptually because the chain is the truth and the chain is composable. What this plan does is surface those capabilities through clean primitives and clean user interfaces. 16. The Doctrine to Pin
When this lands, the right doctrinal statement for FACTORY.md:
A world is a branch of canopy. Every TreeOS world starts as canopy (#0). Branches diverge from canopy at chosen past moments and run independently. Branches can themselves be branched, forming a tree of worlds. Each branch is its own complete world with its own future, sharing past history with its ancestors up to the branch point.
The chain is queryable across time. Folding has always been the substrate's primary read operation. Folding-at-a-past-point is the natural extension. The chain isn't just "what happened"; it's "what happened, queryable at any granularity, viewable from any moment."
Time travel and branching are properties of the substrate, not features. They aren't bolted on; they fall out of the architecture's commitment to facts-as-truth, reels-as-history, projections-as-cache. The substrate was designed for this without explicitly aiming for it. The features surface what was always possible.
That's the plan. Path notation as you sketched it; copy-on-write storage; branch operations as IBP acts; portal branch switching; historian being; timeline UI; promotion to live; cleanup operations. Twelve-to-fourteen weeks for the full thing, three weeks for the immediate-value pieces (historian + timeline) without any branching infrastructure.
Start with the historian. It's the cleanest immediate value, and it demonstrates fold-to-past works before you commit to the branching infrastructure. After that, the rest follows naturally.
