// credential — the credential crypto floor (port of seed/materials/name/credentials.js). The at-rest
// secret encryption (a Name's system-encrypted private key, the auto-generated being password in
// qualities.auth.credentialPlain) + password hashing/verification. Byte-compatible with the on-disk
// JS blobs:
//
//   credential_key(JWT_SECRET) = HKDF-SHA256(secret, salt="", info="treeos.credential.v1") -> 32 bytes
//   encrypt_credential(pt, key) = base64( iv(12) || tag(16) || ct )        (AES-256-GCM)
//   hash_password(pt)           = "scrypt$N$r$p$<saltB64>$<keyB64>"         (N=16384,r=8,p=1,len=64)
//   verify_password(pt, stored) = re-derive with the stored params, timing-safe compare
//
// The edge holds JWT_SECRET (like the story key); treehost resolvers + the seal call these.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine};
use hkdf::Hkdf;
use scrypt::{scrypt, Params};
use sha2::Sha256;
use subtle::ConstantTimeEq;

const CREDENTIAL_INFO: &[u8] = b"treeos.credential.v1";
const PW_N: u32 = 16384;
const PW_R: u32 = 8;
const PW_P: u32 = 1;
const PW_KEYLEN: usize = 64;

/// The at-rest credential AES key: HKDF-SHA256(JWT_SECRET, salt="", info="treeos.credential.v1") -> 32
/// bytes. The info label binds the key to the credential use case (so a JWT signed with the same secret
/// is never mistaken for a credential blob).
pub fn credential_key(jwt_secret: &str) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, jwt_secret.as_bytes()); // salt None == empty salt (JS Buffer.alloc(0))
    let mut key = [0u8; 32];
    hk.expand(CREDENTIAL_INFO, &mut key).expect("hkdf expand 32");
    key
}

/// Encrypt an at-rest secret with the credential key -> base64( iv(12) || tag(16) || ct ).
pub fn encrypt_credential(plaintext: &str, key: &[u8; 32]) -> Result<String, String> {
    if plaintext.is_empty() {
        return Err("encryptCredential: plaintext required".to_string());
    }
    let mut iv = [0u8; 12];
    getrandom::getrandom(&mut iv).map_err(|e| e.to_string())?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let ct_and_tag = cipher.encrypt(Nonce::from_slice(&iv), plaintext.as_bytes()).map_err(|_| "encryption failed".to_string())?;
    let (ct, tag) = ct_and_tag.split_at(ct_and_tag.len() - 16);
    let mut out = Vec::with_capacity(28 + ct.len());
    out.extend_from_slice(&iv);
    out.extend_from_slice(tag);
    out.extend_from_slice(ct);
    Ok(STANDARD.encode(out))
}

/// Decrypt a credential blob -> the plaintext, or None on a malformed blob / wrong key (never errors).
pub fn decrypt_credential(blob: &str, key: &[u8; 32]) -> Option<String> {
    if blob.is_empty() {
        return None;
    }
    let buf = STANDARD.decode(blob).ok()?;
    if buf.len() < 28 {
        return None;
    }
    let (iv, tag, ct) = (&buf[0..12], &buf[12..28], &buf[28..]);
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let mut ct_and_tag = ct.to_vec();
    ct_and_tag.extend_from_slice(tag);
    let plain = cipher.decrypt(Nonce::from_slice(iv), ct_and_tag.as_slice()).ok()?;
    String::from_utf8(plain).ok()
}

/// Hash a password: scrypt(N=16384,r=8,p=1,keylen=64) -> the self-describing `scrypt$N$r$p$saltB64$keyB64`.
pub fn hash_password(plaintext: &str) -> Result<String, String> {
    let mut salt = [0u8; 16];
    getrandom::getrandom(&mut salt).map_err(|e| e.to_string())?;
    let mut key = [0u8; PW_KEYLEN];
    let params = Params::new(14, PW_R, PW_P, PW_KEYLEN).map_err(|e| e.to_string())?; // log_n=14 == N=16384
    scrypt(plaintext.as_bytes(), &salt, &params, &mut key).map_err(|e| e.to_string())?;
    Ok(format!("scrypt${PW_N}${PW_R}${PW_P}${}${}", STANDARD.encode(salt), STANDARD.encode(key)))
}

/// Verify a password against a stored `scrypt$N$r$p$salt$key` hash, timing-safe. False (never panics)
/// on a missing/malformed hash.
pub fn verify_password(plaintext: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split('$').collect();
    if parts.len() != 6 || parts[0] != "scrypt" {
        return false;
    }
    let n: u32 = match parts[1].parse::<u32>() {
        Ok(n) if n.is_power_of_two() && n > 1 => n,
        _ => return false,
    };
    let (r, p) = match (parts[2].parse::<u32>(), parts[3].parse::<u32>()) {
        (Ok(r), Ok(p)) => (r, p),
        _ => return false,
    };
    let salt = match STANDARD.decode(parts[4]) {
        Ok(s) => s,
        _ => return false,
    };
    let expected = match STANDARD.decode(parts[5]) {
        Ok(e) => e,
        _ => return false,
    };
    let log_n = n.trailing_zeros() as u8; // N=2^log_n
    let params = match Params::new(log_n, r, p, expected.len()) {
        Ok(p) => p,
        _ => return false,
    };
    let mut key = vec![0u8; expected.len()];
    if scrypt(plaintext.as_bytes(), &salt, &params, &mut key).is_err() {
        return false;
    }
    key.ct_eq(&expected).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_round_trips() {
        let key = credential_key("test-jwt-secret");
        let blob = encrypt_credential("the-private-key-pem", &key).unwrap();
        assert_eq!(decrypt_credential(&blob, &key).as_deref(), Some("the-private-key-pem"));
        // a different secret -> a different key -> decrypt fails (None, no panic)
        let other = credential_key("other-secret");
        assert_eq!(decrypt_credential(&blob, &other), None);
        assert_eq!(decrypt_credential("not-base64!!", &key), None);
    }

    #[test]
    fn password_hash_verifies_and_rejects() {
        let h = hash_password("hunter2").unwrap();
        assert!(h.starts_with("scrypt$16384$8$1$"));
        assert!(verify_password("hunter2", &h));
        assert!(!verify_password("wrong", &h));
        assert!(!verify_password("hunter2", "not-a-hash"));
        assert!(!verify_password("hunter2", "scrypt$16384$8$1$onlyfour"));
    }
}
