// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Bundle signature — the PUBKEY half of publish.
//
// A clone bundle already carries meta.bundleHash, its own content hash
// (clone.js computeBundleHash): the CAS half. This adds the producer's
// SIGNATURE over that hash, so a receiver proves WHO vouches for the
// snapshot self-certifyingly — against the signer's pubkey id, with NO
// callback to the source story. Same self-certification the cross-
// story envelope-sig and the signed story root already give, now
// carried INSIDE the artifact rather than only on the transport.
//
// signerId is a pubkey id: the producer's NAME id (the Name's _id IS its
// pubkey — a being never signs, the Name it expresses does), or storyId
// when the story (I_AM) vouches — the story key's id, NOT the literal
// "i-am", so a foreign receiver decodes the key from the id alone. Absent
// signature => advisory-accepted (pre-signature bundles + producers with
// no local key); a PRESENT signature that fails verification is a hard
// refusal at the receiver.

// The I_AM constant (seedBeings.js). Inlined to keep this from importing
// materials/being at load time; it is a frozen doctrinal value.
const I_AM = "i-am";
const SIG_KIND = "publish-bundle";

function sigPayload(bundleHash, signerId) {
  return { kind: SIG_KIND, bundleHash, signerId };
}

/**
 * Sign a bundle's identity (meta.bundleHash) with the producer's key.
 * Attaches bundle.meta.signature = { alg, signerId, value }. Leaves the
 * bundle unsigned (no-op) when the producer has no local key. Never
 * throws on a keyless producer — an unsignable clone still travels and
 * is accepted under the transport sig.
 *
 * @param {object} bundle           a clone bundle WITH meta.bundleHash set
 * @param {string} producerBeingId  the vouching agent's BEING id (operator,
 *                                  or I_AM for a story-vouched snapshot).
 *                                  Its NAME (trueName) is resolved and is
 *                                  what actually signs — a being never signs.
 * @param {string} [history]
 */
export async function signBundle(bundle, producerBeingId, history = "0") {
  const bundleHash = bundle?.meta?.bundleHash;
  if (!bundleHash) throw new Error("signBundle: bundle.meta.bundleHash must be set first");
  // When we can't vouch (no producer, or no available key — e.g. a locked
  // human session), CLEAR any existing signature rather than leave it.
  // This is what makes re-signing after an honest edit safe: a stale sig
  // over the OLD bundleHash would otherwise fail the receiver's gate. No
  // signature → unsigned-advisory; a present one always matches the hash.
  if (!producerBeingId) { delete bundle.meta.signature; return bundle; }

  // The NAME is the signer. A being never signs — it expresses a trueName
  // whose key signs. I_AM's name id is the literal "i-am" (loadSigningKey
  // maps it to the story key). Any other producer is a BEING id (a content
  // hash, NOT a key after the split), so resolve its trueName; signing with
  // the bare beingId would silently produce an unsigned bundle (loadSigningKey
  // returns null for a non-key id).
  let nameId;
  if (producerBeingId === I_AM) {
    nameId = I_AM;
  } else {
    const { loadOrFold } = await import("../../materials/projections.js");
    const slot = await loadOrFold("being", String(producerBeingId), history);
    nameId = slot?.state?.trueName || null;
  }
  if (!nameId) { delete bundle.meta.signature; return bundle; }

  const { loadSigningKey } = await import("../../past/act/actSig.js");
  const pem = await loadSigningKey(nameId, history);
  if (!pem) { delete bundle.meta.signature; return bundle; }
  // signerId is the pubkey id the sig verifies against. For I_AM the
  // signing key IS the story key, whose id is storyId (a key id);
  // any other Name's id already IS its pubkey.
  let signerId = nameId;
  if (nameId === I_AM) {
    const { getStoryIdentity } = await import("../../storyIdentity.js");
    signerId = getStoryIdentity().storyId;
  }
  const { signAsName } = await import("../../materials/name/keys.js");
  bundle.meta.signature = {
    alg: "ed25519",
    signerId,
    value: signAsName(pem, sigPayload(bundleHash, signerId)),
  };
  return bundle;
}

/**
 * Verify a bundle's signature self-certifyingly against
 * meta.signature.signerId (a pubkey id). Returns { ok, signerId, reason }:
 *   - no signature        → ok:true  "unsigned-advisory"
 *   - missing bundleHash   → ok:false "no-bundleHash"
 *   - signer not a key id  → ok:false "signer-not-keyid"
 *   - present + valid       → ok:true  "verified"
 *   - present + invalid     → ok:false "bad-sig"
 *
 * Binds the signature to whatever bundleHash the bundle CLAIMS; the
 * content-integrity gate (graft recomputes bundleHash from the content)
 * is what ties that claim to the actual bytes. The two together prove
 * "this content (hash) AND this producer (sig) — both checkable".
 */
export async function verifyBundleSig(bundle) {
  const sig = bundle?.meta?.signature;
  if (!sig?.value) return { ok: true, signerId: null, reason: "unsigned-advisory" };
  const bundleHash = bundle?.meta?.bundleHash;
  if (!bundleHash) return { ok: false, signerId: sig.signerId || null, reason: "no-bundleHash" };
  const { isKeyId, verifyNameSig } = await import("../../materials/name/keys.js");
  if (!isKeyId(sig.signerId)) return { ok: false, signerId: sig.signerId || null, reason: "signer-not-keyid" };
  const ok = verifyNameSig(sig.signerId, sigPayload(bundleHash, sig.signerId), sig.value);
  return { ok, signerId: sig.signerId, reason: ok ? "verified" : "bad-sig" };
}
