# hello-world

The canonical example extension for TreeOS. One file, one role, one seed:

1. The **greeter role** — when summoned, the being looks at its position (SEEs its space and the spaces around it) and returns a greeting addressed to both the asker AND the world it just saw.
2. The **greeter seed** — when planted at a target space, spawns one being there with the greeter role.

## Try it

The extension loads at boot when placed under `extensions/hello-world/`. After boot:

```bash
# Plant the seed at the place root.
treeos do <place-root-id> plant '{"seed":"hello-world:greeter"}'

# Summon the greeter — you'll get a "hello world" back.
treeos summon "<reality>/@hello-<id>" "hi"
```

You should see something like:

> Hello world! Hello to you, operator, and to the world I see — "My Reality", surrounded by ".identity", ".config", ".peers", ".extensions", ".tools", ".roles", ".operations", ".source", ".threads".

## Why this is the canonical example

The extension uses exactly the primitives every extension uses:

- **Manifest** declares what the extension needs from the seed (services, models, optional declarations).
- **`init(place)`** is the one entry point. It registers a role and a seed.
- **`place.declare.registerRole(name, def)`** wires the role into the registry. The loader auto-namespaces (`greeter` becomes `hello-world:greeter`).
- **`place.seeds.register(name, recipe)`** wires the plantable scaffold. The recipe's `scaffold(ctx)` is one `place.summon` of `<reality>/@<new-being>` with `content: { kind: "create-being", spec }` — the standard SUMMON-create-being primitive, no special seed-side creation path.
- The greeter role returns a **CognitionResult** (`cognitionSuccess(text)`). On any internal failure (position can't be resolved, etc.), it would return `cognitionFailure(shape, reason)` and the seal would NOT fire — no Act would land, the InboxProjection row would stay open, the being's reel byte-identical. That's the Round 5 structural seal-gate at work.

## Flip to LLM cognition

The role is scripted today (deterministic code). Flipping to LLM:

1. Change the seed's spec: `operatingMode: "scripted"` → `"llm"`.
2. Add an llm connection on the being after plant (or in the spec).
3. Remove the custom `summon()` from the role; let the registry's default-summon-wrap handle dispatch (runs the LLM voice). The role's `prompt: () => "..."` becomes the system prompt.

The greeting behavior stays the same; only the cognition that produces the text changes.

## What this extension does NOT do (deliberately)

- No tools — the greeter doesn't need any.
- No jobs, no routes, no HTTP API — only the IBP verbs.
- No matter, no qualities — the role's response is computed, not stored.
- No DO operations — greeting doesn't mutate anything.

If you're building an extension that does any of those, copy `_template/` instead. This one's the minimum.
