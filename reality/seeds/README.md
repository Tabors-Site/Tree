# reality/seeds/

This is the canonical folder for **reality seeds** — portable genomes of a TreeOS reality. See [seed/Chain-Rebuild.md](../seed/Chain-Rebuild.md) for the doctrine.

Sibling to `reality/extensions/` because both are operator artifacts: extensions are code-level installs, seeds are reality-level genomes. The sovereign `seed/` substrate folder is reserved for the never-modify kernel.

## What lives here

- Captured seeds (`*.seed.json`) — produced by `reality.captureSeed()`.
- Seeds you want to plant on boot — `PLANT_FROM_SEED=<filename>` resolves filenames here.

## Capturing a seed

From inside a running reality:

```js
await reality.captureSeed({ realityName: "my-reality" });
// → writes reality/seeds/my-reality-2026-06-06T...seed.json by default
```

Or save to a specific location:

```js
const bundle = await reality.captureSeed({ realityName: "alice", returnOnly: true });
await fs.writeFile("./alice-backup.seed.json", JSON.stringify(bundle));
```

## Planting a seed at boot

Two ways to point at a seed:

```bash
# Filename — resolves to reality/seeds/<name>
PLANT_FROM_SEED=alice.seed.json node begin.js

# Absolute or relative path — used as-is
PLANT_FROM_SEED=/backups/alice.seed.json node begin.js
PLANT_FROM_SEED=./alice.seed.json       node begin.js
```

Plant only succeeds on a fresh DB. Wipe before planting.

## What's in a seed

- Every Fact (the substantive chain)
- Every Act (the experiential record — cognition transcripts, what each being saw and decided)
- Every Branch (paths, branchPoints, scope, lifecycle)
- Every ReelHead (per-reel seq counters — required for fact-chain continuity)

Original IDs preserved verbatim. A planted seed is the reality **continuing** on a new substrate, not a duplicate.

## Why a folder, not anywhere

Seeds are reality genomes, not scratch files. Keeping them in one canonical place means:

- One place to back up
- One place to scan for "what realities do I have available?"
- Operator habits stay consistent across machines
- The `.gitignore` keeps them out of the source repo by default (they may contain private state)
