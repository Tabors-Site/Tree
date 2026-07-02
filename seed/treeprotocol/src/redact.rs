// treeprotocol::redact — strip secrets from anything about to leave the server (port of
// seed/materials/redact.js). Two boundaries:
//   redact_secrets   — SERIALIZE-OUT: replace secret leaves with "[redacted]", KEEP one-time reveals
//                       (the asker needs them). Applied to every wire view (a moment's folded state, an
//                       act's facts) so qualities.llmConnections.encryptedApiKey / password /
//                       credentialPlain never leave cleartext.
//   strip_for_audit  — AUDIT-RECORD: OMIT secrets AND one-time reveals (gone, not "[redacted]"), so a
//                       durable audit fact never carries cleartext credentials/keys/tokens.
//
// Json is a plain tree (no Maps/Dates/cycles), so the port drops the JS's WeakSet + Date/RegExp/BSON
// special-cases.

use treehash::Json;

const REDACTED: &str = "[redacted]";

/// Secret leaf keys — redacted wherever they appear by name.
const SECRET_KEYS: &[&str] = &["encryptedApiKey", "apiKey", "credentialPlain", "privateKeyEnc", "password"];

/// One-time secret RETURNS to the asker — kept on serialize-out, OMITTED from audit.
const REVEAL_KEYS: &[&str] = &["plaintext", "privateKeyPem", "mnemonic", "identityToken", "token"];

/// A `set-<kind>` fact whose `field` names a secret path has its sibling `value` redacted (the secret
/// rides in `value`, not under a secret key).
fn is_secret_field_path(field: &str) -> bool {
    field == "password"
        || field.starts_with("qualities.llmConnections")
        || field.starts_with("qualities.auth")
        || field.ends_with(".encryptedApiKey")
        || field.ends_with(".credentialPlain")
        || field.ends_with(".privateKeyEnc")
}

/// A deep copy with secret leaves replaced by "[redacted]"; one-time reveals are kept (the asker needs
/// them). Never mutates.
pub fn redact_secrets(v: &Json) -> Json {
    match v {
        Json::Arr(a) => Json::Arr(a.iter().map(redact_secrets).collect()),
        Json::Obj(e) => {
            let field_is_secret = e.iter().any(|(k, val)| k == "field" && matches!(val, Json::Str(s) if is_secret_field_path(s)));
            Json::Obj(
                e.iter()
                    .map(|(k, val)| {
                        if SECRET_KEYS.contains(&k.as_str()) {
                            (k.clone(), Json::Str(REDACTED.to_string()))
                        } else if k == "value" && field_is_secret {
                            (k.clone(), Json::Str(REDACTED.to_string()))
                        } else {
                            (k.clone(), redact_secrets(val))
                        }
                    })
                    .collect(),
            )
        }
        other => other.clone(),
    }
}

/// A deep copy with secrets AND one-time reveals OMITTED (and top-level `_`-prefixed transport keys),
/// for the durable audit record. Never mutates.
pub fn strip_for_audit(v: &Json) -> Json {
    strip(v, true)
}
fn strip(v: &Json, top: bool) -> Json {
    let omit = |k: &str| SECRET_KEYS.contains(&k) || REVEAL_KEYS.contains(&k) || (top && k.starts_with('_'));
    match v {
        Json::Arr(a) => Json::Arr(a.iter().map(|x| strip(x, false)).collect()),
        Json::Obj(e) => Json::Obj(e.iter().filter(|(k, _)| !omit(k)).map(|(k, val)| (k.clone(), strip(val, false))).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use treehash::canonicalize;

    fn p(s: &str) -> Json {
        treehash::parse(s).unwrap()
    }

    #[test]
    fn redacts_secret_leaves_keeps_reveals() {
        let v = p(r#"{"name":"alice","password":"hash","qualities":{"llmConnections":{"c1":{"encryptedApiKey":"sk-xxx","model":"gpt"}},"auth":{"credentialPlain":"blob"}},"plaintext":"once-reveal"}"#);
        let out = canonicalize(&redact_secrets(&v));
        assert!(out.contains(r#""password":"[redacted]""#));
        assert!(out.contains(r#""encryptedApiKey":"[redacted]""#));
        assert!(out.contains(r#""credentialPlain":"[redacted]""#));
        assert!(out.contains(r#""model":"gpt""#)); // non-secret kept
        assert!(out.contains(r#""plaintext":"once-reveal""#)); // reveal KEPT on serialize-out
    }

    #[test]
    fn redacts_value_under_a_secret_field_path() {
        // a set-being fact: { field: "password", value: <hash> } — the secret rides in `value`
        let f = p(r#"{"field":"password","value":"the-hash"}"#);
        assert!(canonicalize(&redact_secrets(&f)).contains(r#""value":"[redacted]""#));
        let f2 = p(r#"{"field":"qualities.llmConnections.c1","value":{"encryptedApiKey":"k"}}"#);
        assert!(canonicalize(&redact_secrets(&f2)).contains(r#""value":"[redacted]""#));
        // a non-secret field leaves value alone
        let ok = p(r#"{"field":"name","value":"alice"}"#);
        assert!(canonicalize(&redact_secrets(&ok)).contains(r#""value":"alice""#));
    }

    #[test]
    fn audit_omits_secrets_and_reveals() {
        let v = p(r#"{"ok":true,"password":"h","plaintext":"r","token":"t","_factTarget":"x","name":"a"}"#);
        let out = canonicalize(&strip_for_audit(&v));
        assert!(!out.contains("password") && !out.contains("plaintext") && !out.contains("token") && !out.contains("_factTarget"));
        assert!(out.contains(r#""name":"a""#) && out.contains(r#""ok":true"#));
    }
}
