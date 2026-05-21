/**
 * Private helpers for your strategy. Skeletons, codegen, transformers,
 * verifiers — anything the tool wrappers in index.js need. This file
 * is internal: nothing imports from here outside your own extension.
 *
 * The tool wrappers stay thin; the hard code lives here.
 */

// Example: a skeleton template the wrapper will emit.
// Replace this with whatever your domain produces.
export function myThingSkeleton({ name, options = {} }) {
  return `// Generated ${name}\n// Options: ${JSON.stringify(options)}\n\nexport default function ${name}() {\n  // TODO: real logic\n}\n`;
}

// Example: a quick verifier that scans workspace files for coherence.
// Return { ok, issues: [] } shape so the wrapper in index.js can format it.
export function verifyMyThing(files) {
  const issues = [];
  // ... walk `files` and spot mismatches ...
  return { ok: issues.length === 0, issues };
}
