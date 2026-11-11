package repository

import (
	"crypto/sha256"
	"encoding/hex"
)

// HashToken returns a stable, one-way digest of an opaque token. Sessions and
// refresh tokens are keyed by this digest so the raw credential is never stored
// in Redis or the database.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
