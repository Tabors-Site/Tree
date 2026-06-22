# MIRROR-WRITES: editing matter through the filesystem

> _"The shell becomes a matter editor."_

Sibling to [MIRROR.md](MIRROR.md), which lays out the doctrine for the
whole mirror arc. This doc is the practical user guide for what
landed in step 2: how to use the writable mount, what every command
becomes inside the kernel, what's safe, what isn't, and where to look
when you want to know what happened.

## What works

Anything that writes through the kernel's normal file IO becomes a
sealed fact on the I-Am's chain. Concretely:

| Command                             | What it produces                                                          |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `echo "x" > reality/mirror/foo`     | `do:create-matter` (new file matter, content in CAS)                      |
| `cat > reality/mirror/foo`          | Same, with the content from stdin                                         |
| `vim reality/mirror/foo` `:wq`      | Atomic rename-replace: `do:end-matter` + `do:rename-matter` in one moment |
| `nano`, `emacs`, VS Code save       | Same atomic rename-replace pattern                                        |
| `sed -i s/a/b/ file`                | Read CAS bytes, splice, `do:set-matter` with new content                  |
| `mv a b` (same dir)                 | `do:rename-matter`                                                        |
| `mv a/x b/x` (cross dir, same name) | `do:set-matter` field=spaceId                                             |
| `rm file`                           | `do:end-matter` (soft tombstone)                                          |
| `mkdir dir`                         | `do:create-matter` with type=folder                                       |
| `cp src dst`                        | Read from src, create dst as new matter (two acts)                        |
| `chmod`                             | Silent no-op (mode bits not yet modeled)                                  |

Anything that reads (`ls`, `cat`, `grep`, `find`, `node -e 'import(...)'`)
works exactly as it did in the read-only step 1. Reads stream bytes
from localStore CAS; no chain touched.

## The trip a single save takes

For `vim reality/mirror/notes.txt :wq`:

1. Vim writes a swap file, then `rename`s it over `notes.txt`.
2. FUSE upcalls land in the mount child process
   ([reality/scripts/mirror-mount.mjs](../../scripts/mirror-mount.mjs)).
3. The child packages each upcall as an IPC message with a
   correlation id and sends to the parent via `process.send`.
4. The parent ([reality/begin.js](../../begin.js) `dispatchMirrorOp`)
   receives the message and opens `withIAmAct("mirror:rename")`.
5. Inside that moment the parent calls `doVerb`:
   `do:end-matter` on the displaced row, then `do:rename-matter` on
   the source row. Both facts land in the same `deltaF`.
6. The act seals. The new bytes are already in CAS via `putContent`;
   the matter row's name updates through the fold.
7. The parent replies to the child with `{ ok: true }`.
8. The child returns 0 to the FUSE kernel layer; vim's save returns.

Reads after this point see the new bytes immediately because
`pushInvalidate` told the kernel to drop the path's cached inode.

## Authority (the load-bearing caveat)

Every act through the mirror is signed by **I-Am**, the kernel's
bootstrap actor. There is no per-user authority on the mount today.

The implication: anyone with filesystem access to `reality/mirror/`
on the host machine has full I-Am authority over the matter the
mount renders. For a developer's local box this is fine. For a
single-tenant server it's fine. For a multi-user host it is not.

The mount path is your authority boundary today. The IPC envelope
already carries `nameId: "i-am"`; the swap to a per-uid mount Name
(e.g. mapping the FUSE caller's uid to a Name and signing as them)
is a clean future change without disturbing this layer.

Don't expose `reality/mirror/` to untrusted users until per-uid Name
mapping lands.

## What every command becomes (verb dispatch)

The mount never bypasses the verb gate. Every successful filesystem
write goes through `doVerb` with the same authorization,
serialization, and audit path any other act takes. Specifically:

- **The chain CAS handles conflicts.** Two concurrent writes to the
  same matter race through the existing act-chain lock; the loser
  gets `EIO` and the caller (vim, sed) retries.
- **A failed seal is a real filesystem error.** Permission denied
  becomes `EACCES`, name collision becomes `EEXIST`, missing
  becomes `ENOENT`, conflict becomes `EIO`, disk full at the CAS
  layer becomes `ENOSPC`.
- **The Name primitive is honored.** Acts carry `nameId` so the
  Name-signing layer can do its work; today every act is signed by
  I-Am, but the field is in place.

## Audit trail

Every successful write is a sealed fact on the I-Am's chain. The
act's `sourceLabel` starts with `mirror:` so you can filter:

```
mirror:write        do:set-matter content
mirror:truncate     do:set-matter content
mirror:create       do:create-matter
mirror:unlink       do:end-matter
mirror:rename       do:end-matter + do:rename-matter (when replacing)
                    do:rename-matter (when not replacing)
mirror:rename-move  do:set-matter spaceId (cross-folder move)
mirror:mkdir        do:create-matter type=folder
```

To see mount-originated activity on the chain, query I-Am's
act-chain and filter `sourceLabel.startsWith("mirror:")`. Every
mount-driven act is recoverable, replayable, and federable like any
other.

## What doesn't work yet

- **Write batching.** Each vim save seals one fact. A noisy
  autosave scenario creates many small facts. Either the mount
  debounces (window-on-close) or the verb gains a "draft" mode that
  seals on flush. Decide when the second pattern appears.
- **Out-of-band invalidation.** If you edit a matter via the portal
  while the mount is open, the mount's path-tree is stale until the
  next mount restart. Wiring the mount's tree to subscribe to
  matter facts (innerFaceLive-style) closes this.
- **Cross-folder rename-replace.** Same-parent rename supports
  atomic replacement (vim's save pattern). Cross-folder rename to
  an existing destination returns `EXDEV`. A richer cross-folder
  move verb would close it.
- **chmod / chown / symlink / hardlink.** chmod is a silent no-op
  so `cp -p`, `install`, `git` don't fail spuriously. chown returns
  `ENOTSUP`. Symlinks and hardlinks return `ENOTSUP` (no link matter
  type yet).
- **rmdir.** Returns `ENOTSUP` until folder-matter has a
  children-empty assertion. Use `rm` on individual files; remove
  the folder matter via the portal for now.

## Example sessions

Create, edit, audit:

```sh
# create a new matter file
echo "hello world" > reality/mirror/scratch.txt
# chain now has a do:create-matter act for I-Am, sourceLabel "mirror:create"

# edit it in vim
vim reality/mirror/scratch.txt
# :wq triggers atomic rename-replace: one moment with end + rename

# rename in place
mv reality/mirror/scratch.txt reality/mirror/notes.txt
# do:rename-matter fact, sourceLabel "mirror:rename"

# bulk edit with sed
sed -i 's/hello/goodbye/' reality/mirror/notes.txt
# read CAS bytes, splice, do:set-matter content

# clean up
rm reality/mirror/notes.txt
# do:end-matter, soft tombstone; bytes stay in CAS until retention
```

Pipe shell tools through it:

```sh
# build a list of names from real data, write it as a file
ls -1 some-source-dir > reality/mirror/inventory.txt

# bulk replace across the mirror with find + sed
find reality/mirror -name "*.md" -exec sed -i 's/old/new/g' {} +
# each touched file: do:set-matter with new content; one moment per file

# copy a file in
cp ~/notes/important.txt reality/mirror/important.txt
# do:create-matter with content from the source file
```

Use any editor / IDE:

```sh
# open the mount as a project root in VS Code
code reality/mirror
# edit, save, the substrate sees the writes coming
# no TreeOS-specific extension required
```

## Files this lives in

- [reality/scripts/mirror-mount.mjs](../../scripts/mirror-mount.mjs):
  the FUSE child; handlers for write/truncate/create/unlink/rename/mkdir;
  the IPC client (pending Map, error code mapping).
- [reality/begin.js](../../begin.js) `dispatchMirrorOp`:
  the IPC server; opens `withIAmAct` and dispatches verbs.
- [reality/seed/materials/matter/ops.js](../../seed/materials/matter/ops.js)
  `renameMatterHandler`: the new `do:rename-matter` verb with the
  `allowReplace` opt-out for atomic rename-replace.
- [reality/seed/materials/reducerHelpers.js](../../seed/materials/reducerHelpers.js):
  `rename-matter` added to `SET_ACTIONS` so the reducer folds the
  name change through the existing `applySetField` path.
- [reality/seed/materials/matter/types.js](../../seed/materials/matter/types.js):
  `"rename-matter"` registered in the matter type's ops list.
- [reality/seed/ibp/verbs/do.js](../../seed/ibp/verbs/do.js):
  `SOURCE_READ_ONLY` retired for mount-routed paths so writes to
  source matter reach the dispatcher.

## For Claude (or any LLM agent working in this repo)

The mount is a natural surface for an agent that already speaks
"read files, write files." Treat it as the canonical edit channel
when the change you're making is meant to be a fact on the chain,
not just a code change.

### When to use the mirror vs the repo path

- **Use a repo path** (`reality/...` directly) for code changes
  that should land in git: refactors, bug fixes, new files in the
  Node module surface. These go through normal source control.
  Tabor commits them; the chain doesn't care.
- **Use the mirror** (`reality/mirror/...`) for changes you want
  recorded as substrate facts: matter content the kernel should
  perceive, scratch content beings should see, anything that should
  appear on the I-Am's act chain with `sourceLabel: "mirror:*"`.
  Same code, different audit trail.

Today most of what you edit while assisting Tabor is the first
kind. Reach for the mirror when the task itself is substrate-
shaped: authoring matter, testing the write path, demonstrating a
fact-on-chain effect, or showing a being's perception in real time.

### How to use it from a tool-use loop

Plain `Read` / `Write` / `Edit` on paths under
`reality/mirror/`. The path looks like any other path; the FUSE
layer hides everything. You can:

- `Read("reality/mirror/some/file.md")` to stream the bytes from
  CAS (no chain touched).
- `Edit("reality/mirror/some/file.md", old, new)` or
  `Write("reality/mirror/some/file.md", contents)` to land a
  `do:set-matter` fact under I-Am.
- `Bash("echo \"x\" > reality/mirror/scratch.txt")` to create a
  new file matter via shell.
- `Bash("find reality/mirror -name '*.md'")` to walk the mounted
  tree exactly like a normal repo.

If a write fails, the errno will surface as the tool error message:
`EACCES` (auth denied), `EEXIST` (name collision), `EIO` (chain
conflict, retry), `ENOSPC` (CAS write failed), `EXDEV` (cross-folder
rename-replace, deferred), `ENOTSUP` (chmod / chown / symlink).

### Why prefer the mirror when the task fits

- **Audit trail.** Every change you make is a sealed fact you can
  point at later. `git log` shows code; the act chain shows acts.
  When you're demonstrating something substrate-shaped, the act
  chain is the artifact, not the diff.
- **Composability.** Shell pipelines, find / sed / awk all work.
  Bulk transformations land as one fact per file.
- **Honest surface.** You don't reach into the substrate through a
  bespoke API; you use the same filesystem the kernel uses. Same
  trip a human user's `vim` takes.

### Caveats to remember

- **Everything signs as I-Am.** There's no per-uid mount Name yet.
  Any change you land through the mirror appears on I-Am's chain
  with full kernel authority. That's a powerful tool; use it for
  changes I-Am should own. Don't pretend it's a user's act.
- **Source matter has a drift seam.** Today source.js walks the
  repo at boot and reconciles matter rows from disk. If you edit
  source matter through the mirror, the matter row updates but the
  underlying disk file at the same path does NOT (the write only
  updates the matter row's content hash). The next source.js walk
  will detect drift and may overwrite. Until step 4 of the staged
  path retires `source.js`, prefer the mirror for matter NOT under
  `mirror/source/...`. For repo file changes, use the repo path.
- **The mount has to be running.** The mount auto-spawns at boot
  (per `begin.js`). If the reality isn't running, `reality/mirror/`
  is just an empty directory and writes fail with whatever local
  filesystem error you'd expect.
- **Don't expose the mount to untrusted users.** Until per-uid
  Name mapping lands, anyone with FS access to the mount path has
  full I-Am authority over rendered matter. Local-dev box is fine;
  multi-user host is not.

### Quick decision rule

Ask: "is the change I'm about to make supposed to appear on a
being's act chain?" If yes, use the mirror. If no (you're modifying
code that runs the reality), use the repo path. Most tasks are the
second; the few that aren't are usually obvious from context (Tabor
asks you to test a write path, demonstrate a perception, plant
content for a being to see).

## See also

- [MIRROR.md](MIRROR.md): the doctrine for the whole mirror arc
  (read, write, invalidation, source-retirement, resource mounting,
  on-demand matter mounting). This file is the practical companion.
- [../names/innerFace.md](../names/innerFace.md): how the kernel
  perceives the world. The mirror is the inverse side: how
  filesystem actions shape what the kernel perceives next.

Now Tabor's question: yes, with one wrinkle that matters.

The fact chain DOES update live. That's what step 2 just wired. Edit any matter through reality/mirror/..., the kernel signs an act under I-Am, the fact lands on the chain, the matter row reflects the new content hash, anything subscribing (innerFaceLive humans on a stance whose weave includes that reel) wakes up and refolds. The whole substrate machinery flows. That's already true today for any matter you edit through the mount.

The wrinkle: kernel code runs from what Node imported at boot, not from the chain. If you edit reality/seed/foo.js through the mirror today, the matter row's content hash changes, the fact is on the chain, but the live Node process still executes the bytes it imported at startup. The kernel doesn't know its own source moved. A restart picks up the new bytes; until then the fact chain says "current code is X" while the running process is still at "Y."

So the distinction:

Content matter (docs, scratch files, configs, beings' authored data): updates are live in every sense. Edit, fold, perceive. Done.
Code matter (kernel modules, able handlers, see-op handlers): the byte change is live in the chain but the running interpreter is stale until reload.
Closing that gap is the "hot OS" payoff. The pieces: a Node loader hook that resolves treeos://hash/<sha> to bytes streamed from CAS, plus a fact-arrival subscription on the able/code matter that triggers import.meta invalidation when the matter content hash changes. The kernel would then perceive its own source change (via the same dep-set / weave subscription humans use), reload the affected modules, and proceed with new code. Smalltalk / Emacs / Lisp Machine style: the running system reads its own source from the chain and edits land live.

The deepest version is what level-3 TreeOS becomes: the kernel IS the substrate, edits to any matter (including the kernel's own modules) take effect immediately because there's no separate "compiled binary" layer in front of the chain. The OS is what the chain says it is, right now, no restart between the edit and the effect.

Today: step 2 puts you halfway there. The chain updates live. The code execution lags. The remaining step is module hot-reload + Node loader integration, which the mirror has made plausible (bytes by hash via CAS; subscribe via the weave; reload on invalidation).

So yes, theoretically and partially already, a being could edit the running OS through vim reality/mirror/seed/... and have everything (chain, matter rows, projections) reflect it immediately. The last gap is making the JavaScript runtime perceive its own change. That's the next interesting build.

reference_mirror_writes_guide.md
