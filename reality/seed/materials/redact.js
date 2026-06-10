// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// redact.js — strip secrets from anything about to leave the server over
// a transport (a SEE descriptor, a fact/act reel, a clone bundle, a
// federation envelope). Secrets stay intact in the DB fact-chain and in
// on-disk seeds — those are the operator's own server-side truth. The
// moment a chain or a being's state is serialized OUT to a frontend or a
// peer, it passes through here first.
//
// What counts as a secret:
//   encryptedApiKey  — a being's LLM connection key (AES blob)
//   apiKey           — a raw key (should never reach a fact, but caught)
//   credentialPlain  — a being's auto-generated password (encrypted blob)
//   password         — a being's credential hash
//
// Two shapes carry these:
//   1. By key name, inside a qualities object — e.g.
//      qualities.llmConnections.<id>.encryptedApiKey,
//      qualities.auth.credentialPlain.
//   2. As the `value` of a set-<kind> fact whose `field` names a secret
//      path — e.g. fact.params = { field: "password", value: <hash> } or
//      { field: "qualities.llmConnections.<id>", value: { encryptedApiKey } }.
//      Here the secret rides under the generic key "value", so a name-only
//      sweep would miss it; we redact `value` when `field` is a secret path.
//
// What this deliberately does NOT touch: the auth handshake channel —
// `identityToken` (birth/connect result) and the reset `plaintext`
// (credential-reset result). Those are intentional one-time returns to
// the asker, not chain/state surfaced for display.

const REDACTED = "[redacted]";

// Secret leaf keys, redacted wherever they appear by name.
const SECRET_KEYS = new Set([
  "encryptedApiKey",
  "apiKey",
  "credentialPlain",
  "password",
]);

// A set-<kind> fact whose `field` matches one of these has its sibling
// `value` redacted (the secret rides in value, not under a secret key).
function isSecretFieldPath(field) {
  if (typeof field !== "string") return false;
  return (
    field === "password" ||
    field.startsWith("qualities.llmConnections") ||
    field.startsWith("qualities.auth") ||
    field.endsWith(".encryptedApiKey") ||
    field.endsWith(".credentialPlain")
  );
}

/**
 * Return a deep copy of `value` with secrets replaced by "[redacted]".
 * Never mutates the input. Preserves Maps as Maps and arrays as arrays so
 * downstream shape (e.g. a clone bundle's qualities Map) is unchanged
 * apart from the redacted leaves. Cyclic graphs are guarded.
 */
export function redactSecrets(value, _seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return value;
  if (_seen.has(value)) return value;
  // Built-in object types that DON'T expose their state through
  // Object.entries (Date, RegExp, ObjectId-likes with toJSON, …). Walking
  // them via the generic Object.entries path destroyed their data —
  // e.g. a Date stamp on an Act fact arrived at the portal as `{}` and
  // every downstream `new Date(x)` produced Invalid Date, which is
  // what broke the timeline strip. Return these as-is.
  if (value instanceof Date) return value;
  if (value instanceof RegExp) return value;
  // BSON/Mongo wrappers (ObjectId, Binary, Decimal128, …) implement
  // _bsontype + toJSON. Forward as-is so JSON serialization at the wire
  // calls toJSON instead of receiving an empty `{}`.
  if (typeof value._bsontype === "string" && typeof value.toJSON === "function") return value;
  _seen.add(value);

  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, _seen));
  }

  if (value instanceof Map) {
    const out = new Map();
    for (const [k, v] of value) {
      out.set(k, SECRET_KEYS.has(k) ? REDACTED : redactSecrets(v, _seen));
    }
    return out;
  }

  // Plain object. Handle the {field, value} fact-param pattern, then sweep
  // remaining keys by name.
  const fieldIsSecret =
    typeof value.field === "string" && isSecretFieldPath(value.field);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.has(k)) {
      out[k] = REDACTED;
    } else if (k === "value" && fieldIsSecret) {
      out[k] = REDACTED;
    } else {
      out[k] = redactSecrets(v, _seen);
    }
  }
  return out;
}
