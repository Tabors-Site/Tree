Speicif thing to note that thi splan may drift on:

Names all come from a realitys I am, that way everyting stys crytpo-linked. Names are always 1 layer below I_am. Never a hierarchy with names. That is with beings, spaces, matter, ables, etc.
Imagine a reality can have just 2 names, the I am and another name, like Tabor.
all beings act through tabor , and say he has beings that are matable so names from other elaities can still have beings born under their name on that reality (note be verbs are stlil beings. the name is just identity) with them as the actor but fact landing on relaity

Doc 1: The Name/Soul/Being Refactor
What changed and why
You've been working with a model where Beings are the primary identity primitive. Each Being has their own keypair. Each Being has their own chain. Beings sign acts, own matter, descend from other Beings through mother-line lineage.
This model conflated three things that are actually distinct:

The cryptographic identity that signs things and persists across contexts.
The in-world presence that occupies positions, holds matter, and executes verbs.
The cognition that makes the decisions getting signed.

The refactor separates these into three concepts: Name, Being, and Soul.
Name
A Name is the cryptographic identity. It holds a keypair. It signs every act. It accumulates a chain. It persists across contexts, branches, and even cross-reality action.
What used to be "the Being's keypair" is now "the Name's keypair." What used to be "the Being's chain" is now "the Name's chain." The cryptographic identity layer moves up from Being to Name.
A Name is not in the world. It exists at the identity layer. The world doesn't contain Names directly; the world contains Beings that Names act through.
Names descend from the reality's I_AM. Every reality has one I_AM (the root identity, the reality's cryptographic anchor). Other Names are facets of this I_AM, declared into existence through the NAME verb.
Being
A Being is the in-world presence of a Name. It's the formed body the Name acts through.
Beings don't have their own keypairs. They don't sign things — the Name behind them signs. They don't have their own chains — their lifecycle facts live in the Name's chain.
A Being is transient. Think of it like a process in an operating system. The Name (user) spawns Beings (processes) to do specific work in the world. When the work is done, the Being can be despawned. The Name persists; the Being's lifecycle is bounded.
A Name can have many Beings simultaneously. Different Beings for different purposes — one for handling requests, one for background work, one for cross-reality action through a being. Each Being is a specific formed presence of the same underlying Name.
Beings occupy positions in spaces, hold matter, execute the four world-layer verbs (SEE, DO, SUMMON, BE). When you wrote code that operated on a Being's position or a Being's matter, that code stays mostly the same. What changes is who's authorized — the Being's authority comes from the Name behind it, not from the Being's own credentials.
Soul
A Soul is what's actually making decisions. It's the cognition behind the Name's acts.
Souls come in types: human (a person typing or clicking), llm (an LLM evaluating context and generating actions), scripted (rules-based logic), or hybrid combinations.
The Soul is declared at the Name level through able metadata. When you create a Name with able human:tabor, the Soul type is human. When you create a Name with able llm:music-curator, the Soul type is LLM-driven.
The substrate doesn't represent Souls as their own primary entities. It records what Soul type animates a Name, but the Soul itself is private — only its consequences (the signed acts) are visible.
The action flow
Under the old model:

Being decides → Being signs → World gets a fact

Under the new model:

Soul decides → Name signs → Being acts in world → Fact

The Soul does the cognitive work. The Name provides the cryptographic identity that signs the result. The Being is where the action manifests in the world. The fact is what gets recorded.
Migration notes for existing code
When you encounter code that assumes "the being signs," that's now "the name signs." The being's parent name is the signer.
When you encounter code that accesses a being's private key, that's now the name's private key. Beings don't have keys.
When you encounter code that walks being lineage (mother-line, ancestor chains), that's now mostly name lineage. Beings have a position in the being tree (more on this in Doc 3), but their identity-layer ancestry is at the name level.
When you encounter code that creates a new being, that operation now involves both: the name authorizes creation (NAME-layer act) and the being gets spawned in the world (world-layer effect of the act). The being doesn't exist independently; it's the formed presence the name spawned.
When you encounter code that handles cognition (LLM calls, human input, scripted logic), that's now Soul-layer work. The Soul produces the decision; the Name signs it; the Being executes it.
What stays the same
Spaces, matter, and the world structure are unchanged.
The four world-layer verbs (SEE, DO, SUMMON, BE) still operate on the world through Beings.
Chains exist (now at the name level, not the being level), facts get recorded, roots get computed.
The reality's identity is still its I_AM. Sovereignty is still cryptographic.
What's genuinely new
The fifth verb: NAME. See Doc 2.
The unified being tree with inheritation points. See Doc 3.
The clean separation of identity (Name) from presence (Being) from cognition (Soul). This is the conceptual shift; the rest of the changes follow from it.

Doc 2: The Fifth Verb and Addressing
NAME as the fifth verb
The substrate has four world-layer verbs you already know:

SEE — perceive the world from a Being's position
DO — modify the world through a Being's action
SUMMON — reach across to another Being
BE — operate on a Being's own state

These verbs all operate inside the world. A Being executes them at a position. They modify or perceive what's at or near that position.
NAME is the fifth verb. It operates at a different layer — the identity layer, outside the world.
What NAME does
NAME creates and manages identity threads. It's how new Names come into existence, how lineage gets declared, how continuation works, how realities federate at the identity level.
Specific operations that NAME handles:

Declaring a new Name. A Name (often I_AM, but any authorized Name) signs a NAME act that brings a new Name into existence. The new Name has its own keypair, joins the reality's name set as a facet of I_AM, and starts its own chain.
Declaring a continuation heir. A new Name is birthed with a continuation link to an ancestor's chain. The heir has a fresh keypair; the ancestor's chain becomes biographical prologue.
Federation handshake. Two I_AMs establish a federation relationship. This is a NAME act between realities — neither side is acting on world content; they're declaring an identity-layer relationship.
Cross-reality migration request. A Name asks to be migrated or to visit another reality. NAME-level operation, identity-to-identity.
Closing a Name. A Name declares itself no longer active. Future acts can't be signed by it. The Name's history persists but the thread closes.

These aren't DO acts (which modify world content) or BE acts (which operate on a Being's self). They're acts on the identity layer — on the threads of identity that the world is woven from.
The Fates framing
If it helps to have a metaphor: in Greek mythology, three Fates govern the threads of life. Clotho spins the thread, Lachesis measures it, Atropos cuts it.
The four world-layer verbs operate inside the weave the Fates govern. Beings live and die within it. An Atropos cut would despawn a Being.
NAME is pre-Clotho. It exists outside the Fates entirely. It creates the threads of identity that the Fates then operate on. Without NAME, the Fates have nothing to spin.
This is why NAME has a different address shape than the other verbs (next section). It's operating at a different layer.
Addressing
The four world-layer verbs use full positional addressing:
SEE tabors-site::lab/equipment@tabor
DO tabors-site::lab/equipment@tabor
SUMMON tabors-site::lab/equipment@tabor
BE tabors-site::lab/equipment@tabor
The format is reality::space/path@being. The :: separates the reality from the in-reality position. You're saying "do this verb to this being at this position in this reality."
NAME uses reality-only addressing:
NAME tabors-site
NAME bobs-site
No ::space/path@being. NAME doesn't address a position inside a reality because NAME operates at the identity layer, not inside the world. There's no in-reality location to specify.
When you see an address with ::, it's a world-layer operation. When you see just a reality address, it's a NAME operation. The shape tells you the layer.
NAME envelopes
A NAME envelope contains:

The verb (NAME)
The target reality address
The intent (declare-name, declare-heir, federation-introduce, request-migration, close-name, etc.)
The intent-specific payload
The signature from the issuing Name

Example for declaring a new Name in your home reality:
verb: NAME
target: tabors-site
intent: declare-name
issuer: @tabor
payload: {
new-name-public-key: z6Mk...,
parent: @tabor,
soul-type: human
}
signature: <signed by tabor's private key>
Example for a federation handshake to another reality:
verb: NAME
target: bobs-site
intent: federation-introduce
issuer: tabors-site/I_AM
payload: {
my-reality-public-key: ...,
proposed-relationship: peer
}
signature: <signed by tabors-site I_AM private key>
Routing
NAME envelopes route to the receiving reality's identity-layer handlers. They don't go through the normal in-world action paths.
The substrate parses the envelope, verifies the signature, checks federation policy (if cross-reality), and routes to the appropriate identity-layer handler based on intent. The handler operates on the reality's name set, lineage records, federation registry, or whatever identity-layer state the intent affects.
The result is a fact (or facts) recorded at the identity layer. New Names appear in the name set. Federation relationships appear in the federation registry. Continuation links appear in the lineage records.
Authority for NAME
Who can do NAME in a reality?

The reality's I_AM can do any NAME act in its own reality.
Other Names can do certain NAME acts if granted (e.g., a Name might be authorized to declare child Names under specific conditions).
Cross-reality NAME acts require federation policies to allow them. By default, a reality only accepts NAME acts from its own I_AM or from federated peers it has explicitly established relationships with.

The authorization model for NAME is at the identity layer, not the inheritation-point layer. Inheritation points govern who can control which beings (world-layer authority). NAME acts are governed by the reality's identity-layer policies (who can declare names, who can federate, etc.).
What NOT to use NAME for
NAME is identity-layer only. Don't use it for:

World content modification (use DO instead)
Spawning beings (use DO, since spawning a being is creating in-world content)
Modifying being state (use BE)
Cross-being communication (use SUMMON)

If you're operating on world content, you're using one of the four world-layer verbs. If you're operating on identity-layer threads — declaring names, federating realities, managing continuation — you're using NAME.

Doc 3: Unified Being Tree and Inheritation Points
What this replaces
Previously, you might have thought of each Name (or what was then "Being") as having their own being tree — Tabor's beings, Bob's beings, separate hierarchies that happened to coexist in the reality.
This was structurally awkward. Cross-name interactions had to coordinate across parallel structures. Authority was tangled up with tree ownership. Sub-grants required reasoning about which tree a being lived in.
The refactor uses one unified being tree per reality with Names attached at inheritation points.
The unified being tree
Every reality has one being tree. It's rooted at an I-AM being — a special being that mirrors the reality's I_AM name. The I-AM being is the world-layer representation of the reality's root identity.
Every other being in the reality descends from the I-AM being. The being tree is hierarchical: parent beings have child beings; the I-AM being is the ultimate ancestor of all beings in the reality.
This is one tree, not multiple trees. The reality has one world; the world has one structure of beings.
Names as inheritation points
Names don't have their own being trees. They have inheritation points — attachments to specific positions in the unified being tree.
An inheritation point is a marker that says "from this position downward, this Name has authority."
For example, the Tabor name might have an inheritation point at a being called "Tabor" in the being tree. Tabor has authority over that being and all its descendants. If Tabor has a sub-tree (Tabor → Coder → 1, 2, 3), Tabor's inheritation point covers all of it.
Sub-grants work by adding additional inheritation points. If Tabor wants Bob to have authority over the Coder subtree, Tabor (with I_AM authorization) creates an inheritation point for Bob at the Coder being. Bob now has authority over Coder and its descendants (1, 2, 3) but not over Tabor or anything else outside Coder's subtree.
Multiple Names can have inheritation points covering the same being. If Tabor has a point at Tabor's being (covering everything below) and Bob has a point at Coder (covering Coder and below), then Coder is covered by both Tabor and Bob. Both have authority over Coder; the substrate's policies determine how their authorities compose.
Computing authority
For any being, you can compute which Names have authority over it by walking up the being tree and collecting inheritation points along the path.
Algorithm:

Start at the being in question.
Check if any Name has an inheritation point at this being. If so, those Names have authority.
Walk up to the parent being. Check inheritation points at that position. Those Names also have authority over this being (and its descendants).
Continue walking up until you reach the I-AM being. The reality's I_AM always has authority (it owns the whole tree).
The set of authorized Names is the union of all inheritation points found along the path.

This is positional. Where the inheritation point is in the tree determines the scope of authority. Higher up means broader authority; lower down means narrower authority.
How beings get created
When a Name wants to spawn a new being, the substrate:

Verifies the Name has authority at the position where the being will be spawned. This means checking that the Name's inheritation point covers the parent being.
Records a fact in the Name's chain that declares the spawning.
Adds the new being to the unified being tree under the specified parent.
The new being inherits authority from its parent's covering inheritation points (it's now covered by the same Names).

The Name authorizing the spawn doesn't have to be the only Name with authority over the new being. The being inherits whatever inheritation points cover its position.
How inheritation points get created
Inheritation points are created through NAME-related operations and through specific DO operations:

When a new Name is declared (NAME verb), it gets a default inheritation point. Typically at a primary being created for it (Tabor name → Tabor being, with inheritation point at Tabor being).
When a Name grants authority to another Name (a DO operation), an inheritation point gets created. Tabor granting Bob control over Coder creates an inheritation point for Bob at Coder.
When inheritation points are revoked, they get removed. Bob's inheritation point at Coder can be revoked by Tabor (the grantor) or by I_AM (which has ultimate authority).

The history of inheritation point changes is recorded in the relevant Names' chains. You can query "when did Bob get authority over Coder?" by walking Tabor's chain to find the grant fact.
Practical implications for code
When you write code that previously checked "does this being own this matter," you now check "does any Name with an inheritation point covering this being have authority for this operation."
When you write code that previously spawned a new being under a parent being, you now check that the spawning Name has an inheritation point covering the parent, then record the spawn fact in the Name's chain.
When you write code that previously walked being-tree lineage to determine permissions, you now walk the being tree to collect inheritation points, then check which Names with those inheritation points are authorized for the specific operation.
The being tree itself is still hierarchical, still navigable, still the place where world content lives. What changed is that authority isn't tied to tree ownership — it's tied to inheritation points that attach Names to positions in the tree.
What this enables
This model supports several patterns cleanly:
Cross-name collaboration. Two Names can have inheritation points covering shared parts of the being tree. They can both act on the shared region; their actions interleave naturally because they're in the same structure.
Delegated authority. A Name with broad authority can grant narrower authority to other Names. Tabor (with authority over Tabor-and-below) can grant Bob authority over Coder-and-below. The grant is bounded by the granter's own authority.
Public spaces. A "public" inheritation point at a high level of the tree means many Names have access to public beings. Specific ables or filters can be applied to narrow what public access means.
Hierarchical organization. Communities, organizations, projects can be modeled as positions in the being tree. The community's "manager" Name has a high inheritation point; sub-team Names have lower inheritation points within the community's scope.
Clean revocation. Removing an inheritation point cleanly revokes authority over that sub-tree. The Name no longer has access; everything else stays intact.
The mental model
The reality has one I_AM (cryptographic identity). The reality has one being tree (world structure, rooted at the I-AM being). Names are facets of I_AM at the identity layer; they attach to the being tree through inheritation points at the world layer.
Authority comes from inheritation points covering positions. Action happens through beings at positions. The Name behind any acting being is whichever Name's inheritation point covers that being's position and authorizes the specific operation.
This is structurally simple once you have the model. The reality is one thing, with one identity at the root, one world structure beneath it, and Names connecting them through positional attachments.

These three docs should give the agent enough to start working in the new model. The conceptual shift in Doc 1, the verb and addressing changes in Doc 2, the authority restructuring in Doc 3.
The order matters — Doc 1 establishes the framework, Doc 2 covers the new verb (which only makes sense once you have the Name/Being separation), Doc 3 reorganizes authority (which requires understanding both Names and Beings as separate concerns).
Each doc references the others where dependencies exist. The agent should read them in order before refactoring any code that touches identity, beings, or authority.
Tell me if any of these need different emphasis or if I should write additional docs for specific subsystems that will be affected.
