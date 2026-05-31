// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Qualities. What kind a thing is.
//
// Every primitive (Space, Being, Matter) carries two layers. My schema
// is the constitutive layer: closed, seed-defined, the necessary
// grip that makes a primitive a primitive I can handle. The `qualities`
// Map is the characterizing layer: open, extension-defined, the
// answer to Plato's question "of what sort is this particular one?"
// See PLACE.md "Qualities" for the full rationale (why this word, the
// two-layer test, the four marks, why extension-data and qualities
// are the same thing).
//
// A space with `qualities.governing` = { kind: "domain" } is a
// domain-shape space. A being with `qualities.energy` = { available:
// 100 } is a being with that energy. A matter with `qualities.review`
// = { status: "approved" } is matter of that review-status.
//
// The word is Plato's. ποιότης (poiótēs), coined in Theaetetus from
// the everyday question word ποῖος ("of what sort?"), nominalized
// into the abstract noun "of-what-sort-ness." Cicero calqued it into
// Latin as qualitas (from qualis, "of what kind"). The field is
// named for exactly what it does: it holds the answer to the
// question. The earlier name was `metadata`, replaced because
// "meta-" implied subordinate; a primitive's qualities are not
// subordinate to the primitive, they are what it is like.
//
// Plural because each extension answers "of what sort?" from its own
// angle, so a primitive carries many qualities. Each extension owns
// one quality namespace under its name (`qualities.governing`,
// `qualities.energy`, `qualities.review`). I never read or write
// inside an extension's quality namespace; I only provide the atomic
// primitives below.
//
// The Map defaults to empty at creation. A brand-new primitive is
// complete with zero qualities; the empty Map is its standing
// capacity to be qualified.
//
// Every write goes through these helpers so concurrent writes to
// different quality namespaces on the same primitive never clobber
// each other, and the document-size guard catches anyone trying to
// push a row past the BSON limit. There is no read-modify-write
// path; every write uses an atomic MongoDB operator.
//
// API:
//
//   import { qualities } from "../materials/qualities.js";
//
//   qualities.being.getQuality(being, "energy")          // {} when unset
//   qualities.being.readQualityNamespace(being, "energy") // null when unset
//   qualities.being.setQuality(being, "energy", { available: 100 })
//   qualities.being.mergeQuality(being, "energy", { available: 95 })
//   qualities.being.incQuality(being, "storage", "usageKB", 42)
//   qualities.being.pushQuality(being, "phase", "history", entry, 50)
//   qualities.being.addToQualitySet(being, "nav", "roots", rootId)
//   qualities.being.batchSetQuality(being, "energy", { available: 100, lastReset })
//   qualities.being.unsetQuality(being, "old-extension")
//
// Same nine methods on `qualities.space` and `qualities.matter`. The
// space and matter variants enforce namespace ownership when the
// scoped reality bundle passes opts.callerExtName (extensions can only
// write to their own quality namespace).

import Being from "../materials/being/being.js";
import { getInternalConfigValue } from "../internalConfig.js";
import Space from "../materials/space/space.js";
import Matter from "../materials/matter/matter.js";
import { hooks } from "../hooks.js";
import { guardQualityWrite } from "./doCeiling.js";
import { getRealityConfigValue } from "../realityConfig.js";

const MAX_KEY_LENGTH = 50;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function MAX_VALUE_BYTES() {
  return Math.max(
    1024,
    Math.min(
      Number(getInternalConfigValue("qualityNamespaceMaxBytes")) || 524288,
      2 * 1024 * 1024,
    ),
  );
}

function maxNestingDepth() {
  return Math.max(
    2,
    Math.min(Number(getInternalConfigValue("qualityMaxNestingDepth")) || 5, 20),
  );
}

function validateKey(key) {
  if (!key || typeof key !== "string") {
    throw new Error("Quality namespace key must be a non-empty string");
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new Error(
      `Quality namespace "${key.slice(0, 20)}..." exceeds ${MAX_KEY_LENGTH} character limit`,
    );
  }
  if (DANGEROUS_KEYS.has(key)) {
    throw new Error(`Quality namespace "${key}" is not allowed`);
  }
}

function measureDepth(value, current = 0, seen) {
  if (value === null || typeof value !== "object") return current;
  if (!seen) seen = new WeakSet();
  if (seen.has(value)) return current;
  seen.add(value);
  let max = current + 1;
  const entries = Array.isArray(value) ? value : Object.values(value);
  for (const v of entries) {
    if (v !== null && typeof v === "object") {
      const d = measureDepth(v, current + 1, seen);
      if (d > max) max = d;
      if (max > maxNestingDepth()) return max;
    }
  }
  return max;
}

function hasDangerousKeys(value, seen) {
  if (value === null || typeof value !== "object") return false;
  if (!seen) seen = new WeakSet();
  if (seen.has(value)) return false;
  seen.add(value);
  const entries = Array.isArray(value)
    ? value.entries()
    : Object.entries(value);
  for (const [k, v] of entries) {
    if (typeof k === "string" && DANGEROUS_KEYS.has(k)) return true;
    if (v !== null && typeof v === "object" && hasDangerousKeys(v, seen))
      return true;
  }
  return false;
}

function validateData(key, data) {
  if (data == null) return 0;
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(data), "utf8");
  } catch {
    throw new Error(
      `Quality "${key}" data is not serializable (circular reference, BigInt, or non-JSON type)`,
    );
  }
  if (size > MAX_VALUE_BYTES()) {
    throw new Error(
      `Quality "${key}" data exceeds ${MAX_VALUE_BYTES() / 1024}KB limit (${Math.round(size / 1024)}KB)`,
    );
  }
  const depth = measureDepth(data);
  if (depth > maxNestingDepth()) {
    throw new Error(
      `Quality "${key}" data exceeds max nesting depth of ${maxNestingDepth()} (found ${depth})`,
    );
  }
  if (hasDangerousKeys(data)) {
    throw new Error(
      `Quality "${key}" data contains forbidden keys (__proto__, constructor, or prototype)`,
    );
  }
  return size;
}

// Build the read-only quality primitives bound to a specific Mongoose
// model. Same shape across being, space, matter.
//
// Write methods (setQuality / mergeQuality / incQuality / pushQuality /
// addToQualitySet / batchSetQuality / unsetQuality) retired 2026-05-23
// (Slice 3). The fact-driven path is the only writer now:
//
//   await reality.do(target, "set-<kind>", { field: "qualities.<ns>", value }, opts)
//   await reality.do(target, "set-<kind>", { field: "qualities.<ns>.<inner>", value }, opts)
//
// where <kind> is space / being / matter — whichever the target is.
//
// Every write stamps a Fact on the aggregate's reel; the reducer
// (see materials/reducerHelpers.applySetQualities) derives the new
// qualities state; the fold engine writes the projection under the
// per-reel append lock. Per STAMPER.md: one writer (fold), one source
// of truth (facts). The legacy direct-Mongo path here would silently
// bypass that — so it's gone.
//
// Tombstone methods below throw with a clear migration message. The
// loader's wrapper (extensions/loader.js) used to bind callerExtName
// through these methods; that wrapping is retired alongside.
function createQualityPrimitives({ Model, documentType }) {
  const tombstone = (methodName) => () => {
    throw new Error(
      `qualities.${documentType}.${methodName} retired 2026-05-23. ` +
      `Use reality.do(target, "set-${documentType}", { field: "qualities.<ns>" or ` +
      `"qualities.<ns>.<innerKey>", value }) instead — every write is ` +
      `a Fact on the aggregate's reel now (see seed/STAMPER.md).`,
    );
  };

  return {
    getQuality(doc, key) {
      if (!doc || !doc.qualities) return {};
      const data =
        doc.qualities instanceof Map
          ? doc.qualities.get(key)
          : doc.qualities?.[key];
      return data || {};
    },

    readQualityNamespace(doc, key) {
      if (!doc || !doc.qualities) return null;
      if (doc.qualities instanceof Map) return doc.qualities.get(key) || null;
      return doc.qualities?.[key] || null;
    },

    setQuality:        tombstone("setQuality"),
    mergeQuality:      tombstone("mergeQuality"),
    incQuality:        tombstone("incQuality"),
    pushQuality:       tombstone("pushQuality"),
    addToQualitySet:   tombstone("addToQualitySet"),
    batchSetQuality:   tombstone("batchSetQuality"),
    unsetQuality:      tombstone("unsetQuality"),
  };
}

export const qualities = Object.freeze({
  being: createQualityPrimitives({
    Model: Being,
    documentType: "being",
    enforceOwnership: false,
  }),
  space: createQualityPrimitives({
    Model: Space,
    documentType: "space",
    enforceOwnership: true,
  }),
  matter: createQualityPrimitives({
    Model: Matter,
    documentType: "matter",
    enforceOwnership: true,
  }),
});
