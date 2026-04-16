/**
 * Contract conformance validator.
 *
 * Runs after runBranchSwarm completes and the architect declared
 * contracts at the top of its response. Cross-checks actual code in
 * each branch against the declared contracts and produces violations
 * when the code deviates.
 *
 * Built on top of wsSeam.js's extractors — we reuse its protocol
 * harvesting (sends, handles, field reads) and re-interpret the
 * results in contract-land instead of comparing client-to-server.
 *
 * Violations checked:
 *
 *   1. undeclared-send-type: a branch sends a message whose `type`
 *      doesn't match any declared message contract
 *
 *   2. undeclared-handle-type: a branch has a case '<type>' in its
 *      onmessage switch where '<type>' isn't a declared message
 *
 *   3. unknown-payload-field: a branch's send object includes a field
 *      name the declared message doesn't list
 *
 *   4. unknown-field-read: a frontend reads data.X in a case handler
 *      for a declared message, but the contract doesn't list X as a
 *      field of that message
 *
 * Each violation lands as a CONTRACT_MISMATCH signal on the offending
 * branch's signalInbox with the declared shape alongside the
 * offending code so the branch's next retry has everything it needs
 * to fix the deviation.
 */

import path from "path";
import log from "../../../seed/log.js";
// Reuse wsSeam's extractors rather than re-inventing them. They
// already handle file walking, comment stripping, test-file
// exclusion, and the send/handle/field-read extraction we need.
import {
  walkSourceFilesForSeam,
  extractBranchProtocolSurface,
} from "./wsSeam.js";

/**
 * Main entry. Called from swarm.js after all branches succeed.
 *
 *   checkContractConformance({ workspaceRoot, branches, contracts })
 *     → { ok: true }
 *     → { ok: true, skipped: true, reason: '...' }
 *     → { ok: false, violations: [...] }
 *
 * `branches` is [{ name, path, status }] from swarm results.
 * `contracts` is the declared contracts list from the project root
 *    metadata: [{ kind: 'message'|'type', name, fields: [] }, ...]
 */
export async function checkContractConformance({ workspaceRoot, branches, contracts }) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    return { ok: true, skipped: true, reason: "no workspaceRoot" };
  }
  if (!Array.isArray(branches) || branches.length === 0) {
    return { ok: true, skipped: true, reason: "no branches" };
  }
  if (!Array.isArray(contracts) || contracts.length === 0) {
    return { ok: true, skipped: true, reason: "no declared contracts" };
  }

  // Build quick-lookup indexes from the declared contracts.
  const declaredMessages = new Map(); // name → Set<fieldName>
  const declaredTypes = new Map(); // name → Set<fieldName>
  for (const c of contracts) {
    const fields = new Set(c.fields || []);
    if (c.kind === "message") declaredMessages.set(c.name, fields);
    else if (c.kind === "type") declaredTypes.set(c.name, fields);
  }

  if (declaredMessages.size === 0) {
    // Contracts exist but none are messages — nothing wire-level to
    // check. (Types alone are informational shapes, not wire
    // protocol.) Pass through.
    return { ok: true, skipped: true, reason: "no message contracts declared" };
  }

  const violations = [];

  for (const b of branches) {
    if (b.status !== "done") continue;
    if (!b.path) continue;
    const branchDir = path.join(workspaceRoot, b.path);

    // Extract this branch's protocol surface: sends, handles, and
    // field reads. wsSeam exposes a helper for this — we added it
    // alongside the main smokeWsSeam entry so contractConformance
    // can reuse the same code path without duplicating extractors.
    const files = walkSourceFilesForSeam(branchDir);
    if (files.length === 0) continue;

    const surface = extractBranchProtocolSurface(files, branchDir, b.name);

    // Check 1: sends with undeclared types
    for (const send of surface.sends) {
      if (!declaredMessages.has(send.type)) {
        violations.push({
          kind: "undeclared-send-type",
          branch: b.name,
          type: send.type,
          file: send.file,
          line: send.line,
          declaredTypes: [...declaredMessages.keys()],
          evidence: { fields: [...send.fields] },
          message:
            `Branch "${b.name}" sends { type: '${send.type}' } at ${send.file}:${send.line}, ` +
            `but the declared contracts don't include a message named '${send.type}'. ` +
            `Declared message types: ${[...declaredMessages.keys()].join(", ")}. ` +
            `Rename this send to match a declared type, or emit [[NO-WRITE: contracts need <type> ` +
            `for <purpose>]] to ask the operator to extend the contracts.`,
        });
      } else {
        // Check 3: declared type, undeclared fields in payload
        const declaredFields = declaredMessages.get(send.type);
        if (declaredFields.size > 0) {
          for (const field of send.fields) {
            if (!declaredFields.has(field)) {
              violations.push({
                kind: "unknown-payload-field",
                branch: b.name,
                type: send.type,
                field,
                file: send.file,
                line: send.line,
                declaredFields: [...declaredFields],
                evidence: { sentFields: [...send.fields] },
                message:
                  `Branch "${b.name}" sends { type: '${send.type}' } at ${send.file}:${send.line} ` +
                  `with a field "${field}" that isn't in the declared message contract. ` +
                  `Contract fields: ${[...declaredFields].join(", ")}. ` +
                  `Rename "${field}" to one of the declared fields or drop it from the payload.`,
              });
            }
          }
        }
      }
    }

    // Check 2: `case 'X':` for an undeclared X
    for (const handled of surface.handles) {
      if (!declaredMessages.has(handled)) {
        // It's possible a case handles something outside the declared
        // message space — e.g. an internal-only handshake. Flag it
        // as a warning-level violation but don't fail the branch if
        // it's the ONLY violation — we want to avoid false positives
        // on internal helper cases. For now we include it in
        // violations but callers can relax later.
        violations.push({
          kind: "undeclared-handle-type",
          branch: b.name,
          type: handled,
          declaredTypes: [...declaredMessages.keys()],
          evidence: {},
          message:
            `Branch "${b.name}" has a case '${handled}' in its onmessage switch, ` +
            `but '${handled}' isn't a declared message type. ` +
            `Either rename the case to match a declared type, or remove it. ` +
            `If this message is an internal-only convention, add it to the architect's ` +
            `contracts first.`,
        });
      }
    }

    // Check 4: `data.X` reads inside a case handler where the declared
    // message doesn't list X
    for (const read of surface.fieldReads) {
      const declared = declaredMessages.get(read.type);
      if (!declared) continue; // type mismatch caught above
      if (declared.size === 0) continue; // no field constraints
      if (!declared.has(read.field)) {
        violations.push({
          kind: "unknown-field-read",
          branch: b.name,
          type: read.type,
          field: read.field,
          file: read.file,
          line: read.line,
          declaredFields: [...declared],
          evidence: {},
          message:
            `Branch "${b.name}" reads data.${read.field} in its handler for '${read.type}' ` +
            `at ${read.file}:${read.line}, but the contract for '${read.type}' declares ` +
            `fields ${[...declared].join(", ")}. ` +
            `Rename data.${read.field} to a declared field, or ask the operator to add ` +
            `"${read.field}" to the contract.`,
        });
      }
    }
  }

  if (violations.length === 0) {
    log.info(
      "CodeWorkspace",
      `Contract conformance: all branches match the ${declaredMessages.size} declared message contract(s)`,
    );
    return { ok: true, checkedMessages: declaredMessages.size };
  }

  log.warn(
    "CodeWorkspace",
    `📜 Contract conformance: ${violations.length} violation(s) across branches`,
  );
  return { ok: false, violations };
}
