# Converting seed to `.word` — the pattern + where files go

The goal (Tabor): NO half word/JS state in the bulk. Once the pattern is proven, switch
ALL seed roles + genesis to purely `.word`, and the `.word` files live WHERE THEY BELONG
(with the code they are the world-strand of), not piled in `present/word/`.

## What stays in `present/word/` (the ENGINE) vs what moves out (the SLICES)

`present/word/` is the Word ENGINE — shared machinery, role-agnostic, never moves:
- `parser.js` — prose → IR
- `evaluator.js` — runs the IR (the §0–§11 node kinds)
- `cond.js` — `resolveCond` / `getPath` (the §1 condition surface)
- `roleWordRegistry.js` — the bridge: `resolveRoleWord` / `runRoleWord` / `bornBeingFrom` / `registerRoleWord`
- the ENGINE gates: `verify-cond.mjs`, `verify-flow.mjs`, `verify-bridge*.mjs`

Everything else is a SLICE — the world-strand of a specific role/feature — and lives WITH
that code:

| slice | `.word` goes to | host-escape glue goes to | verify goes to |
|---|---|---|---|
| a role (cherub, birther, …) | `roles/<role>/<role>.word`, `roles/<role>/<role>-<op>.word` | `roles/<role>/<role>Host.js` | `roles/<role>/verify-*.mjs` |
| genesis (the creation narrative) | next to `sprout.js` (`genesis.word`) | — | — |
| the primitives (being/space/matter type law) | `materials/<kind>/<kind>.word` | — | — |
| a DO-op slice (give, …) | with the op's module | with the op's module | with the op |

The rule: a `.word` file is the WORLD strand of its module, so it sits in that module's
directory. The HOST escapes it reaches (session/transport/crypto) sit beside it as the
module's `*Host.js`. The engine that runs them all stays central.

## The registry: roles co-locate + register their own `.word`

`registerRoleWord(role, op, fileUrl)` lets a role register its co-located `.word` (a
`new URL("./cherub.word", import.meta.url)` relative to the ROLE file). The seed boot
registers all seed roles, so all their `.word` register at genesis — `resolveRoleWord`
then works everywhere a booted reality exists. A DRY harness (no boot) imports the role
module it tests, which triggers the registration. (Transitional: the bridge still holds a
small built-in map of co-located paths for the slices already cut, so `resolveRoleWord`
works standalone until every role self-registers.)

## The per-slice recipe (repeatable — this IS the pattern)

1. **`.word`** — write the slice's WORLD strand as prose, co-located in the module's dir.
   The CONTROL strand (if/foreach/mark/refuse/return/gate/match) is `.word`; the SESSION/
   HOST ops (search, verify, token, seat, crypto, transport) are `host:` escapes.
2. **host glue** — `<role>Host.js`: a thin adapter wiring the module's EXISTING primitives
   into `ctx.env.host` (call the same functions the JS handler calls — no reimplementation;
   only the orchestration glue, which is the strand the cut deletes). `callHost` invokes
   each as `fn({ args: [...] })`.
3. **register** — the role registers its `.word` via `registerRoleWord` (or the bridge's
   map during transition).
4. **shape gate** — assert the IR / dry-run facts match the JS handler's shape.
5. **live proof** — run the `.word` through the bridge LIVE with the real host env; assert
   the world strand + the return match the JS handler on the same input. ZERO stubs.
6. **cut** — wire the handler to PREFER the bridge, JS body as the CLEAN-MISS fallback
   (`_<op>ViaWordOrJs`: fall back only on not-converted / no-moment / a case the `.word`
   doesn't model / zero output; a `.word` run that lays facts then throws RETHROWS, never
   double-lays). **Behavior-PRESERVING** — a conversion never sneaks a security/semantic
   change (flag those separately, e.g. the connect timing oracle).
7. **verify the cut** — drive the REAL handler, assert IDENTICAL pre/post, run the e2e.
   Green = the world-sequencing JS is dead (delete it once the `.word` proves out broadly).

## Proven so far (the pattern works end to end)

- **cherub:birth** (subsequent registration) → `cherub.word`, cut + live (verify-cherub-cut
  9/9, verify-bridge-live 10/10). `.word` co-located at `roles/cherub/cherub.word`.
- **cherub:connect Mode-1** (credential) → `cherub-connect.word` flow 1, cut + live
  (verify-connect-cut 8/8, verify-connect-live 9/9).
- **cherub:connect owned** (flow 2) → live (verify-connect-flow2 6/6); host glue
  `connectHost.js` (searchByName/verifyPassword/generateToken/seatBranch/ownerTrueName +
  selectConnectFlow). flow 3 (inherit) in progress.

## The bulk (once the pattern is locked)

Walk `phase0-cutlist-result.md` (201 world / 379 host) role by role / op by op, applying
the recipe. Each lands as a co-located `.word` + its `*Host.js`, registered, cut, verified;
the JS world-strand deletes. The engine never grows per-slice (the §0–§11 caps are built);
new slices are `.word` + host glue + a cut, nothing more. When a role is fully `.word`, its
`role.js` is just registration + the host-escape glue + cognition — no world sequencing.

## Migration of the already-cut slices (housekeeping, coordinate)

The cherub `.word` + `connectHost.js` move from `present/word/` to `roles/cherub/` (done
for `cherub.word`; `cherub-connect.word` + `connectHost.js` move when flow 3 lands so the
parser lane is not disrupted mid-edit). The example `.word` (harmony/sun/commons/give/
being/space/matter/genesis) move to their homes as each is cut or as a batch when no one
is mid-edit.
