// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// secretStash — the in-memory side channel for transport-act secrets.
//
// A transport act rides the chain: enqueueIntake stamps the whole entry
// (including act.args) into a summon fact, and the inbox projection
// mirrors it. Credentials must never land there — a password or an
// imported private key in a fact is a plaintext secret in the durable
// record, unredactable forever (the past is fixed).
//
// So the wire layer SPLITS the act before it is stamped: secret leaves
// (by key name, below) are pulled out of the args and held HERE, keyed
// by the act's correlation; a "[held]" marker rides the chain in their
// place. When the scheduler picks the entry and surfaces the act to the
// moment, restore() grafts the held values back in. Same process, same
// memory — transport acts always run where the socket lives.
//
// Crash semantics are deliberate: a pending intake row replayed after a
// restart has no stash entry, so the moment runs with the marker and
// the handler refuses (e.g. "password is required"). The client simply
// retries. Losing a secret beats persisting one.

const HELD = "[held]";
const TTL_MS = 5 * 60_000;

// Secret leaf keys never allowed into a stamped transport-act entry.
// Superset of redact.js's wire set: importKey/privateKeyPem/mnemonic
// exist only on this path (key import) and the export response channel.
const STASH_KEYS = new Set([
  "password",
  "importKey",
  "privateKeyPem",
  "mnemonic",
  "apiKey",
  "encryptedApiKey",
  "credentialPlain",
]);

const _stash = new Map(); // correlation -> { at, secrets: [{path, value}] }

function _sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of _stash) if (v.at < cutoff) _stash.delete(k);
}

/**
 * Deep-walk `obj`, replacing secret leaves with the HELD marker and
 * collecting the originals. Returns the scrubbed clone; records the
 * extraction under `correlation` when anything was found.
 */
export function stashSecrets(correlation, obj) {
  const secrets = [];
  const scrub = (node, path) => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((v, i) => scrub(v, `${path}[${i}]`));
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (STASH_KEYS.has(k) && typeof v === "string" && v.length) {
        secrets.push({ path: path ? `${path}.${k}` : k, key: k, value: v, parentPath: path });
        out[k] = HELD;
      } else {
        out[k] = scrub(v, path ? `${path}.${k}` : k);
      }
    }
    return out;
  };
  const scrubbed = scrub(obj, "");
  if (secrets.length && correlation) {
    _sweep();
    _stash.set(String(correlation), { at: Date.now(), secrets });
  }
  return scrubbed;
}

/**
 * Graft held secrets back into a surfaced act (the scheduler's pick
 * path). Mutates a deep clone, not the row. One-shot: the stash entry
 * is consumed so a secret lives in exactly one in-flight moment.
 */
export function restoreSecrets(correlation, obj) {
  const entry = correlation ? _stash.get(String(correlation)) : null;
  if (!entry || !obj || typeof obj !== "object") return obj;
  _stash.delete(String(correlation));
  const clone = JSON.parse(JSON.stringify(obj));
  for (const { path, value } of entry.secrets) {
    const parts = path.split(".").flatMap((p) =>
      p.includes("[") ? p.split(/[[\]]/).filter(Boolean).map((x) => (/^\d+$/.test(x) ? Number(x) : x)) : [p]);
    let node = clone;
    for (let i = 0; i < parts.length - 1 && node; i++) node = node[parts[i]];
    const leaf = parts[parts.length - 1];
    if (node && node[leaf] === HELD) node[leaf] = value;
  }
  return clone;
}

export const SECRET_HELD_MARKER = HELD;
