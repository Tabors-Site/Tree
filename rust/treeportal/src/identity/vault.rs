// identity/vault.rs — the client-held NAME vault. A NAME is the higher identity: an ed25519 keypair
// (nameId = z<pubkey>), the wallet that SIGNS. (A Being holds no key — it's an avatar a Name inhabits
// inside a history; beings live server-side, owned by a Name via trueName == nameId.) The vault holds
// the Name SEED; the active Name signs acts + proves its key at the moment. Generate (24-word mnemonic),
// or import (mnemonic / PKCS8 PEM). (P1 is in-memory; password-encrypt-at-rest via treesign::password_lock
// is a small follow-up.)

pub struct Name {
    pub label: String, // a human handle for this Name in the UI
    pub name_id: String,
    pub seed: [u8; 32],
    /// the 24 words, shown ONCE right after generate (write them down); never persisted in the clear.
    pub mnemonic: Option<String>,
}

#[derive(Default)]
pub struct Vault {
    pub names: Vec<Name>,
    pub active: Option<usize>,
}

impl Vault {
    pub fn active_name(&self) -> Option<&Name> {
        self.active.and_then(|i| self.names.get(i))
    }

    /// Mint a fresh NAME: a new 24-word key. Returns the mnemonic to show once (on the new active Name).
    pub fn generate(&mut self, label: &str) -> Result<(), String> {
        let mnemonic = treesign::generate_mnemonic().map_err(|_| "could not generate a key".to_string())?;
        let seed = treesign::mnemonic_to_seed(&mnemonic, None).map_err(|_| "could not derive a seed".to_string())?;
        self.push(label, seed, Some(mnemonic));
        Ok(())
    }

    /// Import an existing Name from its 24-word phrase.
    pub fn import_mnemonic(&mut self, label: &str, phrase: &str) -> Result<(), String> {
        let seed = treesign::mnemonic_to_seed(phrase.trim(), None).map_err(|_| "not a valid 24-word phrase".to_string())?;
        self.push(label, seed, None);
        Ok(())
    }

    /// Import an existing Name from a PKCS8 ed25519 PEM.
    pub fn import_pem(&mut self, label: &str, pem: &str) -> Result<(), String> {
        let seed = treesign::seed_from_pkcs8_pem(pem.trim()).map_err(|_| "not a valid PKCS8 ed25519 PEM".to_string())?;
        self.push(label, seed, None);
        Ok(())
    }

    fn push(&mut self, label: &str, seed: [u8; 32], mnemonic: Option<String>) {
        let kp = treesign::keypair_from_seed(&seed);
        let label = if label.trim().is_empty() { short(&kp.name_id) } else { label.trim().to_string() };
        self.names.push(Name { label, name_id: kp.name_id, seed, mnemonic });
        self.active = Some(self.names.len() - 1);
    }

    /// Unlock a Name from its ENCRYPTED key blob (fetched from the story via a name-key moment) using the
    /// password — decrypted CLIENT-SIDE (the password never touched the wire). Wrong password → decrypt
    /// fails → "wrong password".
    pub fn unlock_with_password(&mut self, label: &str, blob: &str, password: &str) -> Result<(), String> {
        let pem = treesign::decrypt_with_password(blob, password).ok_or_else(|| "wrong password".to_string())?;
        let seed = treesign::seed_from_pkcs8_pem(&pem).map_err(|_| "the stored key is malformed".to_string())?;
        self.push(label, seed, None);
        Ok(())
    }

    /// The active Name's key, ENCRYPTED with a password — the `pw:` blob to store in the story
    /// (name:declare / set-password). Used to register a Name or set/change its password.
    pub fn encrypted_blob(&self, password: &str) -> Option<String> {
        let n = self.active_name()?;
        let pem = treesign::seed_to_pkcs8_pem(&n.seed);
        treesign::encrypt_with_password(&pem, password).ok()
    }

    /// Sign the moment proof for the active Name (the key-proof the server checks at the moment).
    pub fn sign_moment(&self, name_id: &str, req: &treehash::Json) -> Option<String> {
        let n = self.active_name()?;
        if n.name_id != name_id {
            return None;
        }
        Some(treesign::sign_moment_proof(&n.seed, name_id, req))
    }
}

fn short(id: &str) -> String {
    if id.len() > 10 {
        format!("{}…", &id[..8])
    } else {
        id.to_string()
    }
}
