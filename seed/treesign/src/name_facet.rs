// name_facet.rs — A NAME AS A FACET OF I. A Name is not an independent key you carry between stories; it
// is a facet of the story's I. Its OWN ed25519 keypair (own private + public — it signs its own acts) is
// DERIVED from the story's I seed + the name via HKDF-SHA256, so it is MATHEMATICALLY BOUND to this I:
// same (I, name) always yields the same Name key on any host, and the I seed is NOT recoverable from the
// child. A story validates its Names by RE-DERIVING (`is_name_facet_of`) — a key minted under another I
// fails, so a Name CANNOT be transported to another story. This is the crypto root of "a Name is a facet
// of I" (the self-referential substrate: every identity a face of the one I).
//
// The password is NOT part of this derivation (per Tabor, "I + Name"); it stays a separate LOGIN gate
// over the derived key (Model B). Distinct from the BIP39 story/import key — those keys ARE the I, or log
// you into a Name; THIS derives the facets a story mints from its I.

use hkdf::Hkdf;
use sha2::Sha256;

use crate::sign::{keypair_from_seed, Keypair};

/// Versioned HKDF `info` prefix, so the facet derivation can evolve without colliding with any other use
/// of the I seed.
const FACET_INFO_PREFIX: &[u8] = b"treeos-name-facet:v1:";

/// Derive a Name's own keypair as a facet of the story `story_seed` (the I seed). Deterministic + one-way.
pub fn derive_name_keypair(story_seed: &[u8; 32], name: &str) -> Keypair {
    // ikm = the story's secret I seed; info = a versioned tag + the name; salt None (ikm already secret,
    // mirroring credential.rs). HKDF is one-way: the I seed cannot be recovered from the child.
    let hk = Hkdf::<Sha256>::new(None, story_seed);
    let mut info = Vec::with_capacity(FACET_INFO_PREFIX.len() + name.len());
    info.extend_from_slice(FACET_INFO_PREFIX);
    info.extend_from_slice(name.as_bytes());
    let mut child = [0u8; 32];
    hk.expand(&info, &mut child).expect("32 is a valid HKDF-SHA256 output length");
    keypair_from_seed(&child)
}

/// True iff `name_id` is the public key the Name `name` derives to under THIS story's I — a genuine facet
/// of this I, not a key minted elsewhere. Only the holder of the I seed can check (it re-derives). This
/// is what makes a Name non-transportable: another story re-derives with ITS I and gets a mismatch.
pub fn is_name_facet_of(story_seed: &[u8; 32], name: &str, name_id: &str) -> bool {
    derive_name_keypair(story_seed, name).name_id == name_id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facet_is_deterministic_bound_and_its_own_key() {
        let i_a = [1u8; 32]; // story A's I seed
        let i_b = [2u8; 32]; // story B's I seed

        // DETERMINISTIC: same (I, name) -> the same Name key, every time, on any host.
        let zed_a = derive_name_keypair(&i_a, "Zed");
        assert_eq!(zed_a.name_id, derive_name_keypair(&i_a, "Zed").name_id, "same I+name -> same key");

        // ITS OWN keypair — distinct from the I's own key, from other names, and its seed is not the I's.
        assert_ne!(zed_a.name_id, keypair_from_seed(&i_a).name_id, "the Name has its OWN key, not the I's");
        assert_ne!(zed_a.name_id, derive_name_keypair(&i_a, "Bob").name_id, "different names -> different keys");
        assert_ne!(zed_a.seed, i_a, "the Name's private seed is NOT the I seed");

        // BOUND TO ITS I: the same name under a DIFFERENT story I is a DIFFERENT key -> not transportable.
        let zed_b = derive_name_keypair(&i_b, "Zed");
        assert_ne!(zed_a.name_id, zed_b.name_id, "same name, different I -> different Name");

        // VALIDATION: a story recognizes ITS facet by re-deriving; a foreign key is rejected.
        assert!(is_name_facet_of(&i_a, "Zed", &zed_a.name_id), "A recognizes its own Zed");
        assert!(!is_name_facet_of(&i_b, "Zed", &zed_a.name_id), "B rejects A's Zed (a transported key fails)");
    }
}
