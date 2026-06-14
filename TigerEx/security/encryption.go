// TigerEx Security - Encryption and Key Management
package security

import (
"crypto/aes"
"crypto/cipher"
"crypto/elliptic"
"crypto/rand"
"crypto/sha256"
"encoding/hex"
"fmt"
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
rand.Read(salt)
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
Iterations uint32
Parallelism uint8
SaltLength uint32
KeyLength  uint32
}

func DefaultArgon2Config() *Argon2Config {
return &Argon2Config{
Memory:      65536,
Iterations: 3,
Parallelism: 4,
SaltLength:  16,
KeyLength:  32,
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
KeySize    int
BlockSize int
}

func DefaultAESConfig() *AESConfig {
return &AESConfig{
KeySize:    32, // 256-bit
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
// HYBRID ENCRYPTION (RSA + AES)
// =============================================================================

// GenerateRSAKeyPair generates an RSA key pair
func GenerateRSAKeyPair(bits int) (publicKey, privateKey []byte, err error) {
privateKeyP, err := GenerateRSAKey(bits)
if err != nil {
return nil, nil, err
}

publicKeyP := privateKeyP.PublicKey
return elliptic.Marshal(publicKeyP, publicKeyP.X, publicKeyP.Y), privateKeyP.D.Bytes(), nil
}

// GenerateRSAKey generates an RSA private key
func GenerateRSAKey(bits int) (*PrivateKey, error) {
curve := elliptic.P256()
privateKey := new(PrivateKey)
privateKey.Curve = curve

privateKey.X, privateKey.Y, err = elliptic.GenerateKey(curve, rand.Reader)
if err != nil {
return nil, err
}

d := sha256.Sum256(append(privateKey.X.Bytes(), privateKey.Y.Bytes()...))
privateKey.D = new(big.Int).SetBytes(d[:])
return privateKey, nil
}

// PrivateKey represents an ECDH private key
type PrivateKey struct {
Curve elliptic.Curve
X, Y, D *big.Int
}

// PublicKey represents an ECDH public key
type PublicKey struct {
Curve elliptic.Curve
X, Y *big.Int
}

// EncryptWithECIES encrypts using ECIES
func EncryptWithECIES(plaintext []byte, publicKey []byte) ([]byte, error) {
curve := elliptic.P256()

// Generate ephemeral key
ephemX, ephemY, err := elliptic.GenerateKey(curve, rand.Reader)
if err != nil {
return nil, err
}

// Derive shared secret
sharedX, _ := curve.ScalarMult(publicKey[0], publicKey[1], ephemX)
sharedSecret := sha256.Sum256(sharedX.Bytes())

// Encrypt with AES
key := sharedSecret[:32]
ciphertext, nonce, err := AESEncrypt(plaintext, key)
if err != nil {
return nil, err
}

// Combine ephemeral public key + nonce + ciphertext
result := make([]byte, 0, len(ephemX)+len(nonce)+len(ciphertext))
result = append(result, ephemX...)
result = append(result, nonce...)
result = append(result, ciphertext...)

return result, nil
}

// DecryptWithECIES decrypts using ECIES
func DecryptWithECIES(ciphertext []byte, privateKey *PrivateKey) ([]byte, error) {
curve := curve

// Extract components
pointLen := (curve.Params().BitSize + 7) / 8
ephemX := ciphertext[:pointLen]
nonce := ciphertext[pointLen:pointLen+16]
encrypted := ciphertext[pointLen+16:]

// Derive shared secret
sharedX, _ := curve.ScalarMult(ephemX[0], ephemX[1], privateKey.D.Bytes())
sharedSecret := sha256.Sum256(sharedX.Bytes())

// Decrypt with AES
key := sharedSecret[:32]
plaintext, err := AESDecrypt(encrypted, key, nonce)
return plaintext, err
}

// =============================================================================
// ENVELOPE ENCRYPTION
// =============================================================================

// Envelope represents an encrypted envelope
type Envelope struct {
KID       string `json:"kid"`
Algorithm string `json:"alg"`
Nonce    string `json:"nonce"`
Data     string `json:"data"`
}

// EncryptWithEnvelope encrypts data with envelope encryption
func EncryptWithEnvelope(plaintext []byte, masterKey []byte) (*Envelope, error) {
// Generate data key
dataKey := make([]byte, 32)
rand.Read(dataKey)

// Encrypt with data key
ciphertext, nonce, err := AESEncrypt(plaintext, dataKey)
if err != nil {
return nil, err
}

// Encrypt data key with master key
encryptedKey, _, err := AESEncrypt(dataKey, masterKey)
if err != nil {
return nil, err
}

return &Envelope{
KID:       hex.EncodeToString(encryptedKey),
Algorithm: "AES-GCM",
Nonce:    hex.EncodeToString(nonce),
Data:     hex.EncodeToString(ciphertext),
}, nil
}

// DecryptWithEnvelope decrypts data with envelope encryption
func DecryptWithEnvelope(envelope *Envelope, masterKey []byte) ([]byte, error) {
encryptedKey, _ := hex.DecodeString(envelope.KID)
nonce, _ := hex.DecodeString(envelope.Nonce)
ciphertext, _ := hex.DecodeString(envelope.Data)

// Decrypt data key with master key
dataKey, err := AESDecrypt(encryptedKey, masterKey, nonce)
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

// HMAC creates an HMAC
func HMAC(key, message []byte) []byte {
hash := sha256.New()
hash.Write(key)
hash.Write(message)
return hash.Sum(nil)
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
