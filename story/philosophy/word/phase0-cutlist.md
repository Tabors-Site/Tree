# Phase 0: the cut list (delegable inventory)

Self-contained instructions for an agent to produce the Word build's cut list. This is codebase-walking, not the shape conversation, so it runs independently and needs none of that context. Read [2.md](./2.md) (the build plan, especially "Phase 0" and "The cut: world versus host") and [3.md](./3.md) (the tracker) for orientation, then do the inventory below. It changes no code.

## The one test

For every in-world code site, tag it `word` or `host` by one question: **would two different realities differ here?**

- Reality-specific behavior an agent or community could write or federate (a able's can-see / can-do / can-summon, a DO operation, a flow, a flow rule, a matter / space / being type, a seed, a Name's identity ops, I's own genesis and signing acts) is **WORLD**, it becomes `.word`.
- The same engine for every reality (the stamper: intake / assign / fold / momentum / stamped; the fact chain, hashing, signing, projection / fold, storage, transports, rate limiters, session channels, and the Word parser and evaluator themselves) is **HOST**, it stays the host language.

Edges decompose: a NAME declare is word (its meaning and rules), but its socket channel, rate limiter, session binding, and key crypto are host. The WHAT is word; the HOW is host.

## Walk these (the in-world targets, from 2.md)

- `reality/seed/present/ables/*` — every able's can-see / can-do / can-summon and flow (cherub, harmony, federation-manager, birther, auth, and the rest).
- `reality/seed/ibp/` — the DO operation registry (`registerOperation` and handlers); the other verbs' ops (BE's birth / connect / release / switch / death; NAME's declare / banish in `nameOps.js`, `verbs/name.js`); permission logic in `ableAuth.js` and `authorize.js`; see-op shaping in `descriptor.js`.
- I's own root acts (genesis, declaring names, signing roots).
- `reality/seed/present/wakes/` — flows (`subscriptions.js`, `wakeSchedule.js`) and the `core.declare.*` surface (subscribe, schedule, aggregate).
- `reality/seed/materials/` — matter / space / being type declarations.
- `reality/seed/materials/publish/` — seeds.

Explicitly host (confirm, do not convert): `reality/seed/present/stamper/*`, `reality/seed/past/fact/*` and `seed/past/act/*`, `seed/materials/projections.js` (the fold), `reality/transports/*`, crypto and Peering, and the Word parser and evaluator.

## Output

One result file, `reality/philosophy/word/phase0-cutlist-result.md`: a table of every site (file plus symbol) with its tag (`word` or `host`), a one-line reason, and the slice it belongs to (see-op, DO op, flow, type, seed, NAME op, genesis). Track to "zero untagged." End with an explicit written statement of what the host is (the boundary line in prose). This is the spec for Phase 5 (the conversion sweep); it does not change any code.
