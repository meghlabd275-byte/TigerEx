package earn

import "github.com/google/uuid"

// newID returns a random RFC 4122 identifier for a new record.
func newID() string {
	return uuid.NewString()
}
