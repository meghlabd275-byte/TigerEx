package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// ============================================================================
// INPUT VALIDATOR - Go Implementation
// Input validation for TigerEx orders and data
// ============================================================================

// ValidationError represents a validation error
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// Errors returns validation errors as strings
func (ve *ValidationError) Error() string {
	return fmt.Sprintf("%s: %s", ve.Field, ve.Message)
}

// Validator provides validation functions
type Validator struct{}

// NewValidator creates a new validator
func NewValidator() *Validator {
	return &Validator{}
}

// ValidateOrder validates a trading order
func (v *Validator) ValidateOrder(order map[string]interface{}) []string {
	var errors []string

	// Symbol validation
	if symbol, ok := order["symbol"].(string); !ok || symbol == "" {
		errors = append(errors, "Missing symbol")
	} else if !v.ValidateSymbol(symbol) {
		errors = append(errors, "Invalid symbol format")
	}

	// Price validation
	price, ok := order["price"]
	if !ok {
		errors = append(errors, "Missing price")
	} else if !v.ValidatePrice(price) {
		errors = append(errors, "Invalid price")
	}

	// Quantity validation
	qty, ok := order["quantity"]
	if !ok {
		errors = append(errors, "Missing quantity")
	} else if !v.ValidateQuantity(qty) {
		errors = append(errors, "Invalid quantity")
	}

	return errors
}

// ValidateSymbol validates trading symbol
func (v *Validator) ValidateSymbol(symbol string) bool {
	if symbol == "" {
		return false
	}
	// Basic format: BASE/QUOTE (e.g., BTC/USDT)
	matched, _ := regexp.MatchString(`^[A-Z]{2,10}/[A-Z]{2,10}$`, strings.ToUpper(symbol))
	return matched
}

// ValidatePrice validates price
func (v *Validator) ValidatePrice(price interface{}) bool {
	var priceVal float64
	switch p := price.(type) {
	case float64:
		priceVal = p
	case float32:
		priceVal = float64(p)
	case int:
		priceVal = float64(p)
	case string:
		f, err := strconv.ParseFloat(p, 64)
		if err != nil {
			return false
		}
		priceVal = f
	default:
		return false
	}
	return priceVal > 0
}

// ValidateQuantity validates quantity
func (v *Validator) ValidateQuantity(qty interface{}) bool {
	var qtyVal float64
	switch q := qty.(type) {
	case float64:
		qtyVal = q
	case float32:
		qtyVal = float64(q)
	case int:
		qtyVal = float64(q)
	case string:
		f, err := strconv.ParseFloat(q, 64)
		if err != nil {
			return false
		}
		qtyVal = f
	default:
		return false
	}
	return qtyVal > 0
}

// ValidateAddress validates blockchain address
func (v *Validator) ValidateAddress(addr string, chain string) bool {
	if addr == "" || len(addr) < 26 {
		return false
	}

	switch strings.ToUpper(chain) {
	case "BTC":
		// Bitcoin address (starts with 1 or 3 or bc1)
		matched, _ := regexp.MatchString(`^(1|3|bc1)[a-zA-Z0-9]{25,62}$`, addr)
		return matched
	case "ETH":
		// Ethereum address (starts with 0x, 42 chars)
		matched, _ := regexp.MatchString(`^0x[a-fA-F0-9]{40}$`, addr)
		return matched
	case "TRX", "TRC20":
		// Tron address (starts with T, 34 chars)
		matched, _ := regexp.MatchString(`^T[a-zA-Z0-9]{33}$`, addr)
		return matched
	default:
		return len(addr) >= 26
	}
}

// ValidateAmount validates amount
func (v *Validator) ValidateAmount(amount interface{}, minAmount float64) bool {
	var amt float64
	switch a := amount.(type) {
	case float64:
		amt = a
	case float32:
		amt = float64(a)
	case int:
		amt = float64(a)
	case string:
		f, err := strconv.ParseFloat(a, 64)
		if err != nil {
			return false
		}
		amt = f
	default:
		return false
	}
	return amt >= minAmount
}

// ValidateEmail validates email address
func (v *Validator) ValidateEmail(email string) bool {
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(email)
}

// ValidateUsername validates username
func (v *Validator) ValidateUsername(username string) bool {
	if len(username) < 3 || len(username) > 32 {
		return false
	}
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9_]+$`, username)
	return matched
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	v := NewValidator()

	// Validate order
	order := map[string]interface{}{
		"symbol":   "BTC/USDT",
		"price":   50000.0,
		"quantity": 1.0,
	}

	errors := v.ValidateOrder(order)
	fmt.Printf("Order validation errors: %v\n", errors)

	//Validate symbol
	fmt.Printf("Valid BTC/USDT: %v\n", v.ValidateSymbol("BTC/USDT"))
	fmt.Printf("Valid INVALID: %v\n", v.ValidateSymbol("INVALID"))

	// Validate address
	fmt.Printf("Valid BTC addr: %v\n", v.ValidateAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "BTC"))
	fmt.Printf("Valid ETH addr: %v\n", v.ValidateAddress("0x742d35Cc6634C0532925a3b844Bc454e4438f44e", "ETH"))

	// Validate amount
	fmt.Printf("Valid amount 100: %v\n", v.ValidateAmount(100.0, 0.001))
	fmt.Printf("Valid amount 0.0001: %v\n", v.ValidateAmount(0.0001, 0.001))

	// Email validation
	fmt.Printf("Valid email: %v\n", v.ValidateEmail("user@example.com"))
}