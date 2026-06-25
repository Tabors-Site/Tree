// resolveCond + getPath — the Word's shared condition resolver (8.md §1 + the
// Engine answers). `if`, `gate`, and `law` all funnel through resolveCond: one
// resolution surface, three control-flow framings.
//
// THE SPLIT (8.md §1): the parser lifts STRUCTURE — connectives (all/any), negation,
// and, for a recognized predicate skeleton, a `test:{op,path,against|value}` triple or
// a `resolvedBy:<host>` delegation. This module resolves MEANING — what a dotted path
// points at, whether a comparison/existence holds, whether a host predicate is true,
// or whether a flow-local flag is set. It never re-tokenizes the clause (that would be
// parsing). The clause string rides along as a gloss; it is not interpreted here.
//
// Standalone so it can be unit-tested with hand-built conds (no DB, no parser), the
// "evaluator first, then parser" methodology (1.md). The evaluator imports
// `resolveCond`; `getPath` also extends reference resolution for §6 binds.

// Domain id equality — the JS handlers compare ids as `String(a) === String(b)`
// (e.g. cherub connectHandler's `String(candidateFather.beingId) === String(identity
// .beingId)`). Match that exactly so a `.word` equality reproduces the JS branch.
export function idEquals(a, b) {
  return String(a ?? "") === String(b ?? "");
}

// Walk a dotted accessor over the flow's readable state. The path's HEAD names a
// binding (the §0 trigger binds, §6 binds, flow-local marks) or a state key or a
// proper-name being; the tail descends plain object fields (qualities.father.story).
// Returns undefined for a missing head or a broken descent — never throws.
export function getPath(path, ctx) {
  if (path == null) return undefined;
  const segs = String(path).split(".");
  const head = segs[0];
  let cur =
    ctx?.bindings?.[head] !== undefined ? ctx.bindings[head]
    : ctx?.state?.[head] !== undefined ? ctx.state[head]
    : (ctx?.beings && Object.prototype.hasOwnProperty.call(ctx.beings, head)) ? ctx.beings[head]
    : undefined;
  for (let i = 1; i < segs.length && cur != null; i++) cur = cur[segs[i]];
  return cur;
}

// An operand in a `test` is either a literal or a reference. `{ ref:"a.b" }` reads a
// path; a bare `$name` string reads a binding (mirrors the evaluator's resolveValue);
// anything else is a literal.
function resolveOperand(v, ctx) {
  if (v && typeof v === "object" && v.ref != null) return getPath(v.ref, ctx);
  if (typeof v === "string" && v.startsWith("$")) return getPath(v.slice(1), ctx);
  return v;
}

// A recognized predicate skeleton the parser lifted. The path reads the left operand;
// the op decides the comparison. `equals` is id-equality (the pervasive case);
// `reads`/`holds` are existence/truthiness of a read; `in` is membership; the numeric
// `compare` carries an `as` of lt|le|gt|ge|eq for ordered values.
function resolveTest(test, ctx) {
  const left = getPath(test.path, ctx);
  switch (test.op) {
    case "equals": {
      const right = resolveOperand(test.against !== undefined ? test.against : test.value, ctx);
      return idEquals(left, right);
    }
    case "reads":
    case "holds":
      return left !== undefined && left !== null && left !== false;
    // TYPE primitives (parser §1 type predicates): the host floor's typeof / Number.isFinite,
    // named as native Word tests so a `.word` checks a value's shape with no bespoke host fn.
    // `isFinite` is the "is a [finite] number" gate (NaN/Infinity/non-number all read false);
    // `isString` is the "is a string / is text" gate.
    case "isFinite":
      return Number.isFinite(left);
    case "isString":
      return typeof left === "string";
    case "in": {
      const coll = resolveOperand(test.against !== undefined ? test.against : test.value, ctx);
      return Array.isArray(coll) ? coll.some((x) => idEquals(x, left)) : false;
    }
    case "compare": {
      const right = resolveOperand(test.against !== undefined ? test.against : test.value, ctx);
      const l = Number(left), r = Number(right);
      switch (test.as) {
        case "lt": return l < r;
        case "le": return l <= r;
        case "gt": return l > r;
        case "ge": return l >= r;
        default:   return l === r;
      }
    }
    default:
      return left !== undefined;
  }
}

// Resolve a condition to a boolean. The leaf modes (8.md Engine answers):
//   all/any      → recurse AND / OR
//   test         → a parser-lifted skeleton, resolved here
//   resolvedBy   → a domain predicate (host builtin, spread args), via ctx.env.host
//   seeCall      → an inline see-op call (host builtin, `{ args }` object), via ctx.env.host
//   flag         → a flow-local boolean the parser named via inferFlag (§5/Q4)
// `negated` flips the leaf last (XOR), distinct from negation on an act (§10).
export async function resolveCond(cond, ctx) {
  if (!cond) return false;
  if (Array.isArray(cond.all)) {
    for (const c of cond.all) if (!(await resolveCond(c, ctx))) return false;
    return true;
  }
  if (Array.isArray(cond.any)) {
    for (const c of cond.any) if (await resolveCond(c, ctx)) return true;
    return false;
  }
  let v;
  if (cond.test) {
    v = resolveTest(cond.test, ctx);
  } else if (cond.resolvedBy) {
    // a domain predicate (hasAuthorityOver, isAncestorOf, findByName-exists, …): the
    // SAME host registry the §6 `host` node and the evaluator's callHost use.
    const fn = ctx?.env?.host?.[cond.resolvedBy];
    const args = Array.isArray(cond.args) ? cond.args.map((a) => resolveOperand(a, ctx)) : [];
    v = fn ? !!(await fn(...args, ctx)) : false;
  } else if (cond.seeCall) {
    // an inline SEE-OP call as a predicate (the as-removal): `If destination-missing(history)`.
    // Dispatches through ctx.env.host EXACTLY as the evaluator's callHost runs `see <op>(args)
    // as v` — the op takes a single `{ args }` object (the see-op convention, NOT resolvedBy's
    // spread), lays no fact, and its truthiness IS the condition. Fail-closed when unregistered.
    const fn = ctx?.env?.host?.[cond.seeCall];
    const args = Array.isArray(cond.args) ? cond.args.map((a) => resolveOperand(a, ctx)) : [];
    v = fn ? !!(await fn({ args }, ctx)) : false;
  } else if (cond.flag != null) {
    // a bare flag: a §5 boolean mark, OR a bound value the prose reads as present/absent
    // ("if no candidates", "if no target"). Truthy iff present AND non-empty, so an empty
    // array/string reads as absent (plain `!!` makes `[]` truthy, which `if no X` must not).
    const f = getPath(cond.flag, ctx);
    v = Array.isArray(f) ? f.length > 0 : (typeof f === "string" ? f.length > 0 : !!f);
  } else if (typeof cond.clause === "string" && cond.clause.startsWith("$")) {
    // a clause lifted as a bare $-binding ref (`If $conn.isFirst`): a boolean binding read.
    // Resolve via getPath (dotted-aware, strips the `$`, mirrors the evaluator's resolveValue);
    // its truthiness IS the condition (empty array/string reads absent, like a flag). A genuine
    // unrecognized clause (no `$`) still falls to fail-closed below.
    const got = getPath(cond.clause.slice(1), ctx);
    v = Array.isArray(got) ? got.length > 0 : (typeof got === "string" ? got.length > 0 : !!got);
  } else {
    // a clause with no lifted structure: the parser couldn't recognize it. Resolve
    // conservatively false (the gate/refuse fail-closed default) rather than guess.
    v = false;
  }
  return cond.negated ? !v : v;
}
