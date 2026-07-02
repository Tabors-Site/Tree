// jwt — HS256 session tokens (port of materials/being/identity/credentials.js signJwtHS256 /
// verifyJwtHS256). A symmetric token is just `base64url(header).base64url(body).base64url(HMAC-SHA256)`
// — no JWT dependency. The body is serialized with treehash::stringify (== JSON.stringify, insertion
// order), so the bytes — and therefore the signature — match the JS signer.
//
// TIME is an INPUT, not a dependency: `iat`/`exp` (unix seconds) are supplied by the EDGE (the binary's
// wall clock); treesign stays clock-free. Verify timing-safe-compares the signature over the RECEIVED
// header.body strings, so a JS-minted token verifies byte-for-byte.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use treehash::{stringify, Json};

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn b64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}
fn hmac_sha256(data: &str, secret: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("hmac accepts any key length");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// Mint an HS256 JWT. `iat` (issued-at, unix seconds) + optional `exp` are folded into the payload (the
/// edge supplies the clock). Byte-identical to the JS signJwtHS256.
pub fn sign_jwt_hs256(payload: &Json, secret: &str, iat: i64, exp: Option<i64>) -> String {
    let header = Json::Obj(vec![("alg".to_string(), Json::Str("HS256".to_string())), ("typ".to_string(), Json::Str("JWT".to_string()))]);
    // body = { ...payload, iat[, exp] } — payload keys first (their order), then iat, then exp.
    let mut body: Vec<(String, Json)> = match payload {
        Json::Obj(e) => e.clone(),
        _ => Vec::new(),
    };
    body.push(("iat".to_string(), Json::Num(iat as f64)));
    if let Some(e) = exp {
        body.push(("exp".to_string(), Json::Num(e as f64)));
    }
    let data = format!("{}.{}", b64url(stringify(&header).as_bytes()), b64url(stringify(&Json::Obj(body)).as_bytes()));
    let sig = b64url(&hmac_sha256(&data, secret));
    format!("{data}.{sig}")
}

/// Verify an HS256 JWT: timing-safe signature (over the received header.body strings) + expiry against
/// `now` (unix seconds). Returns the decoded body, or None (malformed / bad signature / expired).
pub fn verify_jwt_hs256(token: &str, secret: &str, now: i64) -> Option<Json> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let expected = hmac_sha256(&format!("{}.{}", parts[0], parts[1]), secret);
    let got = URL_SAFE_NO_PAD.decode(parts[2]).ok()?;
    if got.len() != expected.len() || !bool::from(got.ct_eq(&expected)) {
        return None;
    }
    let body = decode_part(parts[1])?;
    if let Some(Json::Num(exp)) = get(&body, "exp") {
        if now >= *exp as i64 {
            return None; // expired
        }
    }
    Some(body)
}

/// Cheap parse of the body claims — NO signature/expiry check (never errors). For reading a token's
/// beingId/nameId before a DB lookup (decodeToken).
pub fn decode_jwt(token: &str) -> Option<Json> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    decode_part(parts[1])
}

fn decode_part(b64: &str) -> Option<Json> {
    let bytes = URL_SAFE_NO_PAD.decode(b64).ok()?;
    treehash::parse(&String::from_utf8(bytes).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload() -> Json {
        Json::Obj(vec![("beingId".to_string(), Json::Str("b1".to_string())), ("nameId".to_string(), Json::Str("alice".to_string()))])
    }

    fn field(v: &Json, k: &str) -> Option<String> {
        get(v, k).map(treehash::canonicalize)
    }

    #[test]
    fn sign_then_verify_round_trips() {
        let t = sign_jwt_hs256(&payload(), "secret", 1_700_000_000, Some(1_700_000_600));
        let body = verify_jwt_hs256(&t, "secret", 1_700_000_100).expect("valid");
        assert_eq!(field(&body, "beingId").as_deref(), Some("\"b1\""));
        assert_eq!(field(&body, "iat").as_deref(), Some("1700000000")); // integer, no decimal
        // wrong secret -> None; expired (now >= exp) -> None
        assert!(verify_jwt_hs256(&t, "wrong", 1_700_000_100).is_none());
        assert!(verify_jwt_hs256(&t, "secret", 1_700_000_600).is_none());
        // decode reads the body without verifying
        assert_eq!(field(&decode_jwt(&t).unwrap(), "nameId").as_deref(), Some("\"alice\""));
    }

    #[test]
    fn malformed_is_none() {
        assert!(verify_jwt_hs256("a.b", "s", 0).is_none());
        assert!(decode_jwt("not-a-token").is_none());
    }
}
