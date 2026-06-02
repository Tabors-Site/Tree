// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// roleComposer.js — compose a role STACK into a single role-shaped spec
// the rest of the moment runner consumes uniformly.
//
// ── Doctrine ────────────────────────────────────────────────────────
//
// A being doesn't wear one role at a moment — it wears a stack. The
// first non-stacked clause whose `when` matches becomes the PRIMARY
// role; every stacked clause (`stack: true`) whose `when` matches
// becomes a MODIFIER. The full stack [primary, ...modifiers] is what
// the moment runs.
//
// `composeStack` takes that ordered list of role names and returns
// one role-shaped object whose:
//
//   - canSee / canDo / canSummon / canBe — UNION of every stack
//     member's entry list. Stacking can only ADD capabilities
//     (RoleFlow.md, Section 9: "No subtractive permissions").
//   - permissions — UNION of every stack member's verb permissions.
//   - prompt(ctx) — concatenation of every stack member's prompt
//     body, separated by `\n\n---\n\n`. The divider signals to the
//     LLM that distinct frames are being layered: primary frame first,
//     modifiers stacked below.
//   - summon — the PRIMARY role's summon function. Scripted-cognition
//     dispatch is single-handler; modifiers are an LLM-prompt concept
//     and stacking modifiers onto a scripted primary leaves the
//     handler alone. (If both primary and a modifier ship a scripted
//     summon handler, the modifier's is ignored — modifiers don't
//     compose handlers, only prompts and capabilities.)
//   - name — PRIMARY's name. Stamped into Act.activeRole; the modifier
//     stack is recoverable by replaying the chain against the same
//     roleFlow + registry.
//   - requiredCognition — PRIMARY's. Modifiers were filtered by
//     requiredCognition before composition; the primary's value is
//     what represents the composed spec.
//   - origin — PRIMARY's origin tag. Carried through for diagnostics.
//
// ── Why "one role-shaped spec" ────────────────────────────────────
//
// Every existing consumer (buildPrompt, momentum, llmMoment, summon
// verb) reads role.name / role.prompt / role.canSee etc. Composing
// the stack into a single object keeps every consumer untouched: they
// see one spec, the spec just happens to be a union view. The
// stacking concept is invisible past the composer's boundary.

import { getRole } from "./registry.js";
import { beingCognition } from "../../materials/being/identity/lookups.js";

// Stack framing. The primary's prompt reads bare — it's the being's
// voice. Modifiers each get an explicit "Additionally, you are
// currently in this mode" frame naming the modifier role, so the LLM
// composes them as layered context rather than reading the `---`
// divider as a discontinuity / topic change. This matches the
// guidance in role-manager.md verification §3: name each modifier so
// it composes rather than just concatenates.
const PRIMARY_DIVIDER  = "\n\n---\n\n";
const MODIFIER_PREFIX  = "Additionally, you are currently in this mode";

/**
 * Resolve a list of role names into a single composed role spec.
 *
 * @param {object} args
 * @param {string[]} args.stack        ordered [primary, ...modifiers] role names
 * @param {object}   args.toBeing      recipient being (for requiredCognition filtering)
 * @returns {object|null}              composed role spec, or null when the primary is unresolvable
 *
 * Modifiers whose roles aren't registered, or whose requiredCognition
 * doesn't match the being's effective cognition, are silently dropped
 * (they're additive — missing them just degrades behavior gracefully).
 * The primary failing the same check returns null (the moment can't run).
 */
export function composeStack({ stack, toBeing }) {
  if (!Array.isArray(stack) || stack.length === 0) return null;
  const beingCog = beingCognition(toBeing);

  const resolved = [];
  for (let i = 0; i < stack.length; i++) {
    const name = stack[i];
    if (typeof name !== "string" || !name) continue;
    const role = getRole(name);
    if (!role) continue;
    if (role.requiredCognition && role.requiredCognition !== beingCog) {
      if (i === 0) return null;       // primary cognition mismatch → can't run
      continue;                       // modifier cognition mismatch → drop silently
    }
    resolved.push(role);
  }
  if (resolved.length === 0) return null;

  const primary = resolved[0];
  const modifiers = resolved.slice(1);

  // Capability unions. Each role's can*-arrays are entry lists (strings
  // or `{action,description}` shorthand objects). We dedupe by string
  // value for primitive entries and by JSON-stringified key for object
  // entries. The order is primary-first so the LLM sees the primary
  // frame's capabilities first when the renderer iterates.
  const canSee    = unionEntries(resolved.map((r) => r.canSee));
  const canDo     = unionEntries(resolved.map((r) => r.canDo));
  const canSummon = unionEntries(resolved.map((r) => r.canSummon));
  const canBe     = unionEntries(resolved.map((r) => r.canBe));

  const permissions = unionStrings(resolved.map((r) => r.permissions));
  const see         = unionEntries(resolved.map((r) => r.see));

  // Prompt composition. Each role's prompt may be a function (the
  // canonical seed/extension shape — registry.js's makeLazyDefaultSummon
  // wraps it) or a string (live roles authored via set-role). The
  // primary's body reads bare (it's the being's voice); each modifier
  // gets a named frame so the LLM treats it as layered context.
  const promptFns = resolved.map((r) => normalizePrompt(r));
  const composedPrompt = (ctx) => {
    const parts = [];
    for (let i = 0; i < resolved.length; i++) {
      const body = promptFns[i](ctx);
      if (typeof body !== "string" || body.length === 0) continue;
      if (i === 0) {
        parts.push(body);
      } else {
        const name = resolved[i].name;
        parts.push(`${MODIFIER_PREFIX} — ${name}:\n\n${body}`);
      }
    }
    return parts.join(PRIMARY_DIVIDER);
  };

  // The composed spec must remain shape-compatible with what
  // buildPrompt / momentum / llmMoment / the summon verb expect.
  return Object.freeze({
    name:              primary.name,
    primaryName:       primary.name,           // explicit accessor for clarity
    stackedNames:      resolved.map((r) => r.name),
    canSee, canDo, canSummon, canBe,
    permissions,
    see,
    prompt:            composedPrompt,
    summon:            primary.summon,        // scripted dispatch, primary only
    requiredCognition: primary.requiredCognition || null,
    respondMode:       primary.respondMode || "async",
    triggerOn:         primary.triggerOn || ["message"],
    selfContinue:      !!primary.selfContinue,
    defaultOrientation: primary.defaultOrientation || null,
    replyTo:           primary.replyTo || null,
    origin:            primary.origin || null,
    // Identity-flag preservation: roles that need a scripted-cognition
    // handler in moment dispatch (cherub, scheduler-being, etc.) get
    // their handler propagated unchanged.
    _cognitionMode:    primary._cognitionMode || null,
  });
}

// Wraps role.prompt regardless of source shape into one (ctx) => string.
function normalizePrompt(role) {
  if (typeof role?.prompt === "function") {
    return (ctx) => {
      try { return String(role.prompt(ctx) || ""); }
      catch { return ""; }
    };
  }
  if (typeof role?.prompt === "string") {
    const literal = role.prompt;
    return () => literal;
  }
  return () => "";
}

// Union of mixed entry lists. Each entry is either a string or an
// object with a stable key (action / stance / name). Order is preserved
// (first occurrence wins). Empty / missing arrays contribute nothing.
function unionEntries(arrays) {
  const seen = new Set();
  const out  = [];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      const k = keyOfEntry(e);
      if (k === null || seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
  }
  return out;
}

function keyOfEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === "string" || typeof entry === "number") return String(entry);
  if (typeof entry === "object") {
    if (typeof entry.action === "string") return `do:${entry.action}`;
    if (typeof entry.stance === "string") return `stance:${entry.stance}`;
    if (typeof entry.name   === "string") return `name:${entry.name}`;
    // Fallback: stable stringify. Order-sensitive — fine since seed/extension
    // can* entries are authored consistently.
    try { return JSON.stringify(entry); } catch { return null; }
  }
  return null;
}

function unionStrings(arrays) {
  const seen = new Set();
  const out = [];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      if (typeof s !== "string" || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}
