// floorHostEnv.js — the SHARED floor of host predicates every .word runner can reach.
//
// connectHost.js (its peer) wires cherub-connect's SESSION ops (search / verify / token /
// seat). THIS file wires the four being-tree / lookup PREDICATES that a .word's `If …:` cond
// reads but that no per-op host env would otherwise supply — so a clause like
//
//   If <caller> has authority over <target>:
//
// resolves LIVE off the real being-tree instead of failing closed (cond.js's fail-closed
// default when ctx.env.host has no matching fn). ableWordRegistry's runners merge this UNDER
// any caller-supplied env.host (the per-op env wins on a name clash), so it is purely additive:
// a word that already wired `hasAuthorityOver` keeps its own; a word that didn't now gets the
// floor. It reimplements nothing — each adapter calls the SAME canonical function the JS gates
// call (hasAuthorityOver / isAncestorOf / hasCredentialAuthority / findBeingByName).
//
// THE TWO COND CONVENTIONS (cond.js §1) — an adapter must answer to BOTH, since the same
// predicate name can be reached as a gate's `resolvedBy` (spread args: `fn(a, b, ctx)`) OR as a
// `seeCall` / the evaluator's `callHost` (`fn({ args:[a,b] }, ctx)`). `_args` normalizes: a lone
// `{ args:[…] }` first param unwraps to the positional list; otherwise the spread params ARE the
// list (the trailing ctx, when present, is NOT a predicate arg). So one adapter serves every site.

import { hasAuthorityOver } from "../../../materials/being/identity/inheritation.js";
import {
  isAncestorOf,
  findBeingByName,
} from "../../../materials/being/identity/lookups.js";
import {
  hasCredentialAuthority,
  findBeingParent,
} from "../../../materials/being/identity/lineage.js";

// Resolve a history to read the tree on — NEVER the literal "0" (never-default-branch-zero). The
// adapters that hand history straight to a walk resolve it here; the lineage/credential shim
// self-resolves a falsy history, but the inheritation walk does not, so resolve it once.
async function _historyOf(explicit, ctx) {
  const h = explicit ?? ctx?.moment?.actorAct?.history ?? ctx?.history;
  if (h) return String(h);
  const { getDefaultHistory } =
    await import("../../../materials/history/historyRegistry.js");
  return await getDefaultHistory();
}

// Normalize the call shape to the positional arg list, for whichever cond convention reached us. EVERY
// caller appends the eval ctx as the LAST param (resolveCond: `fn(...args, ctx)`; callHost: `fn(p, ctx)`;
// gate resolvedBy: `fn(...args, ctx)`), so the ctx is always trailing and must be stripped before the
// args reach a fixed-arity predicate — otherwise the ctx OBJECT lands in a positional slot (e.g. an
// adapter's optional `history`, which then stringifies ctx to "[object Object]" and silently reads the
// wrong tree). `ctx` is passed in so we drop exactly it.
//   seeCall / callHost → ([{ args:[a,b] }, ctx])  → [a, b]   (the {args} object carries the list; drop ctx)
//   resolvedBy (gate)  → ([a, b, ctx])            → [a, b]   (spread positionals; drop the trailing ctx)
function _args(params, ctx) {
  const first = params[0];
  if (
    first &&
    typeof first === "object" &&
    !Array.isArray(first) &&
    Array.isArray(first.args)
  ) {
    return first.args; // the {args:[…]} form: the list is explicit; the trailing ctx is ignored
  }
  // the spread form: the LAST param is the appended ctx — drop it so it never binds a positional arg.
  return params[params.length - 1] === ctx ? params.slice(0, -1) : params;
}

// A being / Name reference may arrive as a row, a projection slot, a {beingId}/{nameId} object, or a
// bare id string. Pull the id (for the target/descendant side) or the Name (for the authority side).
const _id = (v) => String(v?._id ?? v?.beingId ?? v?.id ?? v ?? "");
const _name = (v) => String(v?.nameId ?? v?.trueName ?? v?.name ?? v ?? "");

export function floorHostEnv() {
  return {
    // hasAuthorityOver(subject, object[, history]) → does subject's NAME hold downward
    // being-tree authority over object? (inheritation.js: I / owner / inheritation-point.)
    // The .word surface `If <caller> has authority over <target>:` resolves to this.
    hasAuthorityOver: async (...params) => {
      const ctx = params[params.length - 1];
      const [subject, object, history] = _args(params, ctx);
      const h = await _historyOf(history, ctx);
      return await hasAuthorityOver(_name(subject), _id(object), h);
    },

    // isAncestorOf(ancestor, descendant[, history]) → being-tree descent (lookups.js). The
    // `see whether the caller is an ancestor of the candidate` predicate, reachable as a cond too.
    isAncestorOf: async (...params) => {
      const ctx = params[params.length - 1];
      const [ancestor, descendant, history] = _args(params, ctx);
      const h = await _historyOf(history, ctx);
      return await isAncestorOf(_id(ancestor), _id(descendant), h);
    },

    // hasCredentialAuthority(asker, target[, history]) → the credential-axis authority fold
    // (lineage.js): self/I short-circuit, else the asker's NAME owns the target or an ancestor /
    // holds a covering point. Self-resolves a falsy history, but resolve it here too for parity.
    hasCredentialAuthority: async (...params) => {
      const ctx = params[params.length - 1];
      const [asker, target, history] = _args(params, ctx);
      const h = await _historyOf(history, ctx);
      return await hasCredentialAuthority(_id(asker), _id(target), h);
    },

    // isBeingParentOf(caller, target) → is `caller` the IMMEDIATE being-parent of `target`?
    // ONE-HOP only: the parentBeingId on the target's be:birth fact (findBeingParent, a fold read —
    // NOT the live, reparent-driftable row field). NARROWER than hasAuthorityOver /
    // hasCredentialAuthority, which walk the WHOLE ancestry; credential-attach is being-parent-ONLY
    // ("only the being parent can re-attach", lineage.js), so its gate reads THIS, never the
    // any-depth authority walk (which would WIDEN it). The .word surface `If <caller> is the
    // being-parent of <target>:` resolves here, reusing the SAME findBeingParent the JS gate called.
    // findBeingParent is a global of.id fold (no history arg), so this takes none.
    isBeingParentOf: async (...params) => {
      const ctx = params[params.length - 1];
      const [caller, target] = _args(params, ctx);
      const parent = await findBeingParent(_id(target));
      return parent != null && String(parent) === _id(caller);
    },

    // findByName(name[, history]) → the canonical history-scoped being lookup (lookups.js
    // findBeingByName). Returns the doc-shaped row (or null), so `If find-by-name(name) exists:`
    // reads its presence and `find-by-name(name) as cand` binds the row.
    findByName: async (...params) => {
      const ctx = params[params.length - 1];
      const [name, history] = _args(params, ctx);
      const h = await _historyOf(history, ctx);
      return await findBeingByName(String(name ?? ""), h);
    },
  };
}
