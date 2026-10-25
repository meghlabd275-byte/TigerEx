//! Threshold key management - real Shamir secret sharing with threshold
//! signing.
//!
//! The previous implementation returned the literal string `"signature"` from
//! `threshold_sign`, emitted three fixed `"share1".."share3"` strings from
//! `distribute_key`, and never touched a key at all.
//!
//! The Ed25519 seed is split byte-wise over GF(256), so any `t` of `n` shares
//! reconstruct the exact seed and can produce a valid signature. This is a
//! threshold key-splitting scheme: reconstruction happens inside the signing
//! routine, so it is not a distributed protocol in which no party ever holds
//! the seed.

use std::collections::HashMap;

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use zeroize::Zeroizing;

/// A single key share: the evaluation point and the share value.
#[derive(Clone)]
pub struct KeyShare {
    /// Non-zero x-coordinate of this share.
    pub index: u8,
    /// The share value, zeroized on drop.
    pub value: Zeroizing<Vec<u8>>,
}

/// A signing group created by splitting one Ed25519 key.
pub struct MpcKeyGroup {
    pub threshold: u8,
    pub total: u8,
    pub verifying_key: VerifyingKey,
}

impl MpcKeyGroup {
    /// Split `secret` into `total` shares with the given `threshold`.
    ///
    /// Returns an error for degenerate parameters or a CSPRNG failure.
    pub fn split(
        secret: &SigningKey,
        threshold: u8,
        total: u8,
    ) -> Result<(Self, Vec<KeyShare>), String> {
        if threshold == 0 || total < threshold || total == 0 {
            return Err("threshold must be >= 1 and <= total".to_string());
        }

        let seed = secret.to_bytes();
        let degree = threshold as usize - 1;

        // Random polynomial coefficients, one set per byte of the seed.
        let mut coefficients = vec![0u8; seed.len() * degree];
        if degree > 0 {
            getrandom_fill(&mut coefficients)?;
        }

        let mut shares = Vec::with_capacity(total as usize);
        for index in 1..=total {
            let x = index;
            let mut value = Vec::with_capacity(seed.len());
            for (byte_index, secret_byte) in seed.iter().enumerate() {
                let mut y = *secret_byte;
                let mut power = x;
                for coefficient_index in 0..degree {
                    let coefficient = coefficients[byte_index * degree + coefficient_index];
                    y ^= gf_mul(coefficient, power);
                    power = gf_mul(power, x);
                }
                value.push(y);
            }

            shares.push(KeyShare {
                index,
                value: Zeroizing::new(value),
            });
        }

        Ok((
            Self {
                threshold,
                total,
                verifying_key: secret.verifying_key(),
            },
            shares,
        ))
    }

    /// Sign `message` by combining any `threshold` shares.
    pub fn threshold_sign(
        &self,
        shares: &[KeyShare],
        message: &[u8],
    ) -> Result<Signature, String> {
        let secret = self.reconstruct(shares)?;
        let signing_key = SigningKey::from_bytes(&secret);
        Ok(signing_key.sign(message))
    }

    /// Reconstruct the Ed25519 seed from at least `threshold` distinct shares.
    pub fn reconstruct(&self, shares: &[KeyShare]) -> Result<Zeroizing<[u8; 32]>, String> {
        let threshold = self.threshold as usize;
        if threshold == 0 || shares.len() < threshold {
            return Err(format!(
                "need at least {threshold} shares, got {}",
                shares.len()
            ));
        }

        let selected = &shares[..threshold];
        let mut seen = HashMap::with_capacity(threshold);
        for share in selected {
            if share.index == 0 {
                return Err("share index 0 is invalid".to_string());
            }
            if seen.insert(share.index, ()).is_some() {
                return Err(format!("duplicate share index {}", share.index));
            }
        }

        let share_len = selected[0].value.len();
        if share_len != 32 || selected.iter().any(|s| s.value.len() != share_len) {
            return Err("invalid share length".to_string());
        }

        // Lagrange interpolation at x = 0, byte-wise over GF(256).
        let mut seed = Zeroizing::new([0u8; 32]);
        for (i, share) in selected.iter().enumerate() {
            let xi = share.index;
            let mut basis = 1u8;
            for (j, other) in selected.iter().enumerate() {
                if i == j {
                    continue;
                }
                let xj = other.index;
                basis = gf_mul(basis, gf_mul(xj, gf_inv(xi ^ xj)));
            }
            for (byte_index, value) in share.value.iter().enumerate() {
                seed[byte_index] ^= gf_mul(*value, basis);
            }
        }

        Ok(seed)
    }
}

fn getrandom_fill(buf: &mut [u8]) -> Result<(), String> {
    use rand::RngCore;
    OsRng
        .try_fill_bytes(buf)
        .map_err(|e| format!("CSPRNG failure: {e}"))
}

/// Multiplication in GF(256) with the AES polynomial 0x11b.
fn gf_mul(mut a: u8, mut b: u8) -> u8 {
    let mut result = 0u8;
    for _ in 0..8 {
        if b & 1 != 0 {
            result ^= a;
        }
        let high_bit = a & 0x80;
        a <<= 1;
        if high_bit != 0 {
            a ^= 0x1b;
        }
        b >>= 1;
    }
    result
}

fn gf_pow(mut base: u8, mut exponent: u8) -> u8 {
    let mut result = 1u8;
    while exponent > 0 {
        if exponent & 1 != 0 {
            result = gf_mul(result, base);
        }
        base = gf_mul(base, base);
        exponent >>= 1;
    }
    result
}

/// Multiplicative inverse in GF(256); zero has no inverse and maps to zero,
/// which callers must guard against by rejecting duplicate coordinates.
fn gf_inv(value: u8) -> u8 {
    if value == 0 {
        0
    } else {
        gf_pow(value, 254)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;

    fn key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    #[test]
    fn any_threshold_subset_reconstructs_and_signs() {
        let secret = key();
        let (group, shares) = MpcKeyGroup::split(&secret, 3, 5).unwrap();
        assert_eq!(shares.len(), 5);

        let subsets = [[0usize, 1, 2], [0, 2, 4], [1, 3, 4], [2, 3, 4]];
        for subset in subsets {
            let chosen: Vec<KeyShare> = subset.iter().map(|&i| shares[i].clone()).collect();
            let sig = group.threshold_sign(&chosen, b"settlement").unwrap();
            assert!(group.verifying_key.verify(b"settlement", &sig).is_ok());
        }
    }

    #[test]
    fn threshold_one_shares_equal_the_seed() {
        let secret = key();
        let (group, shares) = MpcKeyGroup::split(&secret, 1, 3).unwrap();
        let recovered = group.reconstruct(&shares[..1]).unwrap();
        assert_eq!(*recovered, secret.to_bytes());
    }

    #[test]
    fn below_threshold_cannot_sign() {
        let secret = key();
        let (group, shares) = MpcKeyGroup::split(&secret, 3, 5).unwrap();
        let two = vec![shares[0].clone(), shares[1].clone()];
        assert!(group.threshold_sign(&two, b"settlement").is_err());
    }

    #[test]
    fn duplicate_shares_are_rejected() {
        let secret = key();
        let (group, shares) = MpcKeyGroup::split(&secret, 2, 3).unwrap();
        let dup = vec![shares[0].clone(), shares[0].clone()];
        assert!(group.reconstruct(&dup).is_err());
    }

    #[test]
    fn invalid_parameters_are_rejected() {
        let secret = key();
        assert!(MpcKeyGroup::split(&secret, 0, 3).is_err());
        assert!(MpcKeyGroup::split(&secret, 4, 3).is_err());
        assert!(MpcKeyGroup::split(&secret, 2, 0).is_err());
    }

    #[test]
    fn shares_differ_from_each_other_and_from_the_seed() {
        let secret = key();
        let (_group, shares) = MpcKeyGroup::split(&secret, 2, 3).unwrap();
        assert_ne!(*shares[0].value, secret.to_bytes().to_vec());
        assert_ne!(*shares[0].value, *shares[1].value);
    }
}
