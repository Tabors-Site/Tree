// tree:governing-worker-build
//
// Build is the default Worker type. It brings something new into
// existence at this scope. Most leaf steps in a fresh plan are
// builds: create a file, write a function, write a chapter, draft
// a configuration. The reference shape every other Worker type
// departs from.
//
// The Build Worker's judgment surface is "what does the spec
// imply needs to exist, and what's the smallest correct thing
// that satisfies it?" — not "what would be nice to have" and not
// "what's the broadest interpretation."
//
// Workspaces can register their own typed Build worker via
// manifest.provides.workerTypes.build. When they do, the dispatcher
// routes Build leaf steps to the workspace's specialized mode
// instead of this base. The workspace mode should call
// buildWorkerPrompt with its own type-body to keep the shared
// turn-rules / contracts / undershoot scaffold consistent.

import { buildWorkerPrompt, WORKER_BASE_CONFIG } from "./workerBase.js";

const BUILD_BODY = `WHAT BUILD MEANS

Build is the act of bringing something new into existence at this
scope. The spec describes what doesn't yet exist; your job is to
make it exist correctly the first time.

Rules of Build:

  • The spec is the contract. Realize EXACTLY what it asks for, no
    more. If the spec says "write a vowel counter," write a vowel
    counter — don't also add a consonant counter, don't add a CLI
    flag the spec didn't ask for, don't scaffold a test suite the
    plan didn't include.

  • Smallest correct thing first. New code starts from the minimum
    that satisfies the spec. Adornment, configurability, and
    extension points are for Refine to add later when actual
    requirements force them.

  • Use the contracts in force. If your Ruler ratified an event
    name, a storage key, or a function signature, use that name
    verbatim. Inventing parallel vocabulary is forbidden; surface
    a missing contract instead.

  • One file per leaf. The spec → one artifact. Cross-cutting work
    that needs two artifacts to be coherent is two leaves, not one.

  • Don't pre-build for the future. A Build that adds five
    "for-later" hooks the spec didn't ask for is wrong. Land the
    spec; let Refine add the hooks if and when they're needed.`;

export default {
  ...WORKER_BASE_CONFIG,
  name: "tree:governing-worker-build",
  emoji: "🔨",
  label: "Build Worker",

  buildSystemPrompt(ctx) {
    return buildWorkerPrompt(ctx, {
      typeLabel: "Build Worker",
      body: BUILD_BODY,
    });
  },
};
