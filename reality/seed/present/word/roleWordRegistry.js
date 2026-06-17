// The bridge registry (host): (role, be-op) -> a parsed `.word` program.
//
// Where a BE op would dispatch to its JS role handler, the stamper first consults
// this registry; if a `.word` program is present it runs via the evaluator in
// LIVE mode with the moment's summonCtx, else it falls through to the JS handler
// (2.md Phase 4, the dual registry, preferring `.word`). This is the only new
// host code the conversion needs; the rest is deletion. See bridge.md.
//
// Standalone for now: built and validated here, wired into cherub's birthHandler
// and the world-sequencing JS deleted only once the diff gate is green.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse } from "./parser.js";
import { evaluate } from "./evaluator.js";

const k = (role, op) => `${role}:${op}`;

// (role, op) -> the `.word` file that replaces its JS handler.
const REGISTRY = new Map([
  [k("cherub", "birth"), "cherub.word"], // the first converted slice
]);

const irCache = new Map();
function wordOf(file) {
  if (!irCache.has(file)) {
    irCache.set(file, parse(readFileSync(new URL(`./${file}`, import.meta.url), "utf8")));
  }
  return irCache.get(file);
}

// Resolve a role's op to its `.word` IR, or null to fall through to the JS handler.
export function resolveRoleWord(role, op) {
  const file = REGISTRY.get(k(role, op));
  return file ? wordOf(file) : null;
}

// Run a resolved `.word` program LIVE in the moment. The summon payload (name,
// password) binds the flow; the program's acts emit into summonCtx.deltaF via the
// evaluator's live path (form-being -> the real birthBeing, the key-mint host).
// Returns the deltaF the program laid (the WORLD strand; token/session stay host).
export async function runRoleWord(ir, { summonCtx, identity, branch, name, password, env }) {
  const ctx = {
    dryRun: false, summonCtx, identity, branch,
    // default id-minter for `bind` sites (the home space): create-space honors
    // the target id (space/ops.js `targetIdOf(target)`), so a minted uuid becomes
    // the home's id and later acts (form-being's homeId, set-space's owner target)
    // reference it. A caller can override via env.mintId.
    env: { mintId: () => randomUUID(), ...env },
    deltaF: (summonCtx.deltaF ??= []),
    bindings: { name, password },
    trigger: { name, password },
    flows: [],
  };
  // The whole `.word` program is ONE op (e.g. the birth): keep `_inOp` set across
  // the run so its do-acts dispatch through doVerb as NESTED sub-ops and don't
  // each re-increment `_opCount` and trip sealAct's one-op-per-moment guard
  // (do.js L214-226). This mirrors the JS handler, which runs inside the birth op
  // where `_inOp` is already true. Preserve + restore so it composes whether
  // runRoleWord is called standalone (a harness) or from inside an op (the bridge
  // wired into birthHandler).
  const wasInOp = summonCtx._inOp;
  summonCtx._inOp = true;
  try {
    await evaluate(ir, ctx); // declarations register; the birth flow's effects run
  } finally {
    summonCtx._inOp = wasInOp;
  }
  return summonCtx.deltaF;
}

// Reconstruct the just-born being from the `be:birth` fact a `.word` birth laid,
// so the host SESSION strand (`generateToken` / `unlockSigning`) can read it
// without waiting for the projection fold. The cut in birthHandler uses this:
// run cherub.word via the bridge, then `bornBeingFrom(summonCtx.deltaF)` stands
// in for the being that `_registerHumanWithFreshHome` used to return.
export function bornBeingFrom(deltaF) {
  const f = (deltaF || []).find((x) => x.verb === "be" && x.action === "birth");
  if (!f) return null;
  const p = f.params || {};
  return {
    _id: f.target?.id ?? f.beingId,
    name: p.name,
    trueName: p.trueName,
    homeSpace: p.homeId ?? p.homeSpace ?? null,
  };
}
