# _template — canonical pack template

This folder is the template for a new pack. The leading underscore
makes the loader SKIP it, so the template never loads itself.

To start a new pack:

```bash
cp -r reality/resources/_template reality/resources/<your-pack-name>
```

Then walk through each piece and edit:

1. **`manifest.js`** — the pack manifest. Set `name`, `description`,
   and `requires` (one entry per piece your pack ships).

2. **`code/`** — ONE code piece. Edit `manifest.js`'s `name` and `pack`
   fields (both set to your pack's name). Edit `index.js` to register
   the DO ops, SEE ops, hooks, and cognition handlers your pack needs.
   If your pack has no substrate code, delete this folder.

3. **`roles/<each>/`** — MANY role pieces. Each subfolder is one role
   (the folder name becomes the bare role name). Rename
   `example-role/` to your role's name; same in the pack manifest's
   `requires`.

4. **`roleflows/<each>/`** — MANY roleflow pieces. Each is composition
   data for stacking roles per moment. If you don't need composition,
   delete this folder.

5. **`seeds/<each>/`** — MANY seed pieces. Each plants a structure
   (spaces / matter / beings) at a position. If your pack ships no
   plantable structure, delete this folder.

6. **`assets/<each>/`** — MANY asset bundles. Each ships bytes (models,
   sounds, data) served at `/assets/<pack>/<bundle>/*`. If your pack
   ships no bytes, delete this folder.

## What's optional

Only `manifest.js` (the pack manifest) is required. Drop any kind
folder you don't need.

## Naming convention

Names in piece manifests are LOCAL — bare, no colon. The loader
prefixes them with the pack's namespace at registration: a piece
`name: "drummer"` inside pack `harmony` registers as `harmony:drummer`.

The code piece's `name` is special: it's the SAME as the pack's name
(so scopedReality's auto-prefix rule writes ops/sees under the pack's
namespace). The pack and the code piece share their name; they live in
different registries (pack list vs extension list) so there's no
collision.

## Status

The role-kind and seed-kind handlers in the loader are built. The
roleflow-kind and asset-kind handlers are still pending — their
pieces are discovered (and logged as "pending kind handlers") but not
yet loaded. Adding them is bounded work; see
[RESOURCES.md](../RESOURCES.md) for the design.
