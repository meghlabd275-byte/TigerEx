// Package sms_verification provides SMS verification services.
// Migrated from TypeScript to Go for 2FA via SMS.
package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// Verification code
type VerificationCode struct {
	ID        string  `json:"id"`
	Phone    string  `json:"phone"`
	Code     string  `json:"code"`
	Purpose  string  `json:"purpose"` // login, withdraw, kyc
	Status   string  `json:"status"` // pending, verified, expired
	Attempts int     `json:"attempts"`
	ExpiresAt int64   `json:"expiresAt"`
	VerifiedAt int64 `json:"verifiedAt"`
}

// Store
type SMSStore struct {
	mu      sync.RWMutex
	codes   map[string]*VerificationCode
}

var (
	smsStore = &SMSStore{
		codes: make(map[string]*VerificationCode),
	}
)

// Send verification code
func SendCode(phone, purpose string) (*VerificationCode, error) {
	code := generateCode()

	vc := &VerificationCode{
		ID: fmt.Sprintf("verif_%d", time.Now().UnixNano()),
		Phone: phone,
		Code: code,
		Purpose: purpose,
		Status: "pending",
		Attempts: 0,
		ExpiresAt: time.Now().UnixMilli() + 300000, // 5 mins
	}

	// In real impl: send SMS via gateway

	smsStore.mu.Lock()
	defer smsStore.mu.Unlock()
	smsStore.codes[vc.ID] = vc

	return vc, nil
}

// Verify code
func Verify(phone, code string) (bool, error) {
	smsStore.mu.RLock()
	defer smsStore.mu.RUnlock()

	for _, vc := range smsStore.codes {
		if vc.Phone == phone && vc.Code == code && vc.Status == "pending" {
			if time.Now().UnixMilli() > vc.ExpiresAt {
				vc.Status = "expired"
				return false, fmt.Errorf("code expired")
			}

			vc.Status = "verified"
			vc.VerifiedAt = time.Now().UnixMilli()
			return true, nil
		}
	}

	return false, fmt.Errorf("invalid code")
}

// Resend code
func Resend(phone string) (*VerificationCode, error) {
	// Find existing and invalidate
	smsStore.mu.RLock()
	for _, vc := range smsStore.codes {
		if vc.Phone == phone && vc.Status == "pending" {
			vc.Status = "expired"
		}
	}
	smsStore.mu.RUnlock()

	// Send new
	return SendCode(phone, "")
}

// Expire old codes
func ExpireOldCodes() int {
	smsStore.mu.RLock()
	defer smsStore.mu.RUnlock()

	count := 0
	now := time.Now().UnixMilli()

	for _, vc := range smsStore.codes {
		if vc.Status == "pending" && now > vc.ExpiresAt {
			vc.Status = "expired"
			count++
		}
	}

	return count
}

func generateCode() string {
	const digits = "0123456789"
	code := make([]byte, 6)
	for i := range code {
		code[i] = digits[rand.Intn(len(digits))]
	}
	return string(code)
}

func main() {
	fmt.Println("SMS Verification service initialized")

	// Send code
	vc, _ := SendCode("+1234567890", "login")
	fmt.Printf("Code sent: %s\n", vc.Code)

	// Verify
	valid, _ := Verify("+1234567890", vc.Code)
	fmt.Printf("Valid: %v\n", valid)
}