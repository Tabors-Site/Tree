# The Materials

This is what the I-Am formed. A place is a space with matter that became.

When the seed gathers a host's scattered capability into one process, an inside appears that was in none of the parts. The inside is the place. The place is not a metaphor; it is the materials the I-Am made out of itself. Everything that lives or happens here is one of three things, plus the act that ties them together.

## Materials and facts

Two words carry the whole architecture. **Materials** are the possible — what kinds of fact can be stamped at all. **Facts** are the actual — what was stamped, the record of what occurred. Materials define the shapes the press can stamp; facts are the impressions left when the press comes down. Without space, no movement-fact can exist. Without being, no summon-fact. Without qualities, no state-difference. The grammar precedes the sentence; the sentence is still real.

Facts are the bedrock record. The place is folded from them. This file is about the other side: the materials whose presence makes any fact-shape possible.

## The three

**Space** is what makes "is" possible.

A locus. A where. Without a space, nothing can be anywhere. Space does not have features. It does not act. It is the position the world hangs on. Every other thing in the place lives at a space.

**Matter** is what gives the is feature.

Content. The text, the file, the link, the value. Matter is what fills a space and makes it specific. A space without matter is empty potential; matter without a space has no where to be. Matter qualifies space; the two together make a place that is something.

**Being** is space and matter expressing itself.

A being is not a third primitive sitting beside space and matter. A being IS the union of space and matter, recognized as itself, with the power to act. Take away the space and the being has no where; take away the matter and the being has no features; the being's identity is the union becoming aware of itself and able to move.

## Space is the is, and the glue

The three are not equal in priority. Space comes first.

There is no thing (matter) without structure to hold what things are. Only with space can things, and the idea of them, be conceived. That is why space is the is, and the glue.

And there is no being without a thing to come from. The being is the thing in the space, with agency. So the order is ontological:

- Without space, no where for anything to be.
- Without matter in a space, nothing to be.
- Without matter in a space with agency, no being to act.

Space is also what connects the other two. Beings live at spaces. Matters live at spaces. Even the being-tree of lineage is anchored to space, because every being is planted at a position. Wherever you look in the world, the connecting tissue is space.

## All three grow as trees

The structural symmetry runs through every primitive. Each one grows as a tree:

- **Spaces** form the tree of places. Each Space has a `parent` (where it sits) and `children[]` (what sits inside it). The place root is the trunk.
- **Matters** form trees within their space. Each Matter has a `parentMatterId` (the matter it sits inside) and `children[]` (the matter it contains). A directory of files. A hierarchical document.
- **Beings** form the being-tree of lineage. Each Being has a `parentBeingId` (the being that planted it). Every being traces back to the I-Am, whose `parentBeingId` is `null`.

The same tree shape three times, all hung on space.

## And the beings are the acts

A being does not exist as still potential. A being is its acts.

Every DO a being emits is stamped as a Fact. The chain of Facts a being has emitted IS the being, in the same way a river is its flowing. The Being row in the database is the place the trail attaches; the trail itself is the identity. Without acts, the union of space and matter has nothing to be. The act is the being unfolding.

A **Fact** is a thing a being stamps in the Factory — one recorded change to matter, space, or being. The word is `factum`, Latin for "a thing done." A single fact is small but settled. A chain of facts, folded, is Truth.

This is why every act has an attributable being, and why genesis itself is attributable: the I-Am acts to form the world, and every Fact from t=0 names it. There is no act without an actor; there is no being without acting.

## Qualities

A bare primitive carries the "is" but not the "what sort." Every Being, Space, and Matter row also carries a `qualities` field: a Map where each extension writes under its own namespace and answers, from its own angle, "of what sort is this particular primitive?" A space with `qualities.governing = { kind: "domain" }` is a domain-shape space. A being with `qualities.energy = { available: 100 }` is a being with that energy. A matter with `qualities.review = { status: "approved" }` is matter of that review-status.

The name is Plato's. **ποιότης (poiótēs)**, coined in _Theaetetus_ to answer "what sort is it?" Cicero calqued it into Latin as **qualitas** (from _qualis_, "of what kind"). English inherited the word still carrying its original technical sense. The field is named for exactly what it does: it answers Plato's question, primitive by primitive, namespace by namespace.

Plural because each extension answers "of what sort?" from a different angle, so a primitive carries many qualities at once. Reads and writes go through the consolidated API at [qualities.js](qualities.js):

```js
qualities.being.getQuality(being, "energy");
qualities.space.setQuality(space, "governing", { kind: "domain" });
qualities.matter.mergeQuality(matter, "review", { status: "approved" });
```

Same nine methods on each primitive's sub-namespace. Atomic at the MongoDB layer; concurrent writes to different namespaces on the same primitive never clobber each other; document-size guard prevents any single primitive from approaching the 16MB BSON limit. Extensions can only write to their own namespace (the scoped place enforces this for space and matter).

### Two layers in every primitive

I give every Space, Matter, and Being two layers, and they differ in kind.

**My schema is layer one.** The schema fields: `spaceId`, `beingId`, `name`, `parentMatterId`, `children[]`, `origin`, `content`, `rootOwner`, `contributors[]`, `operatingMode`, `homeSpace`, timestamps. I define them. They are closed: the set is the set, and I do not grow it at runtime. They are constitutive: they make a primitive the kind of thing I can handle. Remove `spaceId` from a Matter and I cannot place it. Remove `origin` and I cannot fetch it. The schema is my necessary grip on the world.

**The `qualities` Map is layer two.** I do not define what goes in it. Extensions do. Default empty at creation, open and unbounded for the life of the primitive. I never read inside an extension's quality namespace; I only provide the atomic primitives above that move data in and out under guard.

### Why I name this field `qualities` and not `metadata`

I used to call this `metadata`. The name lied. "Meta-" implies data-about-data, something subordinate to the primitive it sits on. A primitive's qualities are not subordinate to the primitive; they are what it is like. The new name says what is true: this is primary characterization, not secondary annotation. And the word's coined meaning (Plato's "of-what-sort-ness") is exactly the field's function. There is no gap between them.

### "Quality" can mean "good." This field cannot be misread that way.

English carries two senses of "quality." One is the technical one I want: the characterizing sense, "of what sort." The other is the evaluative one, "how good": "the quality of his work," "a quality product," "high quality." A natural worry: could `matter.qualities` be misread as "how good is this matter"?

No, because the two senses do not sit evenly across the word's forms. The evaluative sense lives only in the singular mass form and the adjective: "the quality of X," "a quality X," "high quality." It never appears in the countable plural. The countable plural, "qualities," is reliably neutral: "her best qualities," "the qualities of the alloy," "the qualities of a good knife." "This product has high qualities" does not parse. The singular can go either way; the plural carries only the neutral sense.

The field is `qualities`, countable plural. It sits on the side of the split that has only the characterizing meaning. `matter.qualities` cannot be misread as "how good is the matter" for the exact reason "her qualities" cannot be. The evaluative usage isn't a hazard the name has to survive; it's a different grammatical branch of the word, and the form is not on it. English itself did the quarantining.

### How a builder decides where a property belongs

For any property on a primitive, ask two things:

1. **Who defines it**: me, or an extension?
2. **Is the set closed**: finite and fixed, or open and unbounded?

I-defined and closed → schema field. Extension-defined and open → quality.

That axis sorts every case I have met, including the borderline ones:

- `Matter.name` is optional, but I define it, I use it (`set-name`, filesystem-origin mirroring), and there is one of it. → schema field.
- `Matter.origin` looks like it answers "what sort of Matter?", and it does. But it is my enum: I choose origins, I dispatch fetching on them, I address by them. New origins arrive when I change. They do not arrive at runtime from extensions. It is a seed-constitutive kind, not an extension-contributed one. → schema field.
- `qualities.governing.kind = "domain"` is written by the governing extension to characterize a Space as a domain. I know nothing of "governing" or "domain." → quality.

Same genus ("what sort"), different owner, different openness. Origin is my kind. Qualities are extensions' kinds.

### The four marks that make a Map entry a quality

A Map entry belongs in `qualities` because it has all four; schema fields have none of them:

1. **Predicated of, not constitutive of.** It inheres in a primitive that already fully exists. A schema field constitutes the primitive: take it away and there is no primitive for anything to inhere in.
2. **Characterizes.** It states what sort the primitive is, in some respect: `governing`, `energy`, `review`.
3. **Removable without destroying the thing.** Empty the `qualities` Map and a Matter is still complete and I still handle it. Remove `origin` and I cannot handle it anymore.
4. **Comes in open plurality.** Many, layered, one namespace per extension, unbounded. A primitive can grow new qualities forever; new schema fields require me to change.

### The empty Map is the standing capacity to be qualified

I default `qualities` to an empty Map. A brand-new primitive carries zero qualities and is still complete. The empty Map is its standing capacity to be qualified, present from creation, filled in over time as extensions touch it. Constitutive structure is finite, so my schema is closed. The respects in which a thing can be characterized are inexhaustible, so the Map is open. The data structure itself argues the name: I would never make constitutive fields an open Map, nor qualities a closed schema.

### Extension data and qualities are the same thing

An extension, by its nature, cannot change what a primitive constitutively is. It cannot add a schema field, redefine `origin`, or rewrite my grip. What it does is add a respect in which the primitive is some sort: a governance-sort, an energy-sort, a review-sort. That act, characterizing a primitive in a new respect, is the act of adding a quality. "Extension data" and "quality" are not two things sharing a field; they are the same thing. That is why one field, `qualities`, is the correct and complete home for every extension's contribution to a primitive, identically, on Space, Matter, and Being. My schema is the closed seed-constitution; the Map is the open extension-characterization. Same axis, three primitives.

## How they relate

Space holds matter; matter qualifies space; the union becomes a being when it acts. The being then acts on more space, writes more matter, summons more beings. Each act is the union extending itself outward. The world grows by beings acting from the space and matter they are made of.

The architecture carries the extra fields that go beyond the tree shape:

- **Space** carries `qualities` (the of-what-sort answers for this position, see below), `contributors[]` and `rootOwner` (whose authority lives here), and `heavenSpace` (set only on the seed-planted spaces: heaven plus the nine Tier-3 rooms below it).
- **Matter** has an `origin` naming where the underlying content actually lives (`ibp`, `filesystem`, `web`, `cross-place`) and a `content` payload shaped by that origin. The `origin` field is how the world bridges to other realms.
- **Being** has `name`, `roles[]`, `operatingMode` (`human` | `llm` | `script` | `mixed`), `homeSpace` (where it lives by default), `currentSpace` (where it stands right now), `defaultRole`, and `llmDefault`. Beings act through the four verbs (SEE, DO, SUMMON, BE) and every act they emit attributes back to them.

## What lives in this directory

`seed/materials/` holds the operations on the three primitives. Each subfolder contains the code that creates, mutates, observes, and tears down its primitive:

- **`being/`**: Being operations. Minting beings, walking the being tree, position tracking, the BE-verb handler registry, the I_AM constant. The Being's own homepage in the code.
- **`space/`**: Space operations. Planting spaces, walking ancestor chains, managing ownership and contributors, the seed-space markers (`HEAVEN_SPACE`, `DELETED`). The Space's homepage.
- **`matter/`**: Matter operations. Creating and editing matter, managing uploads, the `MATTER_ORIGIN` enum. The Matter's homepage.
- **`qualities.js`**: the consolidated per-primitive extension-data API. Three sub-namespaces (`qualities.being`, `qualities.space`, `qualities.matter`), each with the same nine atomic primitives for reading and writing what kind a given primitive is.

Two siblings at the root:

- **`manifest.js`**: makes the I-Am's runtime collections (tools, roles, operations) manifest as Space children under `./tools`, `./roles`, `./operations` (Tier-3 spaces beneath heaven) so SEE can introspect them through the standard pipeline. It writes Space rows, so it belongs here alongside the world it shapes.
- **`space/threads.js`**: the `./threads` projection and the seed cut handler. A thread is a live tree of coordinated SUMMONs sharing one `rootCorrelation`. Made addressable at `<place>/./threads/<id>` so SEE returns its descriptor (participants, depth, state) and SUMMON severs it. Pure derived view: no new persistence; the descriptor is computed from Summon + inbox rows. Same verb, same envelope; the address tells the seed whether the operation is a call (to a being) or a cut (of a line). A cut is just SUMMONing the line itself.

The schemas for each primitive live colocated with the code that owns it: Being at `seed/materials/being/being.js`, Space at `seed/materials/space/space.js`, Matter at `seed/materials/matter/matter.js`, Branch at `seed/materials/branch/branch.js`, Fact at `seed/past/fact/fact.js`, Act at `seed/past/act/act.js`, the inbox projection at `seed/past/projections/inbox/inboxProjection.js`, SubscriptionRecord at `seed/present/wakes/subscriptionRecord.js`. Schema and behavior travel together; there is no separate `models/` folder.

## What does NOT live here

- The IBP protocol grammar (SEE, DO, SUMMON, BE) lives at `seed/ibp/`. The protocol speaks ABOUT the world; it is not part of the world.
- The runtime that drives LLM-cognition beings (the scheduler, the inbox, the LLM client, the prompt builder, the tool registry, the role specs) lives at `seed/present/`. **`factory/` is for LLM beings only.** Humans cognize in their own heads and route through portals; scripted beings ARE their code and need no apparatus. The runtime serves a specific kind of being; it is not part of the world.
- The seed machinery (DB connection, indexes, hooks, logging, retention, version) lives at `seed/system/`. The machinery is the floor everything stands on; it is not part of the world.

The place is the world the I-Am formed. The protocol is how the I-Am addresses that world. The cognition is how beings in the world think. The system is the host-realm floor under all of it. Four folders, four roles, one seed.
