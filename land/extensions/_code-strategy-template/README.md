# code-strategy template

Copy-ready scaffold for a new coding-domain strategy. Starts as a minimal
but working package; edit to your domain and ship.

## Start

```
cp -r land/extensions/_code-strategy-template land/extensions/code-strategy-mydomain
```

Then edit these four files in order:

1. **`manifest.js`** — rename to `code-strategy-mydomain`, update `description`.
2. **`lib.js`** — write your private helpers here: skeleton generators,
   codegen, transformers, verifiers. Anything the tool wrappers in
   `index.js` need. This file is internal to your extension; nothing
   outside your folder imports from it.
3. **`index.js`** — edit the `CONTEXT_BLOCK`, the `appliesWhen` predicate,
   and the `tools` array. The predicate decides when the context + tools
   are injected into `tree:code-plan`'s prompt; the tools are the wrapper
   functions the agent calls.
4. **Ship it.** The loader picks it up on next boot. Enable at a test
   tree root with `ext-allow code-strategy-mydomain` and try it.

## Anatomy

```
code-strategy-mydomain/
├── manifest.js   # standard TreeOS extension manifest
├── index.js      # defineStrategy() call + context + tool wrappers
├── lib.js        # your private helpers (skeletons, verifiers)
└── (add your own files as needed — templates/, parsers/, etc.)
```

## What `defineStrategy` gives you

- Automatic registration of the context block with `code-workspace`
- Automatic injection of your tools into `tree:code-plan` and `tree:code-log`
- Pre-bound helpers inside every tool handler. All three are branch-rooted,
  so a strategy cannot escape its worker's sandbox:
  - `writeFile(filePath, content)` — branch-aware single-file write,
    returns `{ ok, filePath, created, error }`
  - `readFile(filePath)` — branch-aware single-file read,
    returns `{ ok, filePath, content, error }`. `content` is `null` if
    the file does not exist.
  - `readWorkspaceFiles()` — returns `[{ filePath, content }]` for the
    active project, so verify tools can scan without re-implementing
    project lookup.
  - `ensureDeps({ pkgName: versionRange })` — merges npm deps into the
    branch's `package.json`. Call this BEFORE `writeFile` so the dep
    lands before the emitted file that requires it. The preview spawner
    auto-runs `npm install` whenever package.json changes.

You do NOT need to call `getExtension("code-workspace")` yourself.

## `applies.*` predicate helpers

Combine these in `appliesWhen` so the strategy fires only when relevant:

- `applies.contractKind(/pattern/)` — matches `kind` on declared contracts
- `applies.messageContract()` — matches WebSocket-style wire messages
- `applies.routeContract()` — matches HTTP route contracts
- `applies.specMatches(/pattern/)` — matches the user request / project spec text
- `applies.any(...)` / `applies.all(...)` — compose
- `applies.always()` / `applies.never()` — unconditional / disabled

## Conventions

- **Output is complete, not a template.** No TODO markers in emitted
  files. The agent will try to "fill them in" and corrupt the skeleton.
- **Wrapper return text tells the agent what was covered** and suggests
  checking off any related plan steps. This prevents the "7-step plan
  for a 1-call task" loop.
- **Keep context short.** One or two paragraphs. The point of strategies
  is to shrink the prompt — long context blocks defeat that.
- **Wrapper functions take high-level intent parameters** (messageTypes,
  routes, componentName) — not raw file paths. The wrapper picks the
  filename; the agent only cares about the domain input.
