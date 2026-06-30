// identity/vault.rs — the client-held key vault. A being's key is client-side (not custodial): the
// vault generates (24-word mnemonic) or imports (mnemonic / PKCS8 PEM) a being's seed via treesign, and
// the active being's seed signs acts client-side. Per-being tabs are the vault's loaded beings. (P4 is
// in-memory; password-encrypt-at-rest + persistence reuse treesign::password_lock — a small follow-up.)

pub struct Being {
    pub name: String,
    pub key_id: String,
    pub seed: [u8; 32],
    /// the 24 words, shown ONCE right after generate (write them down); never persisted in the clear.
    pub mnemonic: Option<String>,
}

#[derive(Default)]
pub struct Vault {
    pub beings: Vec<Being>,
    pub active: usize,
}

impl Vault {
    pub fn active_being(&self) -> Option<&Being> {
        self.beings.get(self.active)
    }

    /// Mint a fresh being: a new 24-word key. Returns the mnemonic to show once.
    pub fn generate(&mut self, name: &str) -> Result<(), String> {
        let mnemonic = treesign::generate_mnemonic().map_err(|_| "could not generate a key".to_string())?;
        let seed = treesign::mnemonic_to_seed(&mnemonic, None).map_err(|_| "could not derive a seed".to_string())?;
        self.push(name, seed, Some(mnemonic));
        Ok(())
    }

    /// Import an existing being from its 24-word phrase.
    pub fn import_mnemonic(&mut self, name: &str, phrase: &str) -> Result<(), String> {
        let seed = treesign::mnemonic_to_seed(phrase.trim(), None).map_err(|_| "not a valid 24-word phrase".to_string())?;
        self.push(name, seed, None);
        Ok(())
    }

    /// Import an existing being from a PKCS8 ed25519 PEM.
    pub fn import_pem(&mut self, name: &str, pem: &str) -> Result<(), String> {
        let seed = treesign::seed_from_pkcs8_pem(pem.trim()).map_err(|_| "not a valid PKCS8 ed25519 PEM".to_string())?;
        self.push(name, seed, None);
        Ok(())
    }

    fn push(&mut self, name: &str, seed: [u8; 32], mnemonic: Option<String>) {
        let kp = treesign::keypair_from_seed(&seed);
        self.beings.push(Being { name: name.to_string(), key_id: kp.name_id, seed, mnemonic });
        self.active = self.beings.len() - 1;
    }

    /// Sign a canonical payload with the active being's seed (client-side act signing). None if no being.
    pub fn sign(&self, payload_json: &str) -> Option<String> {
        let b = self.active_being()?;
        treesign::sign_payload(&b.seed, payload_json)
    }
}
