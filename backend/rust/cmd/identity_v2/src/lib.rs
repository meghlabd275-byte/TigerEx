//! Identity V2 - decentralized identifiers with real Ed25519 signatures.
//!
//! The previous implementation returned the literal `"did:tigerex:"` for every
//! identity and `verify_credential` returned true whenever both arguments were
//! non-empty, so any credential from any issuer was accepted.

use std::collections::HashMap;

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};

/// A verifiable credential signed by an issuer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Credential {
    pub subject_did: String,
    pub claim: String,
    pub issuer_did: String,
    pub signature: Vec<u8>,
}

pub struct IdentityV2Service {
    keys: HashMap<String, SigningKey>,
}

impl IdentityV2Service {
    pub fn new() -> Self {
        Self {
            keys: HashMap::new(),
        }
    }

    /// Create a new identity with its own Ed25519 key pair. The DID is derived
    /// from the public key, so it is stable and self-certifying.
    pub fn create_did(&mut self) -> String {
        let signing_key = SigningKey::generate(&mut OsRng);
        let did = did_for(&signing_key.verifying_key());
        self.keys.insert(did.clone(), signing_key);
        did
    }

    /// Issue a credential for `subject_did`, signed by `issuer_did`.
    pub fn issue_credential(
        &self,
        issuer_did: &str,
        subject_did: &str,
        claim: &str,
    ) -> Result<Credential, String> {
        let signing_key = self
            .keys
            .get(issuer_did)
            .ok_or_else(|| format!("unknown issuer: {issuer_did}"))?;

        let payload = credential_payload(subject_did, claim);
        let signature = signing_key.sign(&payload).to_bytes().to_vec();

        Ok(Credential {
            subject_did: subject_did.to_string(),
            claim: claim.to_string(),
            issuer_did: issuer_did.to_string(),
            signature,
        })
    }

    /// Verify a credential against the issuer's public key. Fails closed.
    pub fn verify_credential(&self, credential: &Credential) -> bool {
        let Some(issuer_key) = self.keys.get(&credential.issuer_did) else {
            return false;
        };
        let Ok(signature) = Signature::from_slice(&credential.signature) else {
            return false;
        };

        let payload = credential_payload(&credential.subject_did, &credential.claim);
        issuer_key
            .verifying_key()
            .verify(&payload, &signature)
            .is_ok()
    }
}

impl Default for IdentityV2Service {
    fn default() -> Self {
        Self::new()
    }
}

fn did_for(verifying_key: &VerifyingKey) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifying_key.as_bytes());
    format!("did:tigerex:{}", hex::encode(hasher.finalize()))
}

fn credential_payload(subject_did: &str, claim: &str) -> Vec<u8> {
    let mut payload = Vec::with_capacity(subject_did.len() + claim.len() + 1);
    payload.extend_from_slice(subject_did.as_bytes());
    payload.push(0);
    payload.extend_from_slice(claim.as_bytes());
    payload
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dids_are_unique_and_well_formed() {
        let mut svc = IdentityV2Service::new();
        let a = svc.create_did();
        let b = svc.create_did();

        assert!(a.starts_with("did:tigerex:"));
        assert_ne!(a, b);
    }

    #[test]
    fn valid_credential_verifies() {
        let mut svc = IdentityV2Service::new();
        let issuer = svc.create_did();
        let subject = svc.create_did();

        let cred = svc
            .issue_credential(&issuer, &subject, "kyc_level=2")
            .unwrap();
        assert!(svc.verify_credential(&cred));
    }

    #[test]
    fn tampered_claim_or_unknown_issuer_is_rejected() {
        let mut svc = IdentityV2Service::new();
        let issuer = svc.create_did();
        let subject = svc.create_did();
        let cred = svc
            .issue_credential(&issuer, &subject, "kyc_level=2")
            .unwrap();

        let mut forged = cred.clone();
        forged.claim = "kyc_level=3".to_string();
        assert!(!svc.verify_credential(&forged));

        let mut impostor = cred.clone();
        impostor.issuer_did = "did:tigerex:unknown".to_string();
        assert!(!svc.verify_credential(&impostor));
    }

    #[test]
    fn empty_credentials_are_not_accepted() {
        let svc = IdentityV2Service::new();
        let cred = Credential {
            subject_did: "did:tigerex:anyone".to_string(),
            claim: "anything".to_string(),
            issuer_did: "did:tigerex:anyone".to_string(),
            signature: Vec::new(),
        };
        // The old implementation returned true for any non-empty strings.
        assert!(!svc.verify_credential(&cred));
    }
}
