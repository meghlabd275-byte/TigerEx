package exchange

import (
	"math"
	"math/big"
	"regexp"
	"strconv"
)

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// isUUID reports whether s is a syntactically valid UUID. Identifiers are
// validated before they reach a query so a malformed id is a 400, not a
// database error.
func isUUID(s string) bool {
	return uuidRe.MatchString(s)
}

// ready reports whether the store has a live connection pool. Every method
// checks it first so an unconfigured store returns ErrUnavailable rather than
// dereferencing a nil pool.
func (s *Store) ready() error {
	if s == nil || s.pool == nil {
		return ErrUnavailable
	}
	return nil
}

// formatDecimal renders a float as a plain decimal string for the order book,
// which the exchange API exposes as [price, quantity] string pairs. It avoids
// scientific notation, which a JSON client cannot parse as a decimal.
func formatDecimal(v float64) string {
	if v == 0 {
		return "0"
	}
	// 15 significant digits matches the DECIMAL(30,15) columns.
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// toDec converts a float64 amount to a big.Float for exact decimal arithmetic.
// Money must never be summed in binary floating point.
func toDec(v float64) *big.Float {
	return new(big.Float).SetFloat64(v)
}

// decString renders a big.Float without an exponent.
func decString(f *big.Float) string {
	return f.Text('f', 15)
}

// finite reports whether v is a real, finite number. NaN and infinities are
// rejected at every boundary so they cannot corrupt a balance.
func finite(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}
