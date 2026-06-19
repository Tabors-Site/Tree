// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// NAME_OPS — the canonical NAME operations.
//
// NAME is the fifth verb, and unlike the four world verbs it does not
// operate as a stance: it is the IDENTITY layer (outer worlds). It rides
// the same IBPA, but its address is story-only (`<storyDomain>` — the
// story's I_AM, where a new name is declared) or `<nameId>@<storyDomain>`
// (a specific name, to see or banish it). The portal gives it its own views
// (create a name, see a name's data / all its acts).
//
// A closed set, like BE: two ops, no extension adds a third.
//
//   declare — mint a new Name: a fresh ed25519 keypair whose public key is
//             the Name's id, a facet of the story's I_AM (parentNameId =
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

import { generateNameKeypair, keypairFromPrivateKeyPem, keypairFromSeed, seedFromPrivateKeyPem } from "../materials/name/keys.js";
import { mnemonicToEntropy, entropyToMnemonic } from "../materials/name/mnemonic.js";
import { encryptCredential } from "../materials/being/identity/credentials.js";
import { encryptWithPassword } from "../materials/name/passwordKey.js";
import { I_AM } from "../materials/being/seedBeings.js";
import { IbpError, IBP_ERR } from "./protocol.js";

// Rebuild a keypair from an imported key — the IMPORT half of key custody
// (symmetric to key-export in materials/name/keyOps.js). Accepts either a
// PKCS8 private-key PEM or the 24 BIP39 words key-export hands out; same
// key either skin, same resulting nameId (the pubkey) on any host.
function keypairFromImport(importKey) {
  const s = String(importKey || "").trim();
  if (!s) throw new IbpError(IBP_ERR.INVALID_INPUT, "name declare: importKey is empty");
  const words = s.split(/\s+/);
  if (words.length === 24) return keypairFromSeed(mnemonicToEntropy(s));
  if (/PRIVATE KEY/.test(s)) return keypairFromPrivateKeyPem(s);
  throw new IbpError(
    IBP_ERR.INVALID_INPUT,
    "name declare: importKey must be a PKCS8 private-key PEM or 24 BIP39 words",
  );
}

// declare — mint a new Name as a facet of the story's I_AM. Returns the
// new nameId + the spec the fact carries (applyMintName folds it). The
// keypair is generated here — this is where key-minting LIVES now (it left
// birth.js when a being stopped being its own identity).
async function declareHandler({ payload }) {
  // Real-name UNIQUE per story: at most one Name per real-name, so the
  // registry resolves a real-name to exactly one Name. Names live on main.
  if (payload?.name) {
    const { findByName } = await import("../materials/projections.js");
    if (await findByName("name", payload.name, "0")) {
      throw new IbpError(
        IBP_ERR.RESOURCE_CONFLICT,
        `real-name "${payload.name}" is already taken on this story`,
      );
    }
  }
  // Mint fresh, OR rebuild from an imported key (PEM / 24 words) — bringing
  // a Name you already hold onto this story. The imported key's pubkey IS
  // the nameId, so a re-import of a Name that already exists here is a
  // conflict (you connect to it, you don't re-declare it).
  const keypair = payload?.importKey ? keypairFromImport(payload.importKey) : generateNameKeypair();
  const nameId = keypair.nameId; // the did:key public key IS the Name's id
  if (payload?.importKey) {
    const { loadProjection } = await import("../materials/projections.js");
    if (await loadProjection("name", nameId, "0")) {
      throw new IbpError(
        IBP_ERR.RESOURCE_CONFLICT,
        `imported Name ${String(nameId).slice(0, 12)}… already exists on this story; connect to it instead of re-declaring`,
      );
    }
  }
  const spec = {
    // Flat lineage: every declared Name is a facet of the story's I_AM,
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
    // always act with the private key. Story-scoped. null when unspecified.
    name:          payload?.name ?? null,
  };
  // The key REVEAL — returned ONCE on the direct response, NEVER in the fact
  // (writeNameFact only stamps result.spec, whose key is encrypted). This is
  // the holder's one chance to back up their identity: the private key + its
  // 24-word paper form + the public key (the nameId). Same "show it once at
  // birth" the being-wallet used to do, now at the Name. An IMPORTED key needs
  // no reveal (the caller already holds it).
  const reveal = payload?.importKey ? null : {
    nameId,
    publicKeyPem:  keypair.publicKeyPem,
    privateKeyPem: keypair.privateKeyPem,
    mnemonic:      entropyToMnemonic(seedFromPrivateKeyPem(keypair.privateKeyPem)),
  };
  return { nameId, spec, reveal };
}

// banish — the Name marks itself closed. The target Name is the one
// addressed (`<nameId>@<storyDomain>`), threaded in as addressedNameId.
async function banishHandler({ addressedNameId, payload }) {
  const nameId = addressedNameId || payload?.nameId || null;
  if (!nameId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "name banish requires a target name (address it <nameId>@<storyDomain>)",
    );
  }
  return { nameId };
}

// connect — bind the name to a session (the identity-layer be:connect). The
// fact folds connected:true on the name's reel. Idempotent / TAKEOVER: a
// connect with the right password (proven upstream in nameConnect) always
// succeeds, re-claiming the session even if the reel still shows connected
// (a prior session whose socket dropped without a clean release — a crash,
// refresh, or network blip). This is what prevents the lockout: a
// connected:true reel can never wedge a legitimate holder out. The shared
// signing session is nameId-keyed, so the takeover re-unlocks the SAME key
// (same password → same PEM) and never disrupts another live socket. Only a
// banished name is refused (it can never act again).
async function connectNameHandler({ addressedNameId, payload }) {
  const nameId = addressedNameId || payload?.nameId || null;
  if (!nameId) {
    throw new IbpError(IBP_ERR.INVALID_INPUT,
      "name connect requires a target name (address it <nameId>@<storyDomain>)");
  }
  const { loadProjection } = await import("../materials/projections.js");
  const slot = await loadProjection("name", String(nameId), "0");
  if (!slot?.state) {
    throw new IbpError(IBP_ERR.NAME_NOT_FOUND, `no such name: ${nameId}`);
  }
  const { isNameBanished } = await import("../materials/name/closure.js");
  if (await isNameBanished(String(nameId))) {
    throw new IbpError(IBP_ERR.FORBIDDEN, "name is banished; it cannot connect");
  }
  return { nameId };
}

// release — release the name from its session (the name's own be:release). The
// fact folds connected:false. GATE: a name can't release when it is not
// connected (nothing to release).
async function releaseNameHandler({ addressedNameId, payload }) {
  const nameId = addressedNameId || payload?.nameId || null;
  if (!nameId) {
    throw new IbpError(IBP_ERR.INVALID_INPUT,
      "name release requires a target name (address it <nameId>@<storyDomain>)");
  }
  const { loadProjection } = await import("../materials/projections.js");
  const slot = await loadProjection("name", String(nameId), "0");
  if (!slot?.state?.connected) {
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT,
      "name is not connected — nothing to release");
  }
  return { nameId };
}

export const NAME_OPS = Object.freeze({
  declare: {
    description: "Mint a new name (a facet of the story's I_AM) with its own keypair.",
    label:       "Declare name",
    args:        { soulType: { type: "string", label: "Soul", required: false } },
    handler:     declareHandler,
  },
  connect: {
    description: "Bind the name to a session (the identity-layer be:connect); folds connected on its reel.",
    label:       "Connect name",
    args:        {},
    handler:     connectNameHandler,
  },
  release: {
    description: "Release the name from its session (the name's be:release); folds released on its reel.",
    label:       "Release name",
    args:        {},
    handler:     releaseNameHandler,
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
