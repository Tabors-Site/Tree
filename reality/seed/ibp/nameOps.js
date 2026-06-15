// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// NAME_OPS — the canonical NAME operations.
//
// NAME is the fifth verb, and unlike the four world verbs it does not
// operate as a stance: it is the IDENTITY layer (outer worlds). It rides
// the same IBPA, but its address is reality-only (`<realityDomain>` — the
// reality's I_AM, where a new name is declared) or `<nameId>@<realityDomain>`
// (a specific name, to see or banish it). The portal gives it its own views
// (create a name, see a name's data / all its acts).
//
// A closed set, like BE: two ops, no extension adds a third.
//
//   declare — mint a new Name: a fresh ed25519 keypair whose public key is
//             the Name's id, a facet of the reality's I_AM (parentNameId =
//             I_AM, flat — never a Name hierarchy). The private key is held
//             custodially (encrypted) on the Name row.
//   banish  — the Name tombstones itself: no new fact can ever be signed by
//             it again (the gate lives in logFact). Its history persists.
//
// Permissions: for now ANYONE can call NAME (the verb only requires a
// caller identity, for the fact's actor). The "declare is open, banish is
// self-only" constraints are added later — see nameVerb.
//
// The handlers live here directly: NAME has no owning character (BE's live
// with cherub because cherub owns BE). They are nearly inert — declare mints
// a keypair + spec, banish just names its target — and nameVerb stamps the
// name:declare / name:banish fact.

import { generateBeingKeypair } from "../materials/name/keys.js";
import { encryptCredential } from "../materials/being/identity/credentials.js";
import { encryptWithPassword } from "../materials/name/passwordKey.js";
import { I_AM } from "../materials/being/seedBeings.js";
import { IbpError, IBP_ERR } from "./protocol.js";

// declare — mint a new Name as a facet of the reality's I_AM. Returns the
// new nameId + the spec the fact carries (applyMintName folds it). The
// keypair is generated here — this is where key-minting LIVES now (it left
// birth.js when a being stopped being its own identity).
async function declareHandler({ payload }) {
  // Real-name UNIQUE per reality: at most one Name per real-name, so the
  // registry resolves a real-name to exactly one Name. Names live on main.
  if (payload?.name) {
    const { findByName } = await import("../materials/projections.js");
    if (await findByName("name", payload.name, "0")) {
      throw new IbpError(
        IBP_ERR.RESOURCE_CONFLICT,
        `real-name "${payload.name}" is already taken on this reality`,
      );
    }
  }
  const keypair = generateBeingKeypair();
  const nameId = keypair.beingId; // the did:key public key IS the Name's id
  const spec = {
    // Flat lineage: every declared Name is a facet of the reality's I_AM,
    // one layer down — never a Name-of-a-Name hierarchy.
    parentNameId:  I_AM,
    // The key at rest. PASSWORD given -> encrypt with a KDF(password) so the
    // server canNOT auto-decrypt it (only login decrypts it into the
    // session); NO password -> system-encrypted (the server signs
    // automatically). Both name + password are OPTIONAL; only the ENCRYPTED
    // key ever rides the fact, and the holder can always act with the raw pk.
    privateKeyEnc: payload?.password
      ? encryptWithPassword(keypair.privateKeyPem, payload.password)
      : encryptCredential(keypair.privateKeyPem),
    identity:      { alg: "ed25519", keyEnc: "did:key:ed25519-multibase", v: 1 },
    // The soul this Name decides with (human | llm | scripted). Out of this
    // plan's scope beyond recording it; null when unspecified.
    soulType:      payload?.soulType ?? null,
    // The real name (trueName.name) — OPTIONAL human handle. Easier server
    // access (sign in by real-name + password) but never required; you can
    // always act with the private key. Reality-scoped. null when unspecified.
    name:          payload?.name ?? null,
  };
  return { nameId, spec };
}

// banish — the Name marks itself closed. The target Name is the one
// addressed (`<nameId>@<realityDomain>`), threaded in as addressedNameId.
async function banishHandler({ addressedNameId, payload }) {
  const nameId = addressedNameId || payload?.nameId || null;
  if (!nameId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "name banish requires a target name (address it <nameId>@<realityDomain>)",
    );
  }
  return { nameId };
}

export const NAME_OPS = Object.freeze({
  declare: {
    description: "Mint a new name (a facet of the reality's I_AM) with its own keypair.",
    label:       "Declare name",
    args:        { soulType: { type: "string", label: "Soul", required: false } },
    handler:     declareHandler,
  },
  banish: {
    description: "The name tombstones itself; it can never sign a new fact again.",
    label:       "Banish name",
    args:        {},
    handler:     banishHandler,
  },
});

/** Look up a NAME op by name. Null when not in the closed set. */
export function getNameOp(name) {
  return NAME_OPS[name] || null;
}

/** List NAME op names (for portal action menus / license filtering). */
export function listNameOpNames() {
  return Object.keys(NAME_OPS);
}
