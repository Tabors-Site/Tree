// grantHost.js — host env for grant-able.word's ONE escape:
//   able-exists(able) — the able-registry lookup (getAble); a able can't be granted unless
//                       it's registered. A bounded compute / fold READ, not a clock or chain
//                       write. No grant-stamp: a word-sourced grant carries NO grantedAt (its
//                       WHEN is its place in the chain — the time-doctrine, no clock read), and
//                       grantedBy is the fact's SIGNER (`through`), not a host-assembled record.
import { getAble } from "../../../present/ables/registry.js";

export function grantHostEnv() {
  return {
    // able-exists(able) — the able-registry lookup (getAble); a genuine fold READ. The ONLY
    // see grant-able needs. The grant record is NOT assembled here: it's the fact's own
    // params (able + anchor), its SIGNER (grantedBy = the grantor's being, read off the
    // fact's `through` by the reducer), and its PLACE in the chain (when). No clock read.
    "able-exists": ({ args: [able] }) => !!getAble(String(able || "")),
  };
}
