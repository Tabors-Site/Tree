// coders extension entry point.
//
// Registers four typed coder roles (coder-build, coder-refine,
// coder-review, coder-integrate), binds them as the workspace-
// specialized worker variants for the "coders" workspace, and ships
// three filesystem-matter tools (coders-read-file, coders-list-files,
// coders-write-file) the coders use to read and write code at scope.
//
// When the Foreman dispatches a leaf at a coder-rulership scope, it
// looks up the workerType through governing's workspace-worker
// registry, finds the coder role for that type, and summons the
// matching coder being (created lazily by ensureWorkerBeing). The
// coder reads / writes files through the registered tools; paths are
// resolved against metadata.coders.projectPath on the rulership.
//
// The `coder:governing-coder` seed plants the governance quartet at
// the target node and tags the workspace; coder beings materialize
// lazily on first dispatch.

import log from "../../seed/system/log.js";
import { registerRole } from "../../seed/being/roles/registry.js";
import { registerWorkspaceWorkerTypes } from "../governing/state/workerTypeRegistry.js";
import { allCoderRoles } from "./roles/coderRole.js";
import getCodersTools from "./tools.js";

export async function init(_core) {
  // Register the four typed coder roles globally so the role registry
  // (and the .roles substrate mirror) lists them.
  for (const { spec, role } of allCoderRoles) {
    registerRole(spec.name, role, "coders");
  }

  // Bind the coders workspace to the typed roles. The Foreman calls
  // governing's lookupWorkerRole(workerType, { preferWorkspace }) when
  // dispatching a leaf; with this registration, "build" → "coder-build",
  // "refine" → "coder-refine", etc.
  registerWorkspaceWorkerTypes("coders", {
    build:     { roleName: "coder-build" },
    refine:    { roleName: "coder-refine" },
    review:    { roleName: "coder-review" },
    integrate: { roleName: "coder-integrate" },
    // Decomposition hints the Planner reads when shaping a plan for
    // a coders-rulership. Free-text guidance, not enforcement.
    _decompositionHints: {
      defaultShape: "mixed-leaf-and-branch",
      branchWhen:
        "the work splits across independent sub-domains that warrant their own sub-Rulers " +
        "(e.g. frontend + backend + state in separate directories).",
      leafWhen:
        "a single file or a tight cluster of files in one directory implements the spec.",
      integrateWhen:
        "two or more sub-Rulers ran below and produced their files; an integration leaf " +
        "binds them at the top level (package.json, README, top-level entry point).",
      antiPatterns: [
        "build a 'utilities' branch with no clear sub-domain",
        "split one logical file across two leaves",
        "spawn integrate work before the siblings have emitted",
      ],
      example:
        "for 'build a vowel counter CLI': single leaf, one file, type=build. " +
        "for 'build a polypong game': branches { engine, ui, state }, each a sub-Ruler, " +
        "plus an integrate leaf at the project root for package.json and index.html.",
    },
  });

  const tools = getCodersTools(_core);

  log.info("Coders",
    "registered 4 coder roles (build/refine/review/integrate), " +
    "bound as 'coders' workspace specializations, " +
    `${tools.length} tools, 1 seed (coder:governing-coder)`);

  return {
    tools,
    exports: {
      allCoderRoles,
    },
  };
}
