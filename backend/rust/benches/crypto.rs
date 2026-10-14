use criterion::{black_box, criterion_group, criterion_main, Criterion};
use tigerex_security::crypto::{decrypt_aes_gcm, encrypt_aes_gcm, sha256};

fn crypto_benchmarks(c: &mut Criterion) {
    let payload = b"TigerEx cryptographic benchmark payload";
    let key = [0x5au8; 32];
    let ciphertext = encrypt_aes_gcm(payload, &key).expect("benchmark encryption should succeed");

    c.bench_function("sha256/40_bytes", |b| {
        b.iter(|| sha256(black_box(payload)))
    });
    c.bench_function("aes_256_gcm/encrypt_40_bytes", |b| {
        b.iter(|| encrypt_aes_gcm(black_box(payload), &key).expect("encryption should succeed"))
    });
    c.bench_function("aes_256_gcm/decrypt_40_bytes", |b| {
        b.iter(|| decrypt_aes_gcm(black_box(&ciphertext), &key).expect("decryption should succeed"))
    });
}

criterion_group!(benches, crypto_benchmarks);
criterion_main!(benches);
