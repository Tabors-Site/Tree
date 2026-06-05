// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// identity.js — public surface for the being-identity primitives.
//
// The actual code lives in identity/, one file per concern:
//
//   identity/lookups.js      read-side: findIAm, iAmIdentity,
//                            findRootOperator, isFirstBeing,
//                            findBeingByName
//   identity/credentials.js  password + JWT: verifyPassword,
//                            generateToken, signInternalToken,
//                            decodeToken, verifyTokenStrict
//   identity/birth.js        minting: birthBeing, generateUniqueName
//
// This file is a thin re-export so the legacy import path
// (`from "../materials/being/identity.js"`) keeps working. New code
// can import the per-concern file directly:
//
//   import { findBeingByName } from "../materials/being/identity/lookups.js";
//   import { verifyPassword }  from "../materials/being/identity/credentials.js";
//   import { birthBeing }      from "../materials/being/identity/birth.js";
//
// Or use this aggregator — same exports either way.
//
// birthBeing is the single public birth function (locked 2026-06-04).
// The earlier triad (createBeing / createBeingWithHome / createFirstBeing)
// collapsed into it; callers that need a fresh home space create it
// themselves with do:create-space before calling birthBeing.

export {
  findIAm,
  iAmIdentity,
  findRootOperator,
  isFirstBeing,
  findBeingByName,
} from "./identity/lookups.js";

export {
  verifyPassword,
  generateToken,
  signInternalToken,
  decodeToken,
  verifyTokenStrict,
  encryptCredential,
  decryptCredential,
  mintCredentialSpec,
} from "./identity/credentials.js";

export {
  birthBeing,
  generateUniqueName,
} from "./identity/birth.js";
