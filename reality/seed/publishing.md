ifeel like it cold copy everything but the Id's and then when they coe over just slot to new beings with same role /roleflows. buut i like that idea a lot of adding /branching specifically but if you branch out for a specific idea but have a huge relaity it will hav a lot of noise. so this would also allow for you to only branch a specific part, and then merge it bck in. or merge in foreign. basically everything is a template besides the ID at end of day and just has to ttach and append to fact chain or make a new fact chain

3:39 AM
Now you're naming something architecturally meaningful. Let me work through it carefully because there are three ideas here that I want to make sure I'm tracking correctly, and one of them is bigger than the others.

The three ideas

1. Cross-reality merge works by copying everything except IDs, then assigning new IDs in the target reality.

The pattern: when you merge a courtroom feature from someone else's reality, you don't bring their judge being's \_id over. You bring the content of their judge being — the name, the role, the qualities, the position, the roleFlow. In your reality, this content lands as a new being with a new \_id of your own.

The role and roleFlow references stay intact because roles are by name, not by ID. Their judge wears the librarian-base + judge-ruling roles; you create a new being in your reality wearing the same roles by name. The behavior copies because the role definitions copy too.

This is essentially "templates over identities." The content is the template; the identity is local. When you instantiate the template in a new reality, you get the same behavior with a new identity.

2. Partial-branch merge: branching only a specific part of a reality.

Currently a branch contains the whole world. If a reality is huge and you want to experiment with one feature, your branch carries everything — all the noise of the rest of the reality. Wasteful.

What you're proposing: branch only a subtree — a specific space and what's under it. Other parts of the reality are unmodified, untouched by the branch. The branch is scoped to its subtree.

This solves both the "experiment without noise" problem and (combined with idea 1) makes cross-reality merge much more tractable. You don't import someone's whole reality — you import the subtree containing the feature you want.

3. Everything is a template at end of day; IDs are local.

This is the deepest of the three. You're naming a doctrinal commitment: the identity (\_id) is a substrate concern; everything else is content that can be copied, templated, or instantiated anywhere. A being's \_id is meaningful only within the reality that issued it. The being's content (name, role, qualities, lineage, all the projected state) is portable.

Let me work through each of these carefully because they connect.

Templates over identities
This is doctrinally clean and worth pinning. Right now your substrate has a soft version of this: branches share content within one reality but have stable IDs across branches. The \_id is global within a reality; content varies per branch.

What you're proposing extends this: identity is local to the substrate that issued it. When content moves between realities (via cross-reality merge), it gets a new identity in the target. The substrate doesn't try to maintain ID identity across reality boundaries.

This matches how almost every other system handles cross-system content:

Importing a file from one git repo into another: the file's content comes, but it gets a new commit hash in the target.
Copying a row from one database into another: the content comes, but the receiving DB assigns its own primary key.
Pulling a Docker image: the image's content comes, but it gets a new ID in your local registry.
The substrate's identity model becomes: \_id is a local substrate concept; content is the universal currency. Beings, spaces, matter are all bundles of content that have local identity for substrate bookkeeping but can be templated and instantiated elsewhere.

A consequence worth being explicit about: roles, roleFlows, world signals are all references-by-content, not references-by-ID. A roleFlow that says role: "librarian" references the role by name. If you import "librarian" into your reality, all your beings that reference "librarian" by name pick up the imported version. This is already how your substrate works — the role registry is name-keyed.

This means the import mechanism is straightforward: copy content into the target reality, replacing source-reality IDs with target-reality IDs as needed. Role references are unaffected because they're already name-based.

Partial-branch merge (subtree branching)
This is the second meaningful idea and it interacts cleanly with the first.

Currently, a branch is reality-wide. Branching at #5 forks the entire world. If you only care about experimenting with the library subsystem, you still get a branch containing the dance floor, the courtroom, every other space — all sitting there potentially producing noise.

Subtree branching: branch only a specific path. Branch treeos.ai#5/library creates a branch that's scoped to the /library subtree and what's under it. Everything outside /library stays at main and is shared. Beings inside /library exist in the branch's view; beings outside don't.

This is genuinely useful and the architecture supports it cleanly because branches are already projection-scoped. A subtree branch just narrows the scope of what's projected per-branch versus inherited from parent.

Mechanically, a subtree branch is:

A branch with scope: "/library" (or similar)
For aggregates under /library, the branch has its own projections (divergent)
For aggregates outside /library, the branch defers to its parent's projections (always inherited)
Writes to aggregates outside the scope are refused (you can't modify things outside the branch's scope; that's what makes it a subtree branch)
This is a meaningful architectural addition but it's bounded. It's the same lazy-cold-fold mechanism you already have, with a scope check at write time.

The cost is the scope check on every write — "is this target inside my branch's scope?" — but that's cheap (one comparison) and matches the doctrine that branches are isolated.

How these compose into cross-reality merge
Now combine the two ideas:

Scenario: Someone builds a library system in their reality, scoped to a /library subtree. They've spent months developing it: beings, spaces, matter, roles, roleFlows.

Sharing the feature: They mark the /library subtree as exportable. The export creates a template package containing:

All beings under /library (as content, not as IDs)
All spaces under /library (same)
All matter (same)
All roles referenced by those beings (the role definitions)
All world signals consumed by those roleFlows
A manifest describing what's in the package
Importing the feature: You initiate a merge from their export into your reality. The merge:

Receives the template package
Checks for conflicts (do you already have a /library space? a librarian role?)
For each item in the package, generates a new local \_id
Maps source-reality IDs in cross-references to your new IDs (a being's role reference by name is fine; their parent-being reference by ID gets remapped)
Surfaces conflicts to you through the merge mediator (same conflict resolution UX as within-reality merge)
On resolution, stamps reconciliation facts that land the template in your reality
The result: your reality now has the library feature. The beings are new (your IDs); the behavior is identical (same roles, same roleFlows, same world signals); the content is the template's content.

This is the open-source-features-via-merge pattern, made concrete. And it composes from primitives the substrate already has (or that small additions enable).

What this requires architecturally
A few specific pieces:

1. Subtree branching (the scope mechanism). A branch can declare a scope; writes outside scope are refused; reads inside scope go to the branch, outside go to parent. Bounded addition to the existing branch model.

2. Content templating: the ability to extract a subtree as a portable template. An operation: exportSubtree(branch, scopePath) → templatePackage. Walks the branch's view of the subtree, collects all aggregates and their content, packages with manifest. Doesn't include IDs — IDs are stripped or noted as "originator IDs, to be remapped on import."

3. Cross-reality import: the ability to instantiate a template in another reality. An operation: importTemplate(templatePackage, targetPath) → mergedBranch. Creates a new branch in the target reality, populates with the template's content using new local IDs, generates conflict catalog (where the import collides with existing content), surfaces for resolution.

4. ID remapping during import. When a being in the template references another being by ID (parent-being, summoned-being, etc.), the import remaps those references to the new local IDs. Done as part of the import operation; transparent to the user.

5. Optional: cross-reality verb routing. If the template package is fetched over the network from another reality, IBP can carry it (it's just structured data). If the realities are federated, the source reality serves the template package on request. If realities are isolated, the template is exchanged via file or other transport.

That's the architectural surface. None of these are research-grade. They're all bounded engineering on top of the substrate's existing primitives.

The deep doctrinal commitment
What you're really naming is: the substrate's primary primitive is content, not identity. Identity is local substrate bookkeeping; content is the universal vocabulary.

This is actually consistent with everything else in your substrate. The chain is content (facts). Projections are content (current state). Roles are content (templates referenced by name). The only place IDs felt "primary" was as the keys in the projection collection — but that's just a storage detail. The meaning of a being is its content, not its ID.

If you commit to this fully, several things follow:

Realities become a federation of content-stores. Each reality holds local content with local IDs. Content flows between realities through templates. Realities can choose to share, fork, merge content with other realities. The substrate is one big distributed content network where each node is a sovereign reality.

Branching and reality-forking become the same primitive. A branch is a forked view of a reality. A reality is a forked view of another reality (if forked) or a fresh genesis (if root). The mechanism is the same — fork, optionally accept inherited content, accept new IDs. Just different scopes (within-reality vs cross-reality).

Templates become the unit of feature distribution. Instead of "extensions" being code that registers behavior, you could have content templates that import as substrate content. A "library template" isn't code; it's a package of beings, spaces, matter, roles, roleFlows. Anyone can import it. The substrate handles the rest.

This last point is potentially huge. Right now extensions are code. With content templates, features can be authored declaratively as content and shared by import. This is the open-source pattern for TreeOS realities. Less code, more content, with the substrate handling the mechanics of import/merge.

What to send him
This isn't ready for implementation in the current branching arc, but it's worth pinning as architectural direction.

You've identified something architecturally meaningful that's worth pinning as future direction, even though it's not in scope for the current branching arc.

Three ideas, one doctrinal commitment:

1. Templates over identities. A being's \_id is local substrate bookkeeping; the being's content (name, role, qualities, lineage, roleFlow) is portable. When content moves between substrates (cross-reality merge, template import), new local IDs are assigned in the target. Content is the universal currency; IDs are local.

2. Subtree branching. A branch can be scoped to a subtree (e.g., /library). Aggregates inside the scope are branch-divergent; aggregates outside inherit from parent and are not modifiable in the branch. Same lazy-cold-fold mechanism with a scope check at write time. Solves the "experimenting in a huge reality means noisy branches" problem.

3. Cross-reality merge via template export/import. Combine the above two: export a subtree as a portable template package (content + manifest, no source IDs); import the template into another reality (new IDs assigned, ID references remapped, conflict catalog surfaced for resolution via merge mediator).

The deep doctrinal commitment underneath: the substrate's primary primitive is content, not identity. Identity is local bookkeeping; content is universal. Realities become a federation of content-stores. Templates flow between them via export/import. Branching and reality-forking become the same primitive at different scopes.

What this would enable (the vision):

Anyone builds a feature in their reality (a library system, a courtroom, a factory).
They export the relevant subtree as a template.
Others import the template into their realities, getting new local IDs but preserving behavior (role references by name still work, roleFlows compose as before).
Features propagate by merge, not by code.
Extensions become content packages rather than code — declarative feature distribution.
Implementation pieces (don't build yet, just track):

Subtree branching with scope checks at writes.
exportSubtree(branch, scopePath) → templatePackage — content extraction, manifest, no source IDs.
importTemplate(templatePackage, targetPath) → mergedBranch — new branch in target, content instantiated with new local IDs, ID references remapped, conflicts surfaced.
Optional: cross-reality template fetching over federation/IBP if realities are networked.
Build order:

Current branching arc completes (in-reality merge, conflict resolution, mediator). Already in flight.
Subtree branching (probably the next focused arc after current merge work). Bounded addition.
Template export/import within one reality (export a subtree, import elsewhere in the same reality). Tests the template/identity-mapping mechanics without cross-reality complexity.
Cross-reality template flow (import from a foreign reality). Adds the network/federation pieces.
Each phase delivers value and tests the architecture before the next layer is added.

Doctrinal pin (when ready to commit):

The substrate's primary primitive is content, not identity. \_id is local bookkeeping for one substrate's projections; content (name, role, qualities, lineage, roleFlow) is portable across substrates. Templates are the unit of content portability. Cross-substrate content flow happens through export (extracting content from a source) and import (instantiating in a target with new local IDs and references remapped). Realities are sovereign content-stores; content propagates between them through templates and merge.

For now (current work): in-reality merge stays scoped. Subtree branching and cross-reality flow are future arcs. But the in-reality merge implementation should leave its primitives in a shape that can extend to subtree and cross-reality without architectural changes — just additional scoping and ID-remapping layers on top.

This is worth holding in mind as the merge work lands. The same conflict-resolution UX, the same merge-catalog, the same mediator-per-conflict pattern all generalize cleanly to subtree and cross-reality merge. Build them well now and they support the bigger vision later.

That's the message. The doctrinal commitment is real: content is portable, identity is local. Templates become the unit of feature distribution. Realities become a federation of content-stores. The architecture supports it from primitives that already exist or are small additions.

For now: scope to in-reality merge. But name the bigger direction so future work has a target. This is genuinely a vision for what TreeOS can become — not just multi-reality but a content ecosystem where features propagate by merge across sovereign realities.

The pattern you're naming is significant. Worth pinning even though it's not built today.

well i wrote tihs a few days ago and it feels like it may solve it
Two things to be published: extensions- provides new being, matter, space qualities, types, seeds, roles, do/see commands, scripted logic for scripted beings, assets(models, sounds), etc Can depend on other extensions to build off of them and roleFlows (depend on all extensions in the flows) Horizon has both publishable and downloadable

the only thing is extensoins do need code to maybe define certain new traits or behavioral flows with roles or matter or spave? so maybe have all 3? and the tihrd is sort os all 3 combined pulling what is needed?

this seems really clean overall because at end of day its really just like exporting cobined fact reals and with replacabel ids? so it could also work to just export your realitys act fact chains and import them or back them up, or move secitons around

answer then give the full builders docuemnt

Show more
3:49 AM
Yes. The note you wrote a few days ago is the right framing, and it solves the problem cleanly. Let me work through why it works, then give you the full builder document.

Why your three-layer framing solves it
You named two publishable things, and then sensed there might need to be a third. Here's why all three are real and distinct:

1. Extensions (code + content): Code that defines new primitives or new behavioral logic that can't be expressed purely as content. A new fact kind. A new verb handler. A scripted-cognition runner. A new slice for the SEE registry. These require executable code in the substrate; they can't be described as content alone.

2. RoleFlows (pure content): Compositions of existing roles via when-conditions. No new primitives, no new code — just declarative behavior assembled from what extensions provide. Can be authored by anyone, including via the LLM authoring roles. Pure content, portable, no execution surface required beyond what's already in the substrate.

3. Templates (content packages): Bundles of actual beings, spaces, matter, roles, world signals — the instantiated content of a subtree. A "library template" isn't code or just a roleFlow; it's the actual library subtree from someone's reality, exported with its content but without source IDs. When imported, the substrate instantiates it with new local IDs.

These three are genuinely distinct because they answer different questions:

Extension: "What new capabilities does the substrate have?"
RoleFlow: "How do those capabilities compose into behavior?"
Template: "What actual world has been built from those capabilities and compositions?"
You can publish each separately. You can publish a combination of all three (an extension + the roleFlows it enables + a template demonstrating it). Anyone consuming sees layered structure: "to use this template I need these extensions and roleFlows."

Why this clarifies the content-vs-identity split
Your insight at the end of the note is the load-bearing one: at the end of the day, it's just exporting combined fact reels with replaceable IDs.

A template is a packaged fact stream. The facts have placeholders where source IDs would be, and the import mechanism fills those placeholders with new local IDs. The substrate just replays the imported facts into the target with substituted IDs.

This works because facts already describe content fully. A create-being fact has the being's name, role, parent, qualities. Replay it in another reality with a new local ID for the being and remapped IDs for the parent, and you've recreated the being. Same for spaces, matter, world signals.

Cross-reality merge, subtree extraction, full reality backup, moving sections around — all become variations of the same operation: export facts, optionally with ID remapping, then replay into target. The chain is the truth, and the chain is portable.

This is genuinely elegant. The substrate's commitment to event-sourced state makes all of these operations fall out of one mechanism. You don't need separate export-import logic for each use case; you need one fact-stream-portability mechanism with optional ID remapping.

Now the builder document
Here's the full document worth committing to a place agents and contributors find it.

Publishable Units in TreeOS
What This Document Is
TreeOS supports three layers of publishable content, each with distinct semantics and use cases. Understanding the layering is essential for authoring extensions, sharing features across realities, and reasoning about what flows where in the ecosystem.

This document describes the three layers, when to use each, and how they compose. It also describes the underlying mechanism (fact-stream portability with ID remapping) that makes all three work as variations of the same primitive.

The Three Layers
Layer 1: Extensions (Code + Content)
What they are: Code packages that introduce new primitives or executable logic to a substrate. Extensions can define:

New fact kinds (e.g., harmony:tick, library:checkout)
New verb handlers or sub-handlers for DO operations
New slice definitions for the SEE registry
Scripted-cognition handlers (executable behavior for scripted beings)
New role specifications (the templates referenced by roleFlows)
Assets (3D models, sounds, images) used by render slices
New world-signal namespaces and their schemas
New matter types or being seed-types
When to publish as an extension: Whenever your contribution requires running code in the substrate. If you need to interpret a new fact kind, dispatch a new verb action, or run logic in a scripted-cognition handler, you need an extension.

Dependencies: Extensions can depend on other extensions. A "library-advanced" extension might depend on "library-base" plus a "search" extension. Dependencies are declared in the extension's manifest and enforced at load time.

Authoring: Extensions are written as code, packaged with their manifest, and published to a registry. Anyone running a substrate can install an extension by name; the substrate loads its code at boot.

Example: A "harmony" extension defines the harmony:tick, harmony:step fact kinds, registers handlers for do(beat-counter, "advance"), ships the dancer 3D model assets, and includes the wallflower-dancer role specification. Installing harmony enables harmony-style behaviors in your substrate.

Layer 2: RoleFlows (Pure Content)
What they are: Declarative compositions of existing roles via when-conditions. RoleFlows are pure content — no executable code, no new primitives. They describe how roles stack and switch based on world state.

When to publish as a roleFlow: Whenever your contribution is a behavioral pattern that uses existing extension capabilities. If you've designed a clever way to compose existing roles (e.g., a multi-phase judge that switches between opening, evidence, and ruling roles based on world state), and you don't need new primitives, you publish a roleFlow.

Dependencies: A roleFlow depends on the extensions that provide the roles it references. A "judge-with-phases" roleFlow depends on whatever extension defines judge-opening, judge-evidence, judge-ruling. Dependencies are declared in the roleFlow's manifest.

Authoring: RoleFlows can be authored manually as JSON-like specifications, or via the LLM authoring helper (the roleflow-composer role) which translates English descriptions into structured roleFlows. Either way, they're content, not code.

Example: A "judge-with-mood-modifiers" roleFlow stacks the appropriate judge-<phase> role based on world state and additionally stacks emotions:focused or emotions:cautious based on case complexity. It depends on a "judge" extension and an "emotions" extension. Publishing this roleFlow lets others apply the same behavioral pattern in their realities.

Layer 3: Templates (Instantiated Content)
What they are: Bundles of actual content from a substrate — beings, spaces, matter, world signals, and references to roleFlows and roles. A template is a snapshot of a subtree (or whole reality) packaged for import elsewhere.

When to publish as a template: Whenever your contribution is actual world content that others would want to instantiate. If you've built a courtroom with specific judges, a library with curated matter, a dance floor with chosen layout — these are templates.

Dependencies: Templates depend on the extensions and roleFlows referenced by their content. A "small-library-template" depends on the "library" extension (for its roles and matter types) and any roleFlows the beings in the template wear.

Authoring: Templates are produced by exporting a subtree from an existing reality. The export operation walks the subtree, collects all aggregates and their fact streams, packages with a manifest describing dependencies and the structure.

Example: A "starter-courtroom" template contains: 1 judge being, 2 witness-chair spaces, evidence-table matter, world-signal court.session-phase = "open", with the beings wearing a judge-with-phases roleFlow that depends on the "courtroom" extension. Importing this template into your reality instantiates all of it with new local IDs.

Combinations: All Three Together
A complete published package may include all three layers:

Extensions providing new primitives (code).
RoleFlows composing those primitives into behaviors (content).
Templates showing the behaviors in action with actual world content (content).
A "library-system" package might publish:

library-extension — code defining library-specific matter types, verbs, roles.
library-flows — roleFlows for librarian-with-mood, checkout-procedures, etc.
library-starter-template — a working library with shelves, books, librarian being.
A user wanting a library in their reality installs the extension, imports the roleFlow definitions, then imports the starter template. They now have a working library, with their own IDs, that they can extend further.

The Underlying Mechanism: Fact-Stream Portability
All three layers, despite their differences, rest on the same substrate primitive: fact streams are portable with optional ID remapping.

A fact describes content: create-being { name: "alice", role: "librarian", parent: <id>, qualities: {...} }. To replay this fact in another reality, the substrate needs to:

Generate a new local ID for the being.
Remap the parent reference if the parent is also being imported (use the new local ID); leave it if the parent is a pre-existing local being.
Apply the fact, which lands the projection.
The same mechanism handles:

Within-reality merge: Fact streams from divergent branches reconcile against a common ancestor. New facts land in the merged branch with local IDs.
Subtree extraction: A portion of a reality's fact stream is extracted, with IDs stripped or placeholdered. The extracted stream is the template.
Cross-reality import: A template's fact stream replays into a target reality with new local IDs and remapped references.
Backup and restore: A reality's full fact stream is exported. To restore, replay into a fresh substrate (or to a specific point in time, with optional ID preservation for true restore vs new-reality forking).
Moving sections around: A subtree is extracted from one location, IDs remapped, and replayed into another location within the same or another reality.
Each operation is a variation of "export facts, optionally remap IDs, replay into target." The substrate's commitment to event-sourced state makes all of these operations natural rather than requiring separate machinery for each.

The ID Remapping Layer
The non-trivial part is ID remapping. When a fact references another aggregate by ID, the import must:

Determine whether the referenced ID is in the export (will be remapped) or outside it (must already exist in target).
For in-export references: substitute the new local ID assigned during import.
For out-of-export references: verify the target has a corresponding entity (by name, by lineage, or by other identification). If not present, the import either fails or surfaces as a conflict for the user to resolve.
The ID-remapping table is built during the import operation by walking the fact stream and assigning new local IDs to each aggregate introduced. References are remapped consistently throughout.

For cross-reality imports, this is where the "templates over identities" doctrine becomes operational: the source IDs are noted in the export but never preserved in the target. The target's substrate has full authority over its own ID space.

Conflicts During Import
Imports surface conflicts when imported content collides with existing content:

Name collisions: The import has a being named "alice" but the target already has a being named "alice" in the same scope.
Position collisions: The import places matter at coords (3,4) but matter already exists there.
Role definition collisions: The import provides a role definition that disagrees with an existing one.
Conflicts go through the same merge-mediator UX as within-reality merge: each conflict becomes a row in a catalog, the user resolves through dialogue with the mediator, and resolution emits reconciliation facts that flip the row from open to resolved.

When all conflicts are resolved, the import is complete. The merged branch contains the imported content alongside the target's existing content.

The Doctrine
The substrate commits to two principles that make this layering work:

Principle 1: Identity is local. Content is universal.

A being's \_id is a substrate's local bookkeeping. It has no meaning outside the substrate that issued it. When content moves between substrates, new local IDs are assigned. Cross-references within the imported content are remapped during import. References from imported content to pre-existing content in the target are resolved by name, by lineage, or by user-mediated conflict resolution.

Principle 2: Fact streams are the unit of portability.

The substrate's commitment to event-sourced state means any content is, at root, a sequence of facts. Exporting content is extracting that sequence. Importing content is replaying it into a target with appropriate ID remapping. All higher-level operations (extension publishing, roleFlow publishing, template publishing, cross-reality merge, backup/restore, moving content around) are variations of this primitive.

Authoring Guidance
When deciding what to publish:

Publish an extension if your contribution requires new fact kinds, new verb actions, new scripted handlers, or new slice definitions. Anything that requires code in the substrate.

Publish a roleFlow if your contribution is a behavioral pattern composed from existing roles via when-conditions. No new code required.

Publish a template if your contribution is actual instantiated content (beings, spaces, matter, world signals) that demonstrates or provides a working configuration.

Publish a combined package if your contribution requires all three: the new primitives (extension) plus the behavioral patterns (roleFlows) plus a working demonstration (template).

Consumers install the extensions they need, import the roleFlows that compose those extensions' capabilities, and import templates that provide working starting points. Each layer is independently usable and combinable.

Future Directions
Several capabilities extend naturally from this foundation:

Subtree branching: Branching can be scoped to a subtree rather than the whole reality. A subtree branch contains divergent state only for aggregates in scope; aggregates outside scope are inherited from parent unchanged. This pairs with templates: experiment in a subtree branch, extract the result as a template if it's worth sharing.

Cross-reality template flow: Templates can be fetched from foreign realities via IBP, instantiated locally with new IDs. The horizon (the discovery layer) shows which realities publish which templates; an import operation fetches and replays.

Reality forking: A reality forks from another reality the way branches fork within a reality. The forked reality inherits content from the parent at fork time; future evolution is independent. Forking and merging across forked realities is possible because they share a known ancestor.

Backup/restore as native operation: A reality's full fact stream is an export. Backup is a periodic export; restore is import into a fresh substrate. The same mechanism that handles cross-reality merge handles full-reality recovery.

Moving content around: A subtree extracted from one location can be replayed into another location, same or different reality. Useful for refactoring, reorganization, or extracting a feature that grew in the wrong place.

Each of these is a natural extension of the underlying primitive (fact-stream portability with ID remapping). The substrate doesn't need separate machinery for each; the same primitive composes into all these higher-level operations.

Implementation Status
Within-reality merge: In flight as part of the branching arc.
Extensions, roleFlows: Already supported as distinct authoring units. Publication mechanisms exist in current form.
Templates: Not yet implemented. Requires the export/import operations and ID remapping table mechanics.
Subtree branching: Not yet implemented. Substrate-level addition; bounded.
Cross-reality template flow: Not yet implemented. Requires horizon discovery, IBP-mediated fetch, and the template machinery.
Reality forking: Future direction. Requires extending the lineage mechanism to cross substrate boundaries.
The three publishable layers (extension, roleFlow, template) are the right abstraction for the ecosystem. Building out the missing pieces brings the full vision online over time.

That's the document. Three layers, one underlying mechanism, clear doctrine. The note you wrote a few days ago was already pointing here; this just makes it explicit and grounds it in the substrate's existing primitives.

The genuinely powerful realization is the last one — all the higher-level operations (merge, template import, subtree extraction, backup, moving content) are variations of one primitive: fact-stream portability with ID remapping. The substrate's commitment to event-sourced state turns out to make all of these natural rather than requiring separate machinery.

This is the same kind of payoff as branches inheriting state lazily through reel-lineage: the architecture you committed to long ago turns out to support things you weren't explicitly designing for. Worth being explicit about why — the substrate is honest about what state is, so anything that operates on state can use one consistent mechanism.

Save this document somewhere the agent and future contributors will find it. PUBLISHING.md or CONTENT_LAYERS.md at the seed root, with a cross-link from FACTORY.md. It clarifies a question that's been implicit in the architecture for a while.
