// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Qualities. What kind a thing is.
//
// Every primitive (Space, Being, Matter) carries two layers. My schema
// is the constitutive layer: closed, kernel-defined, the necessary
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
//   import { qualities } from "../place/qualities.js";
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
// scoped core passes opts.callerExtName (extensions can only write
// to their own quality namespace).

import Being from "../models/being.js";
import Space from "../models/space.js";
import Matter from "../models/matter.js";
import { hooks } from "../system/hooks.js";
import { guardQualityWrite } from "./documentGuard.js";
import { getPlaceConfigValue } from "../placeConfig.js";

const MAX_KEY_LENGTH = 50;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function MAX_VALUE_BYTES() {
  return Math.max(
    1024,
    Math.min(
      Number(getPlaceConfigValue("qualityNamespaceMaxBytes")) || 524288,
      2 * 1024 * 1024,
    ),
  );
}

function maxNestingDepth() {
  return Math.max(
    2,
    Math.min(Number(getPlaceConfigValue("qualityMaxNestingDepth")) || 5, 20),
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

// Build the nine quality primitives bound to a specific Mongoose
// model. Same shape across being, space, matter.
function createQualityPrimitives({
  Model,
  documentType,
  enforceOwnership = false,
}) {
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

    async setQuality(doc, key, data, opts) {
      validateKey(key);
      if (
        enforceOwnership &&
        opts?.callerExtName &&
        key !== opts.callerExtName
      ) {
        throw new Error(
          `Namespace violation: "${opts.callerExtName}" cannot write to "${key}". Extensions can only write to their own quality namespace.`,
        );
      }
      validateData(key, data);

      if (
        typeof doc === "object" &&
        doc !== null &&
        doc.qualities !== undefined
      ) {
        guardQualityWrite(doc, data, { documentType, documentId: doc._id });
      }

      // Update in-memory document BEFORE the DB write so fire-and-
      // forget callers that read `doc.qualities` immediately after
      // see the new value.
      if (
        typeof doc === "object" &&
        doc !== null &&
        doc.qualities !== undefined
      ) {
        if (!doc.qualities) doc.qualities = new Map();
        if (doc.qualities instanceof Map) {
          doc.qualities.set(key, data);
        } else {
          doc.qualities[key] = data;
        }
        if (doc.markModified) doc.markModified("qualities");
      }

      const id = String(doc._id || doc);
      await Model.updateOne(
        { _id: id },
        { $set: { [`qualities.${key}`]: data } },
      );

      hooks
        .run("afterQualityWrite", {
          documentType,
          [`${documentType}Id`]: id,
          key,
          data,
        })
        .catch(() => {});
      return true;
    },

    async mergeQuality(doc, key, partial, opts) {
      validateKey(key);
      if (
        enforceOwnership &&
        opts?.callerExtName &&
        key !== opts.callerExtName
      ) {
        throw new Error(
          `Namespace violation: "${opts.callerExtName}" cannot write to "${key}".`,
        );
      }
      if (!partial || typeof partial !== "object" || Array.isArray(partial))
        return false;

      const safePartial = {};
      for (const [field, value] of Object.entries(partial)) {
        if (DANGEROUS_KEYS.has(field)) continue;
        if (
          typeof field !== "string" ||
          field.length === 0 ||
          field.length > MAX_KEY_LENGTH
        )
          continue;
        if (field.includes(".") || field.includes("$")) continue;
        try {
          JSON.stringify(value);
        } catch {
          continue;
        }
        safePartial[field] = value;
      }
      if (Object.keys(safePartial).length === 0) return false;

      const existing = this.getQuality(doc, key);
      const merged = { ...existing, ...safePartial };
      validateData(key, merged);

      if (typeof doc === "object" && doc !== null) {
        guardQualityWrite(doc, merged, { documentType, documentId: doc._id });
      }

      const id = String(doc._id || doc);
      const updates = {};
      for (const [field, value] of Object.entries(safePartial)) {
        updates[`qualities.${key}.${field}`] = value;
      }
      await Model.updateOne({ _id: id }, { $set: updates });

      if (typeof doc === "object" && doc !== null) {
        if (doc.qualities instanceof Map) {
          doc.qualities.set(key, merged);
        } else if (doc.qualities) {
          doc.qualities[key] = merged;
        }
      }

      hooks
        .run("afterQualityWrite", {
          documentType,
          [`${documentType}Id`]: id,
          key,
          data: safePartial,
        })
        .catch(() => {});
      return true;
    },

    async incQuality(doc, key, field, amount = 1) {
      if (!doc || !key || !field) return false;
      validateKey(key);
      if (DANGEROUS_KEYS.has(field)) return false;
      if (typeof amount !== "number" || !isFinite(amount)) return false;
      const id = String(doc._id || doc);
      await Model.updateOne(
        { _id: id },
        { $inc: { [`qualities.${key}.${field}`]: amount } },
      );
      return true;
    },

    async pushQuality(doc, key, field, item, maxLength = 100) {
      if (!doc || !key || !field) return false;
      validateKey(key);
      if (DANGEROUS_KEYS.has(field)) return false;
      const safeCap = Math.min(Math.max(1, maxLength), 1000);
      let itemSize;
      try {
        itemSize = Buffer.byteLength(JSON.stringify(item), "utf8");
      } catch {
        return false;
      }
      const perItemCap = Math.max(
        1024,
        Math.floor(MAX_VALUE_BYTES() / safeCap),
      );
      if (itemSize > perItemCap) return false;
      const id = String(doc._id || doc);
      await Model.updateOne(
        { _id: id },
        {
          $push: {
            [`qualities.${key}.${field}`]: { $each: [item], $slice: -safeCap },
          },
        },
      );
      return true;
    },

    async addToQualitySet(doc, key, field, item) {
      if (!doc || !key || !field) return false;
      validateKey(key);
      if (DANGEROUS_KEYS.has(field)) return false;
      let itemSize;
      try {
        itemSize = Buffer.byteLength(JSON.stringify(item), "utf8");
      } catch {
        return false;
      }
      if (itemSize > MAX_VALUE_BYTES()) return false;
      const id = String(doc._id || doc);
      await Model.updateOne(
        { _id: id },
        { $addToSet: { [`qualities.${key}.${field}`]: item } },
      );
      return true;
    },

    async batchSetQuality(doc, key, fields) {
      if (!doc || !key || !fields || typeof fields !== "object") return false;
      validateKey(key);
      const entries = Object.entries(fields);
      if (entries.length === 0 || entries.length > 100) return false;
      const updates = {};
      let totalSize = 0;
      const maxBytes = MAX_VALUE_BYTES();
      for (const [field, value] of entries) {
        if (DANGEROUS_KEYS.has(field)) continue;
        let serialized;
        try {
          serialized = JSON.stringify(value);
        } catch {
          continue;
        }
        totalSize += Buffer.byteLength(serialized, "utf8");
        if (totalSize > maxBytes) return false;
        updates[`qualities.${key}.${field}`] = value;
      }
      if (Object.keys(updates).length === 0) return false;
      const id = String(doc._id || doc);
      await Model.updateOne({ _id: id }, { $set: updates });
      return true;
    },

    async unsetQuality(doc, key) {
      if (!doc || !key) return false;
      validateKey(key);
      const id = String(doc._id || doc);
      await Model.updateOne(
        { _id: id },
        { $unset: { [`qualities.${key}`]: "" } },
      );
      return true;
    },
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
