import { z } from "zod";
import { defineStrategy, applies } from "../code-workspace/sdk.js";
import { myThingSkeleton, verifyMyThing } from "./lib.js";

// ---------------------------------------------------------------------------
// Context — explanatory prose the agent reads when this strategy is in play.
//
// Keep it short and educational, not prescriptive. Teach what the domain is,
// name the gotchas, list the wrapper functions. Don't list rules of bad code.
// The wrappers prevent the bad code; the context teaches the idea.
// ---------------------------------------------------------------------------

const CONTEXT_BLOCK = `<one-paragraph explanation of the domain, what it covers, and any
land-specific constraints (ports, proxy behavior, path conventions).>

<one paragraph listing the wrapper functions and what each does at the
level of signature + one line. Do NOT describe their implementation —
the agent does not need to know how they work.>

  my-domain-create({ name, options }) — emit <thing>.
  my-domain-verify() — check <invariant>.

<optional: a SCOPE paragraph telling the agent what the wrappers do
NOT cover, so it still plans appropriately for the rest of the app.>`;

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

// ---------------------------------------------------------------------------
// Strategy definition.
//
// defineStrategy takes:
//   - name:        short identifier for the registry
//   - contextBlock: the explanatory prose above
//   - appliesWhen:  a predicate over ctx. Use the `applies.*` combinators to
//                   avoid hand-writing contract/spec walks.
//   - tools:       an array of MCP tool definitions. Each handler receives
//                   four pre-bound helpers — all branch-rooted so a
//                   strategy cannot escape its worker's sandbox:
//                     writeFile(path, content)
//                     readFile(path)
//                     readWorkspaceFiles()
//                     ensureDeps({ pkgName: versionRange })
//                       → merges into the branch's package.json so
//                         the spawner's npm install runs them before
//                         the next preview boot.
//
// Return value's .toInit() registers the context and returns the
// { tools, modeTools } the loader expects from an extension's init().
// ---------------------------------------------------------------------------

const strategy = defineStrategy({
  name: "my-domain",

  contextBlock: CONTEXT_BLOCK,

  // Fire only when the domain is actually relevant. Examples:
  //   applies.contractKind(/graphql|schema/)  — kind field on any contract
  //   applies.routeContract()                 — { method, path } contract shape
  //   applies.messageContract()               — { kind:"message", values:{type} }
  //   applies.specMatches(/react|jsx/i)       — regex over request/spec text
  //   applies.always() / applies.never()      — unconditional / disabled
  //   applies.any(...)  applies.all(...)      — combine
  appliesWhen: applies.any(
    applies.specMatches(/\b(your|domain|keywords)\b/i),
    // applies.contractKind(/your-kind/),
  ),

  tools: [
    {
      name: "my-domain-create",
      description:
        "One-line description of what this tool emits. Say it's a COMPLETE " +
        "output, not a template, so the agent doesn't try to edit it.",
      schema: {
        name: z.string().describe("Name for the thing."),
        options: z.record(z.any()).optional().describe("Domain-specific options."),
        filePath: z.string().optional().describe("Target filename. Defaults below."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false },
      async handler({ writeFile, ensureDeps, name, options, filePath }) {
        // If your emitted code requires npm packages, declare them here
        // BEFORE writeFile. The spawner's npm install will pick them up.
        //   await ensureDeps({ "some-package": "^1.0.0" });
        const content = myThingSkeleton({ name, options });
        const result = await writeFile((filePath && filePath.trim()) || `${name}.js`, content);
        if (!result.ok) return text(`my-domain-create rejected: ${result.error}`);
        return text(
          `${result.created ? "Created" : "Updated"} ${result.filePath} — my-domain ${name}.`
        );
      },
    },
    {
      name: "my-domain-verify",
      description: "One-line description of what this tool checks.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ readWorkspaceFiles }) {
        const files = await readWorkspaceFiles();
        if (files.length === 0) return text("my-domain-verify: no files in active project");
        const result = verifyMyThing(files);
        if (result.ok) return text("PASS — my-domain invariants hold.");
        return text(["FAIL — my-domain issues:", ...result.issues.map((i) => "  " + i)].join("\n"));
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Extension init — two lines.
// ---------------------------------------------------------------------------

export async function init() {
  return strategy.toInit();
}
