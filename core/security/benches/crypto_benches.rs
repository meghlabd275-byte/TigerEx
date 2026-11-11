//! Micro-benchmarks for the core security primitives.

use criterion::{criterion_group, criterion_main, Criterion};
use tigerex_security::{crypto::AesEncryptor, hashing, signatures::Ed25519Signer};

fn bench_aes_round_trip(c: &mut Criterion) {
    let key = AesEncryptor::generate_key().unwrap();
    let encryptor = AesEncryptor::new(&key).unwrap();
    let payload = [0u8; 1024];

    c.bench_function("aes256gcm_encrypt_1k", |b| {
        b.iter(|| encryptor.encrypt(&payload).unwrap())
    });
}

fn bench_ed25519_sign(c: &mut Criterion) {
    let signer = Ed25519Signer::generate().unwrap();
    let message = [7u8; 256];

    c.bench_function("ed25519_sign_256", |b| b.iter(|| signer.sign(&message)));
}

fn bench_sha256(c: &mut Criterion) {
    let payload = [3u8; 4096];
    c.bench_function("sha256_4k", |b| b.iter(|| hashing::sha256(&payload)));
}

criterion_group!(benches, bench_aes_round_trip, bench_ed25519_sign, bench_sha256);
criterion_main!(benches);
