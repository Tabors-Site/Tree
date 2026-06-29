// password_lock — encrypt a Name's private key with a key derived from its PASSWORD (port of
// seed/materials/name/passwordKey.js). The OPTIONAL easier-access layer: with a password set, the
// privateKeyEnc decrypts only on login (name + password); the server cannot auto-decrypt it.
//
//   scrypt(password, salt) -> 32-byte key  (N=2^14, r=8, p=1)
//   AES-256-GCM over the PEM
//   blob = "pw:<saltHex>:<ivHex>:<tagHex>:<ctHex>"  (self-identifying: the "pw:" prefix routes a
//          password-locked Name through the session instead of the system decrypt)
//
// Byte-compatible with the on-disk JS blob: same scrypt params, same AES-256-GCM, 16-byte salt,
// 12-byte iv, 16-byte tag, lowercase hex, ct and tag stored separately (the aead crate appends the tag;
// we split it out to match Node's getAuthTag()).

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use scrypt::{scrypt, Params};

const PREFIX: &str = "pw:";

/// scrypt(password, salt) -> 32 bytes, with the JS SCRYPT cost params (N=16384, r=8, p=1, keylen=32).
fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    let params = Params::new(14, 8, 1, 32).expect("scrypt params (log_n=14, r=8, p=1, len=32)");
    scrypt(password.as_bytes(), salt, &params, &mut key).expect("scrypt derivation");
    key
}

/// Encrypt a private-key PEM with a key derived from `password` -> the self-identifying `pw:` blob.
pub fn encrypt_with_password(plain_pem: &str, password: &str) -> Result<String, String> {
    if plain_pem.is_empty() {
        return Err("encryptWithPassword: plainPem required".to_string());
    }
    if password.is_empty() {
        return Err("encryptWithPassword: password required".to_string());
    }
    let mut salt = [0u8; 16];
    let mut iv = [0u8; 12];
    getrandom::getrandom(&mut salt).map_err(|e| e.to_string())?;
    getrandom::getrandom(&mut iv).map_err(|e| e.to_string())?;
    let key = derive_key(password, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    // the aead crate returns ciphertext||tag (16-byte tag appended); the JS blob keeps them separate.
    let ct_and_tag = cipher.encrypt(Nonce::from_slice(&iv), plain_pem.as_bytes()).map_err(|_| "encryption failed".to_string())?;
    let (ct, tag) = ct_and_tag.split_at(ct_and_tag.len() - 16);
    Ok(format!("{PREFIX}{}:{}:{}:{}", hex::encode(salt), hex::encode(iv), hex::encode(tag), hex::encode(ct)))
}

/// Decrypt a `pw:`-prefixed blob with `password` -> the PEM, or None on a wrong password / malformed
/// blob (never errors — a wrong password is an ordinary login failure).
pub fn decrypt_with_password(blob: &str, password: &str) -> Option<String> {
    let rest = blob.strip_prefix(PREFIX)?;
    if password.is_empty() {
        return None;
    }
    let parts: Vec<&str> = rest.split(':').collect();
    if parts.len() != 4 {
        return None;
    }
    let salt = hex::decode(parts[0]).ok()?;
    let iv = hex::decode(parts[1]).ok()?;
    let tag = hex::decode(parts[2]).ok()?;
    let mut ct = hex::decode(parts[3]).ok()?;
    if iv.len() != 12 || tag.len() != 16 {
        return None;
    }
    let key = derive_key(password, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).ok()?;
    ct.extend_from_slice(&tag); // re-join ct||tag for the aead crate
    let plain = cipher.decrypt(Nonce::from_slice(&iv), ct.as_slice()).ok()?;
    String::from_utf8(plain).ok()
}

/// True if a privateKeyEnc blob is password-locked (the `pw:` prefix) vs system-encrypted.
pub fn is_password_locked(blob: &str) -> bool {
    blob.starts_with(PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_is_self_identifying() {
        let pem = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIabc\n-----END PRIVATE KEY-----\n";
        let blob = encrypt_with_password(pem, "hunter2").unwrap();
        assert!(blob.starts_with("pw:") && is_password_locked(&blob));
        // shape: pw:salt(32hex):iv(24hex):tag(32hex):ct(...)
        let parts: Vec<&str> = blob.trim_start_matches("pw:").split(':').collect();
        assert_eq!(parts.len(), 4);
        assert_eq!(parts[0].len(), 32); // 16-byte salt
        assert_eq!(parts[1].len(), 24); // 12-byte iv
        assert_eq!(parts[2].len(), 32); // 16-byte tag
        assert_eq!(decrypt_with_password(&blob, "hunter2").as_deref(), Some(pem));
    }

    #[test]
    fn wrong_password_and_malformed_return_none() {
        let blob = encrypt_with_password("secret-pem", "right").unwrap();
        assert_eq!(decrypt_with_password(&blob, "wrong"), None);
        assert_eq!(decrypt_with_password(&blob, ""), None);
        assert_eq!(decrypt_with_password("not-a-pw-blob", "right"), None);
        assert_eq!(decrypt_with_password("pw:zz:zz:zz", "right"), None); // wrong part count
        assert!(!is_password_locked("sys:encrypted"));
    }

    #[test]
    fn re_encrypt_changes_blob_not_plaintext() {
        // changing the password (or re-encrypting) yields a fresh salt+iv -> a different blob, same PEM.
        let pem = "the-pem";
        let a = encrypt_with_password(pem, "p1").unwrap();
        let b = encrypt_with_password(pem, "p1").unwrap();
        assert_ne!(a, b); // fresh randomness each time
        assert_eq!(decrypt_with_password(&a, "p1").as_deref(), Some(pem));
        assert_eq!(decrypt_with_password(&b, "p1").as_deref(), Some(pem));
    }
}
