package common

import (
	"errors"
	"regexp"
	"strings"
)

// ValidationError custom error type
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return e.Field + ": " + e.Message
}

// UserValidators for user-related validation
var UserValidators = map[string]func(string) error{
	"email": ValidateEmail,
	"password": ValidatePassword,
	"username": ValidateUsername,
}

// ValidateEmail checks email format
func ValidateEmail(value string) error {
	emailRegex := regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	if !emailRegex.MatchString(value) {
		return &ValidationError{Field: "email", Message: "Invalid email format"}
	}
	return nil
}

// ValidatePassword checks password strength
func ValidatePassword(value string) error {
	if len(value) < 8 {
		return &ValidationError{Field: "password", Message: "Password must be at least 8 characters"}
	}
	if !strings.ContainsAny(value, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
		return &ValidationError{Field: "password", Message: "Password must contain uppercase"}
	}
	if !strings.ContainsAny(value, "abcdefghijklmnopqrstuvwxyz") {
		return &ValidationError{Field: "password", Message: "Password must contain lowercase"}
	}
	if !strings.ContainsAny(value, "0123456789") {
		return &ValidationError{Field: "password", Message: "Password must contain number"}
	}
	return nil
}

// ValidateUsername checks username format
func ValidateUsername(value string) error {
	if len(value) < 3 {
		return &ValidationError{Field: "username", Message: "Username must be at least 3 characters"}
	}
	if len(value) > 20 {
		return &ValidationError{Field: "username", Message: "Username must be at most 20 characters"}
	}
	usernameRegex := regexp.MustCompile(`^[a-zA-Z0-9_]+$`)
	if !usernameRegex.MatchString(value) {
		return &ValidationError{Field: "username", Message: "Username can only contain letters, numbers, underscore"}
	}
	return nil
}

// TradingValidators for trading-related validation
var TradingValidators = map[string]func(interface{}) error{
	"orderSide": func(v interface{}) error { return ValidateOrderSide(v.(string)) },
	"orderType": func(v interface{}) error { return ValidateOrderType(v.(string)) },
	"price": func(v interface{}) error { return ValidatePrice(v.(float64), 0) },
	"quantity": func(v interface{}) error { return ValidateQuantity(v.(float64), 0) },
	"leverage": func(v interface{}) error { return ValidateLeverage(v.(int)) },
}

// ValidateOrderSide checks order side
func ValidateOrderSide(value string) error {
	value = strings.ToLower(value)
	if value != "buy" && value != "sell" {
		return errors.New("order side must be buy or sell")
	}
	return nil
}

// ValidOrderTypes list
var ValidOrderTypes = []string{"market", "limit", "stop_market", "stop_limit", "take_profit", "trailing"}

// ValidateOrderType checks order type
func ValidateOrderType(value string) error {
	value = strings.ToLower(value)
	for _, t := range ValidOrderTypes {
		if value == t {
			return nil
		}
	}
	return &ValidationError{Field: "type", Message: "Invalid order type"}
}

// ValidatePrice checks price value
func ValidatePrice(value float64, minPrice float64) error {
	if value <= minPrice {
		return &ValidationError{Field: "price", Message: "Price must be greater than " + formatFloat(minPrice)}
	}
	return nil
}

// ValidateQuantity checks quantity value
func ValidateQuantity(value float64, minQty float64) error {
	if value <= minQty {
		return &ValidationError{Field: "quantity", Message: "Quantity must be greater than " + formatFloat(minQty)}
	}
	return nil
}

// ValidLeverageOptions list
var ValidLeverageOptions = []int{1, 2, 3, 5, 10, 20, 25, 50, 75, 100}

// ValidateLeverage checks leverage value
func ValidateLeverage(value int) error {
	for _, l := range ValidLeverageOptions {
		if value == l {
			return nil
		}
	}
	return &ValidationError{Field: "leverage", Message: "Invalid leverage"}
}

// WalletValidators for wallet-related validation
var WalletValidators = map[string]func(interface{}) error{
	"address": func(v interface{}) error {
		args := v.([]interface{})
		return ValidateWalletAddress(args[0].(string), args[1].(string))
	},
	"amount": func(v interface{}) error { return ValidateAmount(v.(float64), 0) },
}

// ValidateWalletAddress validates crypto address
func ValidateWalletAddress(address string, currency string) error {
	if len(address) < 20 {
		return &ValidationError{Field: "address", Message: "Invalid wallet address"}
	}
	return nil
}

// ValidateAmount validates amount
func ValidateAmount(value float64, minAmount float64) error {
	if value <= minAmount {
		return &ValidationError{Field: "amount", Message: "Amount must be greater than " + formatFloat(minAmount)}
	}
	if value > 1e15 {
		return &ValidationError{Field: "amount", Message: "Amount exceeds maximum"}
	}
	return nil
}

// KYCDocumentTypes list
var KYCDocumentTypes = []string{"passport", "drivers_license", "national_id"}

// ValidateKYCDocumentType validates KYC document
func ValidateKYCDocumentType(value string) error {
	for _, t := range KYCDocumentTypes {
		if value == t {
			return nil
		}
	}
	return &ValidationError{Field: "documentType", Message: "Invalid document type"}
}

// ValidateKYCcountry validates country code
func ValidateKYCCountry(value string) error {
	if len(value) != 2 {
		return &ValidationError{Field: "country", Message: "Invalid country code"}
	}
	return nil
}

// Helper function
func formatFloat(f float64) string {
	return string(rune('0' + int(f)))
}