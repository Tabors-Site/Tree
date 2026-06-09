// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// canSeeResolver.js . resolve a role's canSee list into the face
// blocks the being already sees the instant its frame goes through
// inference.
//
// canSee is the unified declaration of a being's perception this
// moment. Each entry is either:
//
//   . an IBP address string . preloaded by calling seeVerb on that
//                              address; the position descriptor
//                              becomes a face block.
//   . a registered see name . preloaded by calling the named
//                              seeResolver function; the structured
//                              return becomes a face block.
//
// Either shape produces structured JSON inlined into the system
// prompt under a `[<label>]` header. There is no see-tool menu; the
// being does not pick from a list. The face IS the perception.
//
// Address classification. Anything starting with ".", "/", or "<"
// is an address; everything else is a see name. The leading "." is
// heaven shorthand (`.config` → `<reality>/./config`); "./" is the
// explicit child form (`./config` → `<reality>/./config`); "<" is
// a fully-qualified address (`<reality>/...`); "/" is a tree path
// from the reality root.
//
// Failures are logged and dropped from the face. A missing see
// resolver or a failing address fetch never blocks the moment . the
// being just does not see that block.

import log from "../../../seedReality/log.js";
import { getSeeOperation } from "../../../ibp/seeOps.js";
import { seeVerb } from "../../../ibp/verbs/see.js";
import { getRealityDomain } from "../../../ibp/address.js";

/**
 * Resolve canSee entries into pre-rendered face blocks.
 *
 * @param {Array<string>} entries . role.canSee values
 * @param {object} ctx             . moment ctx (carries being, position, branch, ...)
 * @returns {Promise<string[]>}   . non-empty face blocks, declaration order
 */
export async function resolveCanSee(entries, ctx) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const blocks = await Promise.all(
    entries.map((entry) => resolveOne(entry, ctx)),
  );
  return blocks.filter(Boolean);
}

async function resolveOne(entry, ctx) {
  if (typeof entry !== "string" || entry.length === 0) {
    return null;
  }
  if (isAddressShape(entry)) {
    return resolveAddress(entry, ctx);
  }
  return resolveNamedSee(entry, ctx);
}

function isAddressShape(s) {
  return s.startsWith(".") || s.startsWith("/") || s.startsWith("<");
}

async function resolveAddress(entry, ctx) {
  const beingId = ctx?.being?._id ? String(ctx.being._id) : null;
  const address = expandAddress(entry);
  try {
    const descriptor = await seeVerb(address, {
      identity: beingId
        ? { beingId, name: ctx?.being?.name || null }
        : null,
    });
    if (descriptor == null) return null;
    return renderBlock(labelForAddress(entry), descriptor);
  } catch (err) {
    log.warn(
      "CanSeeResolver",
      `address "${entry}" SEE failed: ${err.code || err.message}`,
    );
    return null;
  }
}

// Heaven shorthand. Bare "." → heaven itself. ".X" with no slash →
// heaven child X. "./X" → heaven child X. Other leading-"." shapes
// pass through to seeVerb's address grammar.
function expandAddress(entry) {
  if (entry === ".") return `${getRealityDomain()}/.`;
  if (entry.startsWith("./")) return `${getRealityDomain()}/${entry}`;
  if (entry.startsWith(".") && entry[1] !== ".") {
    return `${getRealityDomain()}/./${entry.slice(1)}`;
  }
  return entry;
}

function labelForAddress(entry) {
  if (entry === ".") return "place";
  if (entry.startsWith("./")) return entry.slice(2);
  if (entry.startsWith(".") && entry[1] !== ".") return entry.slice(1);
  return entry;
}

async function resolveNamedSee(name, ctx) {
  const op = getSeeOperation(name);
  if (!op) {
    log.warn("CanSeeResolver", `unknown see "${name}"; skipping`);
    return null;
  }
  try {
    const beingId = ctx?.being?._id ? String(ctx.being._id) : null;
    const identity = beingId
      ? { beingId, name: ctx?.being?.name || null }
      : null;
    const out = await op.handler({ identity, args: {}, ctx, branch: ctx?.branch || "0" });
    return renderNamedOutput(name, out);
  } catch (err) {
    log.warn("CanSeeResolver", `see "${name}" failed: ${err.message}`);
    return null;
  }
}

// Mirrors seeResolvers.renderResolverOutput. Structured objects
// become `[<label>]\n<JSON>` blocks the LLM folds cleanly; strings
// pass through verbatim (the resolver framed its own block).
function renderNamedOutput(name, out) {
  if (out == null) return null;
  if (typeof out === "string") return out.length > 0 ? out : null;
  if (typeof out !== "object") return null;
  return renderBlock(labelForSeeName(name), out);
}

function labelForSeeName(name) {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function renderBlock(label, payload) {
  try {
    return `[${label}]\n${JSON.stringify(payload, null, 2)}`;
  } catch {
    return null;
  }
}
