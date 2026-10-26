// TigerEx Security - Encryption and Key Management
package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/pbkdf2"
)

// =============================================================================
// KEY DERIVATION
// =============================================================================

// DeriveKey derives a key from a password using PBKDF2
func DeriveKey(password string, salt []byte, iterations int, keyLength int) []byte {
	return pbkdf2.Key([]byte(password), salt, iterations, keyLength, sha256.New)
}

// GenerateSalt generates a random salt
func GenerateSalt(length int) []byte {
	salt := make([]byte, length)
	if _, err := rand.Read(salt); err != nil {
		panic(fmt.Sprintf("secure random unavailable: %v", err))
	}
	return salt
}

// HashPassword hashes a password using bcrypt
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword verifies a password against a hash
func VerifyPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// Argon2Config for Argon2id
type Argon2Config struct {
	Memory      uint32
	Iterations  uint32
	Parallelism uint8
	SaltLength  uint32
	KeyLength   uint32
}

func DefaultArgon2Config() *Argon2Config {
	return &Argon2Config{
		Memory:      65536,
		Iterations:  3,
		Parallelism: 4,
		SaltLength:  16,
		KeyLength:   32,
	}
}

// HashPasswordArgon2 hashes a password using Argon2id
func HashPasswordArgon2(password string, cfg *Argon2Config) (string, error) {
	if cfg == nil {
		cfg = DefaultArgon2Config()
	}

	salt := make([]byte, cfg.SaltLength)
	rand.Read(salt)

	hash := argon2.IDKey([]byte(password), salt, cfg.Memory, cfg.Iterations, cfg.Parallelism, cfg.KeyLength)

	return hex.EncodeToString(salt) + ":" + hex.EncodeToString(hash), nil
}

// VerifyPasswordArgon2 verifies a password against an Argon2 hash
func VerifyPasswordArgon2(password, encoded string) bool {
	parts := split(encoded, ":")
	if len(parts) != 2 {
		return false
	}

	salt, _ := hex.DecodeString(parts[0])
	hash, _ := hex.DecodeString(parts[1])

	cfg := DefaultArgon2Config()
	newHash := argon2.IDKey([]byte(password), salt, cfg.Memory, cfg.Iterations, cfg.Parallelism, cfg.KeyLength)

	return constantTimeCompare(hash, newHash)
}

func split(s, sep string) []string {
	var result []string
	start := 0
	for i := 0; i < len(s); i++ {
		if i+len(sep) <= len(s) && s[i:i+len(sep)] == sep {
			result = append(result, s[start:i])
			start = i + len(sep)
			i += len(sep) - 1
		}
	}
	result = append(result, s[start:])
	return result
}

func constantTimeCompare(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var result byte
	for i := 0; i < len(a); i++ {
		result |= a[i] ^ b[i]
	}
	return result == 0
}

// =============================================================================
// AES ENCRYPTION
// =============================================================================

// AESConfig for AES encryption
type AESConfig struct {
	KeySize   int
	BlockSize int
}

func DefaultAESConfig() *AESConfig {
	return &AESConfig{
		KeySize:   32, // 256-bit
		BlockSize: 16, // 128-bit
	}
}

// GenerateAESKey generates a random AES key
func GenerateAESKey(cfg *AESConfig) ([]byte, error) {
	if cfg == nil {
		cfg = DefaultAESConfig()
	}

	key := make([]byte, cfg.KeySize)
	_, err := rand.Read(key)
	return key, err
}

// AESEncrypt encrypts plaintext using AES-GCM
func AESEncrypt(plaintext []byte, key []byte) (ciphertext, nonce []byte, err error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}

	nonce = make([]byte, gcm.NonceSize())
	rand.Read(nonce)

	ciphertext = gcm.Seal(nil, nonce, plaintext, nil)
	return ciphertext, nonce, nil
}

// AESDecrypt decrypts ciphertext using AES-GCM
func AESDecrypt(ciphertext, key, nonce []byte) (plaintext []byte, err error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	plaintext, err = gcm.Open(nil, nonce, ciphertext, nil)
	return plaintext, err
}

// AESEncryptString encrypts a string
func AESEncryptString(plaintext string, key []byte) (string, error) {
	ciphertext, nonce, err := AESEncrypt([]byte(plaintext), key)
	if err != nil {
		return "", err
	}

	return hex.EncodeToString(nonce) + ":" + hex.EncodeToString(ciphertext), nil
}

// AESDecryptString decrypts a string
func AESDecryptString(encrypted string, key []byte) (string, error) {
	parts := split(encrypted, ":")
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid encrypted data")
	}

	nonce, _ := hex.DecodeString(parts[0])
	ciphertext, _ := hex.DecodeString(parts[1])

	plaintext, err := AESDecrypt(ciphertext, key, nonce)
	return string(plaintext), err
}

// =============================================================================
// HYBRID ENCRYPTION (ECDH + AES-GCM)
// =============================================================================

// PrivateKey is an ECDH private key on P-256.
type PrivateKey struct {
	Curve elliptic.Curve
	D     *big.Int
	X, Y  *big.Int
}

// PublicKey is an ECDH public key on P-256.
type PublicKey struct {
	Curve elliptic.Curve
	X, Y  *big.Int
}

// curveBits is the size of the P-256 field in bytes, used for point encoding.
const curveBits = 32

// GenerateECDHKeyPair creates a new P-256 key pair.
func GenerateECDHKeyPair() (*PrivateKey, *PublicKey, error) {
	priv, x, y, err := elliptic.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	privateKey := &PrivateKey{
		Curve: elliptic.P256(),
		D:     new(big.Int).SetBytes(priv),
		X:     x,
		Y:     y,
	}
	return privateKey, &PublicKey{Curve: privateKey.Curve, X: x, Y: y}, nil
}

// GenerateECDHKeyPairPEM returns the key pair as raw uncompressed encodings.
func GenerateECDHKeyPairPEM() (publicKey, privateKey []byte, err error) {
	priv, pub, err := GenerateECDHKeyPair()
	if err != nil {
		return nil, nil, err
	}
	return elliptic.Marshal(pub.Curve, pub.X, pub.Y), priv.D.Bytes(), nil
}

// MarshalPublicKey encodes a public key in the uncompressed SEC1 form.
func MarshalPublicKey(pub *PublicKey) []byte {
	return elliptic.Marshal(pub.Curve, pub.X, pub.Y)
}

// ParsePublicKey decodes an uncompressed SEC1 P-256 public key.
func ParsePublicKey(encoded []byte) (*PublicKey, error) {
	x, y := elliptic.Unmarshal(elliptic.P256(), encoded)
	if x == nil {
		return nil, fmt.Errorf("invalid public key encoding")
	}
	return &PublicKey{Curve: elliptic.P256(), X: x, Y: y}, nil
}

// deriveSharedKey runs ECDH and reduces the shared point to a 32 byte AES key.
func deriveSharedKey(curve elliptic.Curve, x, y *big.Int, privateScalar []byte) ([]byte, error) {
	sharedX, _ := curve.ScalarMult(x, y, privateScalar)
	if sharedX == nil {
		return nil, fmt.Errorf("ECDH produced no shared point")
	}
	// Hash the shared secret so the raw X coordinate is never used as a key.
	sum := sha256.Sum256(sharedX.Bytes())
	return sum[:], nil
}

// EncryptWithECIES encrypts to a public key.
//
// The output is the ephemeral public point, the nonce, and the AES-GCM
// ciphertext, which is authenticated. It is compatible with DecryptWithECIES.
func EncryptWithECIES(plaintext []byte, publicKey []byte) ([]byte, error) {
	pub, err := ParsePublicKey(publicKey)
	if err != nil {
		return nil, err
	}

	eph, _, err := GenerateECDHKeyPair()
	if err != nil {
		return nil, err
	}

	key, err := deriveSharedKey(pub.Curve, pub.X, pub.Y, padScalar(eph.D))
	if err != nil {
		return nil, err
	}

	ciphertext, nonce, err := AESEncrypt(plaintext, key)
	if err != nil {
		return nil, err
	}

	ephPoint := elliptic.Marshal(eph.Curve, eph.X, eph.Y)
	out := make([]byte, 0, len(ephPoint)+len(nonce)+len(ciphertext))
	out = append(out, ephPoint...)
	out = append(out, nonce...)
	out = append(out, ciphertext...)
	return out, nil
}

// DecryptWithECIES decrypts a message produced by EncryptWithECIES.
func DecryptWithECIES(ciphertext []byte, privateKey *PrivateKey) ([]byte, error) {
	if privateKey == nil || privateKey.D == nil {
		return nil, fmt.Errorf("private key is required")
	}

	pointLen := 1 + 2*curveBits // uncompressed SEC1 point
	gcmNonceLen := 12
	if len(ciphertext) < pointLen+gcmNonceLen {
		return nil, fmt.Errorf("ciphertext is too short")
	}

	ephX, ephemY := elliptic.Unmarshal(privateKey.Curve, ciphertext[:pointLen])
	if ephX == nil {
		return nil, fmt.Errorf("invalid ephemeral public key")
	}

	nonce := ciphertext[pointLen : pointLen+gcmNonceLen]
	body := ciphertext[pointLen+gcmNonceLen:]

	key, err := deriveSharedKey(privateKey.Curve, ephX, ephemY, padScalar(privateKey.D))
	if err != nil {
		return nil, err
	}

	return AESDecrypt(body, key, nonce)
}

// padScalar left pads a scalar to the curve size, as ScalarMult expects.
func padScalar(d *big.Int) []byte {
	out := make([]byte, curveBits)
	d.FillBytes(out)
	return out
}

// =============================================================================
// ENVELOPE ENCRYPTION
// =============================================================================

// Envelope represents an encrypted envelope.
//
// WrappedNonce is the nonce used to wrap DataKey. It must be stored
// separately from Nonce: reusing one nonce for two AES-GCM encryptions is
// catastrophic, and without it the wrapped key cannot be recovered.
type Envelope struct {
	KID          string `json:"kid"`
	Algorithm    string `json:"alg"`
	Nonce        string `json:"nonce"`
	WrappedNonce string `json:"wrapped_nonce"`
	Data         string `json:"data"`
}

// EncryptWithEnvelope encrypts data with envelope encryption
func EncryptWithEnvelope(plaintext []byte, masterKey []byte) (*Envelope, error) {
	// Generate data key
	dataKey := make([]byte, 32)
	if _, err := rand.Read(dataKey); err != nil {
		return nil, err
	}

	// Encrypt with data key
	ciphertext, nonce, err := AESEncrypt(plaintext, dataKey)
	if err != nil {
		return nil, err
	}

	// Wrap the data key with the master key, keeping its own nonce.
	encryptedKey, wrappedNonce, err := AESEncrypt(dataKey, masterKey)
	if err != nil {
		return nil, err
	}

	return &Envelope{
		KID:          hex.EncodeToString(encryptedKey),
		Algorithm:    "AES-256-GCM",
		Nonce:        hex.EncodeToString(nonce),
		WrappedNonce: hex.EncodeToString(wrappedNonce),
		Data:         hex.EncodeToString(ciphertext),
	}, nil
}

// DecryptWithEnvelope decrypts data with envelope encryption
func DecryptWithEnvelope(envelope *Envelope, masterKey []byte) ([]byte, error) {
	if envelope == nil {
		return nil, fmt.Errorf("envelope is nil")
	}

	encryptedKey, err := hex.DecodeString(envelope.KID)
	if err != nil {
		return nil, fmt.Errorf("invalid wrapped key: %w", err)
	}
	nonce, err := hex.DecodeString(envelope.Nonce)
	if err != nil {
		return nil, fmt.Errorf("invalid nonce: %w", err)
	}
	wrappedNonce, err := hex.DecodeString(envelope.WrappedNonce)
	if err != nil {
		return nil, fmt.Errorf("invalid wrapped nonce: %w", err)
	}
	ciphertext, err := hex.DecodeString(envelope.Data)
	if err != nil {
		return nil, fmt.Errorf("invalid ciphertext: %w", err)
	}

	// Unwrap the data key using the nonce it was wrapped with.
	dataKey, err := AESDecrypt(encryptedKey, masterKey, wrappedNonce)
	if err != nil {
		return nil, err
	}

	// Decrypt data with data key
	plaintext, err := AESDecrypt(ciphertext, dataKey, nonce)
	return plaintext, err
}

// =============================================================================
// HMAC & SIGNATURES
// =============================================================================

// HMAC creates an HMAC-SHA256 tag.
//
// The previous version returned sha256(key || message), which is not an HMAC
// and is vulnerable to length extension attacks.
func HMAC(key, message []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(message)
	return mac.Sum(nil)
}

// VerifyHMAC verifies an HMAC
func VerifyHMAC(key, message, expected []byte) bool {
	actual := HMAC(key, message)
	return constantTimeCompare(actual, expected)
}

// =============================================================================
// KEY STORAGE (simulated - production should use HSM)
// =============================================================================

// KeyStore represents a secure key store
type KeyStore struct {
	keys map[string][]byte
}

func NewKeyStore() *KeyStore {
	return &KeyStore{keys: make(map[string][]byte)}
}

func (ks *KeyStore) Store(keyID string, key []byte) {
	ks.keys[keyID] = key
}

func (ks *KeyStore) Get(keyID string) ([]byte, bool) {
	key, ok := ks.keys[keyID]
	return key, ok
}

func (ks *KeyStore) Delete(keyID string) {
	delete(ks.keys, keyID)
}

// =============================================================================
// UTILITIES
// =============================================================================

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func hexEncode(data []byte) string {
	return hex.EncodeToString(data)
}

func hexDecode(s string) ([]byte, error) {
	return hex.DecodeString(s)
}
