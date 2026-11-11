//! WebAuthn / FIDO2 passkey verification (ES256).
//!
//! This is a real assertion verifier: it parses the credential public key from
//! the CBOR-encoded COSE_Key produced at registration, checks the
//! `clientDataJSON` challenge and origin, checks the RP ID hash, verifies the
//! ECDSA (ES256 / NIST P-256) signature over
//! `authenticatorData || SHA256(clientDataJSON)`, and enforces the signature
//! counter to detect cloned authenticators. It deliberately fails closed on any
//! malformed input rather than accepting an unverified assertion.

use base64::Engine;
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// Errors that cause an assertion to be rejected.
#[derive(Debug, PartialEq, Eq)]
pub enum WebAuthnError {
    /// The credential public key could not be parsed as a COSE EC2 P-256 key.
    BadPublicKey,
    /// The signature bytes were not valid DER.
    BadSignature,
    /// `clientDataJSON` was not valid JSON or lacked required fields.
    BadClientData,
    /// The challenge did not match the one the server issued.
    ChallengeMismatch,
    /// The origin did not match the expected RP origin.
    OriginMismatch,
    /// The RP ID hash in the authenticator data did not match.
    RpIdMismatch,
    /// The user-presence flag was not set.
    UserNotPresent,
    /// The signature did not verify.
    SignatureInvalid,
    /// The signature counter did not increase (possible cloned authenticator).
    CounterRegression,
}

const FLAG_USER_PRESENT: u8 = 0x01;
const FLAG_USER_VERIFIED: u8 = 0x04;

/// A registered credential as stored server-side.
#[derive(Debug, Clone)]
pub struct Credential {
    pub id: Vec<u8>,
    /// SEC1 uncompressed P-256 public key (0x04 || X || Y).
    pub public_key: Vec<u8>,
    pub sign_count: u32,
}

/// Parse a CBOR COSE_Key (EC2, curve P-256) and return the SEC1 public key.
///
/// The COSE EC2 structure is a map with integer keys; we require kty=2 (EC2),
/// crv=1 (P-256) and both x/y coordinates.
pub fn cose_key_to_sec1(cose: &[u8]) -> Result<Vec<u8>, WebAuthnError> {
    let mut reader = CborReader::new(cose);
    let map_len = reader.read_map_len().ok_or(WebAuthnError::BadPublicKey)?;
    let mut kty = None;
    let mut crv = None;
    let mut x = None;
    let mut y = None;
    for _ in 0..map_len {
        let key = reader.read_int().ok_or(WebAuthnError::BadPublicKey)?;
        match key {
            1 => kty = reader.read_int(),
            3 => {
                let _alg = reader.read_int();
            }
            -1 => crv = reader.read_int(),
            -2 => x = reader.read_bytes().map(|b| b.to_vec()),
            -3 => y = reader.read_bytes().map(|b| b.to_vec()),
            _ => {
                reader.skip_value().ok_or(WebAuthnError::BadPublicKey)?;
            }
        }
    }
    if kty != Some(2) || crv != Some(1) {
        return Err(WebAuthnError::BadPublicKey);
    }
    let (x, y) = (x.ok_or(WebAuthnError::BadPublicKey)?, y.ok_or(WebAuthnError::BadPublicKey)?);
    if x.len() != 32 || y.len() != 32 {
        return Err(WebAuthnError::BadPublicKey);
    }
    let mut sec1 = Vec::with_capacity(65);
    sec1.push(0x04);
    sec1.extend_from_slice(&x);
    sec1.extend_from_slice(&y);
    Ok(sec1)
}

/// Verify a WebAuthn assertion.
///
/// * `public_key` — SEC1 uncompressed key (from [`cose_key_to_sec1`]).
/// * `authenticator_data` — the raw authenticator data.
/// * `client_data_json` — the raw client data JSON.
/// * `signature_der` — the assertion signature.
/// * `expected_challenge` — the challenge the server issued (base64url text as
///   it appears in clientDataJSON).
/// * `expected_origin` — the RP origin, e.g. `https://exchange.example`.
/// * `expected_rp_id` — the RP ID, e.g. `exchange.example`.
/// * `stored_sign_count` — the counter from the previous assertion (0 if none).
///
/// Returns the new signature counter on success.
#[allow(clippy::too_many_arguments)]
pub fn verify_assertion(
    public_key: &[u8],
    authenticator_data: &[u8],
    client_data_json: &[u8],
    signature_der: &[u8],
    expected_challenge: &str,
    expected_origin: &str,
    expected_rp_id: &str,
    stored_sign_count: u32,
) -> Result<u32, WebAuthnError> {
    // --- client data ---
    let client_data: serde_json::Value =
        serde_json::from_slice(client_data_json).map_err(|_| WebAuthnError::BadClientData)?;
    let typ = client_data.get("type").and_then(|v| v.as_str());
    if typ != Some("webauthn.get") {
        return Err(WebAuthnError::BadClientData);
    }
    let challenge = client_data
        .get("challenge")
        .and_then(|v| v.as_str())
        .ok_or(WebAuthnError::BadClientData)?;
    // Constant-time compare so a mismatch leaks no timing signal.
    if challenge.as_bytes().ct_eq(expected_challenge.as_bytes()).unwrap_u8() != 1 {
        return Err(WebAuthnError::ChallengeMismatch);
    }
    let origin = client_data
        .get("origin")
        .and_then(|v| v.as_str())
        .ok_or(WebAuthnError::BadClientData)?;
    if origin != expected_origin {
        return Err(WebAuthnError::OriginMismatch);
    }

    // --- authenticator data ---
    if authenticator_data.len() < 37 {
        return Err(WebAuthnError::BadClientData);
    }
    let rp_id_hash = &authenticator_data[0..32];
    let expected_rp_hash = Sha256::digest(expected_rp_id.as_bytes());
    if rp_id_hash.ct_eq(&expected_rp_hash).unwrap_u8() != 1 {
        return Err(WebAuthnError::RpIdMismatch);
    }
    let flags = authenticator_data[32];
    if flags & FLAG_USER_PRESENT == 0 {
        return Err(WebAuthnError::UserNotPresent);
    }
    let _user_verified = flags & FLAG_USER_VERIFIED != 0;
    let sign_count = u32::from_be_bytes([
        authenticator_data[33],
        authenticator_data[34],
        authenticator_data[35],
        authenticator_data[36],
    ]);

    // --- signature over SHA256(authData || SHA256(clientDataJSON)) ---
    let client_hash = Sha256::digest(client_data_json);
    let mut signed = Vec::with_capacity(authenticator_data.len() + 32);
    signed.extend_from_slice(authenticator_data);
    signed.extend_from_slice(&client_hash);

    let verifying_key = VerifyingKey::from_sec1_bytes(public_key).map_err(|_| WebAuthnError::BadPublicKey)?;
    let signature = Signature::from_der(signature_der).map_err(|_| WebAuthnError::BadSignature)?;
    verifying_key
        .verify(&signed, &signature)
        .map_err(|_| WebAuthnError::SignatureInvalid)?;

    // --- counter: must strictly increase when the authenticator maintains one ---
    if sign_count != 0 && stored_sign_count != 0 && sign_count <= stored_sign_count {
        return Err(WebAuthnError::CounterRegression);
    }
    Ok(sign_count)
}

/// Base64url-encode a challenge for comparison against `clientDataJSON`.
pub fn encode_challenge(challenge: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(challenge)
}

// ---------------------------------------------------------------------------
// Minimal CBOR reader (only the subset needed to parse a COSE EC2 key).
// ---------------------------------------------------------------------------

struct CborReader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> CborReader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    fn read_byte(&mut self) -> Option<u8> {
        let b = *self.buf.get(self.pos)?;
        self.pos += 1;
        Some(b)
    }

    fn read_len(&mut self, info: u8) -> Option<usize> {
        match info {
            0..=23 => Some(info as usize),
            24 => Some(self.read_byte()? as usize),
            25 => {
                let b = self.take(2)?;
                Some(u16::from_be_bytes([b[0], b[1]]) as usize)
            }
            26 => {
                let b = self.take(4)?;
                Some(u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
            }
            _ => None,
        }
    }

    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        if end > self.buf.len() {
            return None;
        }
        let slice = &self.buf[self.pos..end];
        self.pos = end;
        Some(slice)
    }

    fn read_map_len(&mut self) -> Option<usize> {
        let b = self.read_byte()?;
        if b >> 5 != 5 {
            return None;
        }
        self.read_len(b & 0x1f)
    }

    fn read_int(&mut self) -> Option<i64> {
        let b = self.read_byte()?;
        let major = b >> 5;
        let info = b & 0x1f;
        let val = self.read_len(info)? as i64;
        match major {
            0 => Some(val),
            1 => Some(-1 - val),
            _ => None,
        }
    }

    fn read_bytes(&mut self) -> Option<&'a [u8]> {
        let b = self.read_byte()?;
        if b >> 5 != 2 {
            return None;
        }
        let len = self.read_len(b & 0x1f)?;
        self.take(len)
    }

    /// Skip a single CBOR value of any supported type.
    fn skip_value(&mut self) -> Option<()> {
        let b = *self.buf.get(self.pos)?;
        match b >> 5 {
            0 | 1 => {
                self.read_int()?;
            }
            2 => {
                self.read_bytes()?;
            }
            3 => {
                let b = self.read_byte()?;
                let len = self.read_len(b & 0x1f)?;
                self.take(len)?;
            }
            7 => {
                self.read_byte()?;
            }
            _ => return None,
        }
        Some(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{signature::Signer, SigningKey};

    fn build_client_data(challenge: &str, origin: &str) -> Vec<u8> {
        serde_json::json!({
            "type": "webauthn.get",
            "challenge": challenge,
            "origin": origin,
            "crossOrigin": false,
        })
        .to_string()
        .into_bytes()
    }

    fn build_auth_data(rp_id: &str, flags: u8, counter: u32) -> Vec<u8> {
        let mut data = Sha256::digest(rp_id.as_bytes()).to_vec();
        data.push(flags);
        data.extend_from_slice(&counter.to_be_bytes());
        data
    }

    #[test]
    fn valid_assertion_verifies_and_returns_counter() {
        let signing_key = SigningKey::random(&mut rand::thread_rng());
        let sec1 = signing_key.verifying_key().to_encoded_point(false);
        let origin = "https://exchange.example";
        let rp_id = "exchange.example";
        let challenge = "srv-challenge-123";
        let auth_data = build_auth_data(rp_id, FLAG_USER_PRESENT, 7);
        let client_data = build_client_data(challenge, origin);
        let client_hash = Sha256::digest(&client_data);
        let mut signed = auth_data.clone();
        signed.extend_from_slice(&client_hash);
        let sig: Signature = signing_key.sign(&signed);

        let counter = verify_assertion(
            sec1.as_bytes(),
            &auth_data,
            &client_data,
            sig.to_der().as_bytes(),
            challenge,
            origin,
            rp_id,
            5,
        )
        .unwrap();
        assert_eq!(counter, 7);
    }

    #[test]
    fn wrong_challenge_is_rejected() {
        let signing_key = SigningKey::random(&mut rand::thread_rng());
        let sec1 = signing_key.verifying_key().to_encoded_point(false);
        let client_data = build_client_data("attacker-challenge", "https://exchange.example");
        let auth_data = build_auth_data("exchange.example", FLAG_USER_PRESENT, 1);
        let err = verify_assertion(
            sec1.as_bytes(),
            &auth_data,
            &client_data,
            &[0u8; 8],
            "expected-challenge",
            "https://exchange.example",
            "exchange.example",
            0,
        )
        .unwrap_err();
        assert_eq!(err, WebAuthnError::ChallengeMismatch);
    }

    #[test]
    fn wrong_rp_id_is_rejected() {
        let signing_key = SigningKey::random(&mut rand::thread_rng());
        let sec1 = signing_key.verifying_key().to_encoded_point(false);
        let client_data = build_client_data("c", "https://exchange.example");
        let auth_data = build_auth_data("evil.example", FLAG_USER_PRESENT, 1);
        let err = verify_assertion(
            sec1.as_bytes(),
            &auth_data,
            &client_data,
            &[0u8; 8],
            "c",
            "https://exchange.example",
            "exchange.example",
            0,
        )
        .unwrap_err();
        assert_eq!(err, WebAuthnError::RpIdMismatch);
    }

    #[test]
    fn counter_regression_is_rejected() {
        let signing_key = SigningKey::random(&mut rand::thread_rng());
        let sec1 = signing_key.verifying_key().to_encoded_point(false);
        let origin = "https://exchange.example";
        let rp_id = "exchange.example";
        let challenge = "c";
        let auth_data = build_auth_data(rp_id, FLAG_USER_PRESENT, 3);
        let client_data = build_client_data(challenge, origin);
        let mut signed = auth_data.clone();
        signed.extend_from_slice(&Sha256::digest(&client_data));
        let sig: Signature = signing_key.sign(&signed);
        let err = verify_assertion(
            sec1.as_bytes(),
            &auth_data,
            &client_data,
            sig.to_der().as_bytes(),
            challenge,
            origin,
            rp_id,
            9, // stored counter higher than presented
        )
        .unwrap_err();
        assert_eq!(err, WebAuthnError::CounterRegression);
    }

    #[test]
    fn cose_key_parses_to_sec1() {
        let signing_key = SigningKey::random(&mut rand::thread_rng());
        let point = signing_key.verifying_key().to_encoded_point(false);
        let (x, y) = (point.x().unwrap(), point.y().unwrap());
        // Hand-build a COSE EC2 key map: {1:2, 3:-7, -1:1, -2:x, -3:y}
        let mut cose = Vec::new();
        cose.push(0xa5); // map of 5 pairs
        cose.push(0x01);
        cose.push(0x02);
        cose.push(0x03);
        cose.push(0x26); // -7
        cose.push(0x20); // -1
        cose.push(0x01);
        cose.push(0x21); // -2
        cose.push(0x58);
        cose.push(32);
        cose.extend_from_slice(x);
        cose.push(0x22); // -3
        cose.push(0x58);
        cose.push(32);
        cose.extend_from_slice(y);
        let sec1 = cose_key_to_sec1(&cose).unwrap();
        assert_eq!(sec1, point.as_bytes());
    }
}
