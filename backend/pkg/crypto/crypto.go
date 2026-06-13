package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"hash"
	"io"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/pbkdf2"
	"golang.org/x/crypto/scrypt"
	"golang.org/x/crypto/sha3"
)

type CryptoManager struct {
	config    CryptoConfig
	encryptionKey []byte
	signingKey   *rsa.PrivateKey
}

type CryptoConfig struct {
	EncryptionKeyPath string
	SigningKeyPath   string
	HashAlgorithm    string
	AESKeySize      int
	RSAKeySize      int
	UseHSM          bool
}

func NewCryptoManager(config CryptoConfig) *CryptoManager {
	return &CryptoManager{
		config: config,
	}
}

// AES-GCM Encryption (256-bit)
func (c *CryptoManager) EncryptAES(plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(c.encryptionKey)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("failed to generate nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return ciphertext, nil
}

func (c *CryptoManager) DecryptAES(ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(c.encryptionKey)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt: %w", err)
	}

	return plaintext, nil
}

// RSA Encryption/Decryption
func (c *CryptoManager) EncryptRSA(plaintext []byte) ([]byte, error) {
	if c.signingKey == nil {
		return nil, fmt.Errorf("signing key not initialized")
	}
	return rsa.EncryptOAEP(sha256.New(), rand.Reader, &c.signingKey.PublicKey, plaintext, nil)
}

func (c *CryptoManager) DecryptRSA(ciphertext []byte) ([]byte, error) {
	if c.signingKey == nil {
		return nil, fmt.Errorf("signing key not initialized")
	}
	return rsa.DecryptOAEP(sha256.New(), rand.Reader, c.signingKey, ciphertext, nil)
}

// Hash Functions
func (c *CryptoManager) HashSHA256(data []byte) []byte {
	h := sha256.Sum256(data)
	return h[:]
}

func (c *CryptoManager) HashSHA512(data []byte) []byte {
	h := sha512.Sum512(data)
	return h[:]
}

func (c *CryptoManager) HashSHA3_256(data []byte) []byte {
	h := sha3.New256()
	h.Write(data)
	return h.Sum(nil)
}

func (c *CryptoManager) HashSHA3_512(data []byte) []byte {
	h := sha3.New512()
	h.Write(data)
	return h.Sum(nil)
}

// Password Hashing - Argon2id (recommended)
func (c *CryptoManager) HashPasswordArgon2(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}

	hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)

	encoded := base64.RawURLEncoding.EncodeToString(salt) + "." + base64.RawURLEncoding.EncodeToString(hash)
	return encoded, nil
}

func (c *CryptoManager) VerifyPasswordArgon2(password, encoded string) (bool, error) {
	parts := splitEncoded(encoded, ".")
	if len(parts) != 2 {
		return false, fmt.Errorf("invalid encoded hash")
	}

	salt, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false, err
	}

	hash, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false, err
	}

	newHash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)

	return string(hash) == string(newHash), nil
}

// Password Hashing - Bcrypt (alternative)
func (c *CryptoManager) HashPasswordBcrypt(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func (c *CryptoManager) VerifyPasswordBcrypt(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// Password Hashing - Scrypt (for high security)
func (c *CryptoManager) HashPasswordScrypt(password string) (string, error) {
	salt := make([]byte, 32)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}

	hash := pbkdf2.Key([]byte(password), salt, 1048576, 64, sha256.New)

	encoded := base64.RawURLEncoding.EncodeToString(salt) + "." + base64.RawURLEncoding.EncodeToString(hash)
	return encoded, nil
}

func (c *CryptoManager) VerifyPasswordScrypt(password, encoded string) bool {
	parts := splitEncoded(encoded, ".")
	if len(parts) != 2 {
		return false
	}

	salt, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}

	hash, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}

	newHash := pbkdf2.Key([]byte(password), salt, 1048576, 64, sha256.New)

	return string(hash) == string(newHash)
}

// Digital Signatures
func (c *CryptoManager) Sign(data []byte) ([]byte, error) {
	if c.signingKey == nil {
		return nil, fmt.Errorf("signing key not initialized")
	}

	h := sha256.Sum256(data)
	return rsa.SignPKCS1v15(rand.Reader, c.signingKey, crypto.SHA256, h[:])
}

func (c *CryptoManager) Verify(data, signature []byte) bool {
	if c.signingKey == nil {
		return false
	}

	h := sha256.Sum256(data)
	err := rsa.VerifyPKCS1v15(&c.signingKey.PublicKey, crypto.SHA256, h[:], signature)
	return err == nil
}

// Random Bytes Generation
func (c *CryptoManager) GenerateRandomBytes(length int) ([]byte, error) {
	bytes := make([]byte, length)
	_, err := rand.Read(bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to generate random bytes: %w", err)
	}
	return bytes, nil
}

// Key Derivation
func (c *CryptoManager) DeriveKey(password, salt []byte) []byte {
	return pbkdf2.Key(password, salt, 100000, 32, sha256.New)
}

// HMAC
func (c *CryptoManager) HMAC(key, message []byte) hash.Hash {
	h := hmac.New(sha256.New, key)
	h.Write(message)
	return h
}

// Base64 Encoding/Decoding
func (c *CryptoManager) EncodeBase64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

func (c *CryptoManager) DecodeBase64(encoded string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(encoded)
}

// Hex Encoding/Decoding
func (c *CryptoManager) EncodeHex(data []byte) string {
	return hex.EncodeToString(data)
}

func (c *CryptoManager) DecodeHex(encoded string) ([]byte, error) {
	return hex.DecodeString(encoded)
}

// Key Generation for Encryption
func (c *CryptoManager) GenerateEncryptionKey() ([]byte, error) {
	key := make([]byte, 32) // 256-bit
	_, err := rand.Read(key)
	return key, err
}

func (c *CryptoManager) GenerateRSAKeyPair(bits int) (*rsa.PrivateKey, *rsa.PublicKey, error) {
	return rsa.GenerateKey(rand.Reader, bits)
}

// Crypto utilities
func splitEncoded(s, sep string) []string {
	// Simple split without using strings package
	var parts []string
	current := ""
	for _, c := range s {
		if string(c) == sep {
			parts = append(parts, current)
			current = ""
		} else {
			current += string(c)
		}
	}
	parts = append(parts, current)
	return parts
}

import (
	"crypto"
	"crypto/hmac"
)
