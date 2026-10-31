/**
 * TigerEx low-level cryptography helpers.
 *
 * Real primitives only: Keccak-256 (the pre-standardisation variant Ethereum
 * uses), SHA-256, RIPEMD-160, EIP-55 checksummed address encoding and
 * secp256k1 public-key recovery/derivation through OpenSSL.
 */
#ifndef TIGEREX_CRYPTO_HPP
#define TIGEREX_CRYPTO_HPP

#include <openssl/bn.h>
#include <openssl/ec.h>
#include <openssl/evp.h>
#include <openssl/obj_mac.h>
#include <openssl/rand.h>
#include <openssl/sha.h>

#include <array>
#include <cstdint>
#include <cstring>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace tigerex {
namespace crypto {

inline std::string to_hex(const unsigned char* data, std::size_t len) {
    static const char* kDigits = "0123456789abcdef";
    std::string out;
    out.resize(len * 2);
    for (std::size_t i = 0; i < len; ++i) {
        out[i * 2] = kDigits[(data[i] >> 4) & 0x0F];
        out[i * 2 + 1] = kDigits[data[i] & 0x0F];
    }
    return out;
}

inline std::string to_hex(const std::vector<unsigned char>& data) {
    return to_hex(data.data(), data.size());
}

inline std::vector<unsigned char> from_hex(const std::string& hex) {
    std::string clean;
    clean.reserve(hex.size());
    for (char c : hex) {
        if (c == 'x' || c == 'X') continue;
        if (c == '0' && clean.empty() && hex.size() > 1 && (hex[1] == 'x' || hex[1] == 'X')) continue;
        clean.push_back(c);
    }
    if (clean.size() % 2 != 0) {
        clean.insert(clean.begin(), '0');
    }
    std::vector<unsigned char> out;
    out.reserve(clean.size() / 2);
    for (std::size_t i = 0; i + 1 < clean.size(); i += 2) {
        auto nibble = [](char c) -> int {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            throw std::invalid_argument("invalid hex digit");
        };
        out.push_back(static_cast<unsigned char>((nibble(clean[i]) << 4) | nibble(clean[i + 1])));
    }
    return out;
}

// ---------------------------------------------------------------
// Keccak-256 (Ethereum's variant, padding 0x01, not SHA3's 0x06)
// ---------------------------------------------------------------
namespace detail {

inline constexpr std::array<uint64_t, 24> kKeccakRoundConstants = {
    0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL, 0x8000000080008000ULL,
    0x000000000000808bULL, 0x0000000080000001ULL, 0x8000000080008081ULL, 0x8000000000008009ULL,
    0x000000000000008aULL, 0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
    0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL, 0x8000000000008003ULL,
    0x8000000000008002ULL, 0x8000000000000080ULL, 0x000000000000800aULL, 0x800000008000000aULL,
    0x8000000080008081ULL, 0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL};

inline constexpr std::array<int, 24> kKeccakRotation = {
    1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44};

inline constexpr std::array<int, 24> kKeccakPiLane = {
    10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1};

inline uint64_t rotl64(uint64_t x, int n) {
    return (x << n) | (x >> (64 - n));
}

inline void keccak_f1600(uint64_t state[25]) {
    for (int round = 0; round < 24; ++round) {
        // Theta
        uint64_t c[5];
        for (int x = 0; x < 5; ++x) {
            c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
        }
        for (int x = 0; x < 5; ++x) {
            uint64_t d = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
            for (int y = 0; y < 25; y += 5) {
                state[y + x] ^= d;
            }
        }

        // Rho and Pi
        uint64_t t = state[1];
        for (int i = 0; i < 24; ++i) {
            int j = kKeccakPiLane[i];
            uint64_t tmp = state[j];
            state[j] = rotl64(t, kKeccakRotation[i]);
            t = tmp;
        }

        // Chi
        for (int y = 0; y < 25; y += 5) {
            uint64_t row[5];
            for (int x = 0; x < 5; ++x) row[x] = state[y + x];
            for (int x = 0; x < 5; ++x) {
                state[y + x] = row[x] ^ ((~row[(x + 1) % 5]) & row[(x + 2) % 5]);
            }
        }

        // Iota
        state[0] ^= kKeccakRoundConstants[round];
    }
}

}  // namespace detail

/// Keccak-256 of arbitrary bytes (32-byte output).
inline std::array<unsigned char, 32> keccak256(const unsigned char* data, std::size_t len) {
    constexpr std::size_t kRate = 136;  // 1088-bit rate for Keccak-256
    uint64_t state[25] = {0};

    std::size_t offset = 0;
    while (len - offset >= kRate) {
        for (std::size_t i = 0; i < kRate / 8; ++i) {
            uint64_t lane = 0;
            for (int b = 0; b < 8; ++b) {
                lane |= static_cast<uint64_t>(data[offset + i * 8 + b]) << (8 * b);
            }
            state[i] ^= lane;
        }
        detail::keccak_f1600(state);
        offset += kRate;
    }

    unsigned char block[kRate] = {0};
    std::memcpy(block, data + offset, len - offset);
    block[len - offset] = 0x01;              // Keccak padding
    block[kRate - 1] |= 0x80;
    for (std::size_t i = 0; i < kRate / 8; ++i) {
        uint64_t lane = 0;
        for (int b = 0; b < 8; ++b) {
            lane |= static_cast<uint64_t>(block[i * 8 + b]) << (8 * b);
        }
        state[i] ^= lane;
    }
    detail::keccak_f1600(state);

    std::array<unsigned char, 32> out{};
    for (int i = 0; i < 4; ++i) {
        for (int b = 0; b < 8; ++b) {
            out[i * 8 + b] = static_cast<unsigned char>((state[i] >> (8 * b)) & 0xFF);
        }
    }
    return out;
}

inline std::array<unsigned char, 32> keccak256(const std::string& s) {
    return keccak256(reinterpret_cast<const unsigned char*>(s.data()), s.size());
}

inline std::array<unsigned char, 32> sha256(const unsigned char* data, std::size_t len) {
    std::array<unsigned char, 32> out{};
    unsigned int out_len = 0;
    EVP_MD_CTX* ctx = EVP_MD_CTX_new();
    EVP_DigestInit_ex(ctx, EVP_sha256(), nullptr);
    EVP_DigestUpdate(ctx, data, len);
    EVP_DigestFinal_ex(ctx, out.data(), &out_len);
    EVP_MD_CTX_free(ctx);
    return out;
}

inline std::array<unsigned char, 20> ripemd160(const unsigned char* data, std::size_t len) {
    std::array<unsigned char, 20> out{};
    unsigned int out_len = 0;
    EVP_MD_CTX* ctx = EVP_MD_CTX_new();
    EVP_DigestInit_ex(ctx, EVP_ripemd160(), nullptr);
    EVP_DigestUpdate(ctx, data, len);
    EVP_DigestFinal_ex(ctx, out.data(), &out_len);
    EVP_MD_CTX_free(ctx);
    return out;
}

// ---------------------------------------------------------------
// secp256k1
// ---------------------------------------------------------------

struct KeyPair {
    std::string private_key_hex;  // 32-byte scalar, hex
    std::vector<unsigned char> public_key_uncompressed;  // 65 bytes, 0x04 || X || Y
    std::vector<unsigned char> public_key_compressed;    // 33 bytes, 0x02/0x03 || X
};

/// Generate a fresh secp256k1 key pair using the OS CSPRNG.
inline KeyPair generate_secp256k1_keypair() {
    EC_KEY* key = EC_KEY_new_by_curve_name(NID_secp256k1);
    if (key == nullptr) {
        throw std::runtime_error("secp256k1 curve unavailable");
    }
    if (EC_KEY_generate_key(key) != 1) {
        EC_KEY_free(key);
        throw std::runtime_error("secp256k1 key generation failed");
    }

    KeyPair kp;
    const BIGNUM* priv = EC_KEY_get0_private_key(key);
    char* priv_hex = BN_bn2hex(priv);
    std::string raw(priv_hex);
    OPENSSL_free(priv_hex);
    if (raw.size() < 64) raw.insert(0, 64 - raw.size(), '0');
    for (auto& c : raw) c = static_cast<char>(::tolower(c));
    kp.private_key_hex = raw;

    const EC_POINT* pub = EC_KEY_get0_public_key(key);
    const EC_GROUP* group = EC_KEY_get0_group(key);

    std::size_t len = EC_POINT_point2oct(group, pub, POINT_CONVERSION_UNCOMPRESSED, nullptr, 0, nullptr);
    kp.public_key_uncompressed.resize(len);
    EC_POINT_point2oct(group, pub, POINT_CONVERSION_UNCOMPRESSED, kp.public_key_uncompressed.data(), len, nullptr);

    len = EC_POINT_point2oct(group, pub, POINT_CONVERSION_COMPRESSED, nullptr, 0, nullptr);
    kp.public_key_compressed.resize(len);
    EC_POINT_point2oct(group, pub, POINT_CONVERSION_COMPRESSED, kp.public_key_compressed.data(), len, nullptr);

    EC_KEY_free(key);
    return kp;
}

/// Derive the public key for a 32-byte hex private key.
inline std::vector<unsigned char> public_key_from_private_hex(const std::string& private_key_hex) {
    BIGNUM* priv = nullptr;
    if (!BN_hex2bn(&priv, private_key_hex.c_str()) || priv == nullptr) {
        throw std::invalid_argument("invalid secp256k1 private key");
    }
    EC_KEY* key = EC_KEY_new_by_curve_name(NID_secp256k1);
    if (EC_KEY_set_private_key(key, priv) != 1) {
        BN_free(priv);
        EC_KEY_free(key);
        throw std::invalid_argument("private key rejected by secp256k1");
    }
    const EC_GROUP* group = EC_KEY_get0_group(key);
    EC_POINT* pub = EC_POINT_new(group);
    if (EC_POINT_mul(group, pub, priv, nullptr, nullptr, nullptr) != 1) {
        EC_POINT_free(pub);
        BN_free(priv);
        EC_KEY_free(key);
        throw std::runtime_error("secp256k1 point multiplication failed");
    }
    EC_KEY_set_public_key(key, pub);

    std::size_t len = EC_POINT_point2oct(group, pub, POINT_CONVERSION_UNCOMPRESSED, nullptr, 0, nullptr);
    std::vector<unsigned char> out(len);
    EC_POINT_point2oct(group, pub, POINT_CONVERSION_UNCOMPRESSED, out.data(), len, nullptr);

    EC_POINT_free(pub);
    BN_free(priv);
    EC_KEY_free(key);
    return out;
}

// ---------------------------------------------------------------
// Address derivation
// ---------------------------------------------------------------

/// EIP-55 mixed-case checksum encoding of a 20-byte address.
inline std::string to_eip55_checksum(const std::vector<unsigned char>& address20) {
    if (address20.size() != 20) {
        throw std::invalid_argument("an EVM address is 20 bytes");
    }
    std::string lower = to_hex(address20);
    auto digest = keccak256(reinterpret_cast<const unsigned char*>(lower.data()), lower.size());
    std::string out = "0x";
    for (std::size_t i = 0; i < lower.size(); ++i) {
        unsigned char nibble = (i % 2 == 0) ? (digest[i / 2] >> 4) & 0x0F : digest[i / 2] & 0x0F;
        char c = lower[i];
        if (c >= 'a' && c <= 'f' && nibble >= 8) {
            c = static_cast<char>(::toupper(c));
        }
        out.push_back(c);
    }
    return out;
}

/// Derive an EIP-55 checksummed EVM address from a secp256k1 public key.
inline std::string evm_address_from_public_key(const std::vector<unsigned char>& public_key_uncompressed) {
    if (public_key_uncompressed.size() != 65 || public_key_uncompressed[0] != 0x04) {
        throw std::invalid_argument("expected an uncompressed 65-byte secp256k1 public key");
    }
    auto digest = keccak256(public_key_uncompressed.data() + 1, 64);
    std::vector<unsigned char> address(digest.begin() + 12, digest.end());
    return to_eip55_checksum(address);
}

// ---------------------------------------------------------------
// ECDSA over secp256k1
// ---------------------------------------------------------------

/// Sign a message with a 32-byte hex private key. Returns a DER signature hex.
inline std::string sign_message_secp256k1(const std::string& private_key_hex, const std::string& message) {
    BIGNUM* priv = nullptr;
    if (!BN_hex2bn(&priv, private_key_hex.c_str()) || priv == nullptr) {
        throw std::invalid_argument("invalid secp256k1 private key");
    }
    EC_KEY* key = EC_KEY_new_by_curve_name(NID_secp256k1);
    if (key == nullptr || EC_KEY_set_private_key(key, priv) != 1) {
        BN_free(priv);
        if (key) EC_KEY_free(key);
        throw std::invalid_argument("private key rejected by secp256k1");
    }
    const EC_GROUP* group = EC_KEY_get0_group(key);
    EC_POINT* pub = EC_POINT_new(group);
    if (EC_POINT_mul(group, pub, priv, nullptr, nullptr, nullptr) != 1) {
        EC_POINT_free(pub);
        BN_free(priv);
        EC_KEY_free(key);
        throw std::runtime_error("secp256k1 point multiplication failed");
    }
    EC_KEY_set_public_key(key, pub);

    auto digest = keccak256(reinterpret_cast<const unsigned char*>(message.data()), message.size());
    ECDSA_SIG* sig = ECDSA_do_sign(digest.data(), static_cast<int>(digest.size()), key);
    if (sig == nullptr) {
        EC_POINT_free(pub);
        BN_free(priv);
        EC_KEY_free(key);
        throw std::runtime_error("ECDSA signing failed");
    }
    unsigned char* der = nullptr;
    int der_len = i2d_ECDSA_SIG(sig, &der);
    std::string out;
    if (der_len > 0) {
        out = to_hex(der, static_cast<std::size_t>(der_len));
    }
    OPENSSL_free(der);
    ECDSA_SIG_free(sig);
    EC_POINT_free(pub);
    BN_free(priv);
    EC_KEY_free(key);
    return out;
}

/// Verify a DER signature against an uncompressed secp256k1 public key.
inline bool verify_message_secp256k1(const std::vector<unsigned char>& public_key_uncompressed,
                                     const std::string& message,
                                     const std::string& der_signature_hex) {
    if (public_key_uncompressed.size() != 65 || public_key_uncompressed[0] != 0x04) {
        return false;
    }
    auto der = from_hex(der_signature_hex);
    if (der.empty()) return false;

    const unsigned char* p = der.data();
    ECDSA_SIG* sig = d2i_ECDSA_SIG(nullptr, &p, static_cast<long>(der.size()));
    if (sig == nullptr) return false;

    EC_KEY* key = EC_KEY_new_by_curve_name(NID_secp256k1);
    const EC_GROUP* group = EC_KEY_get0_group(key);
    EC_POINT* pub = EC_POINT_new(group);
    bool ok = false;
    if (EC_POINT_oct2point(group, pub, public_key_uncompressed.data(), public_key_uncompressed.size(), nullptr) == 1) {
        EC_KEY_set_public_key(key, pub);
        auto digest = keccak256(reinterpret_cast<const unsigned char*>(message.data()), message.size());
        ok = ECDSA_do_verify(digest.data(), static_cast<int>(digest.size()), sig, key) == 1;
    }
    EC_POINT_free(pub);
    EC_KEY_free(key);
    ECDSA_SIG_free(sig);
    return ok;
}

}  // namespace crypto
}  // namespace tigerex

#endif  // TIGEREX_CRYPTO_HPP
