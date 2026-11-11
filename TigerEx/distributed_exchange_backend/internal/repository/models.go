// Package repository holds the GORM models for the distributed exchange
// backend. Amounts are stored as integer minor units (for example satoshi-like
// counts) so a balance is never a floating-point value.
package repository

import "time"

// User is an authenticated account. The password is stored as a bcrypt hash,
// never in clear, and is excluded from JSON so it can never be serialized into
// a response.
type User struct {
	ID        string    `gorm:"primaryKey;size:36" json:"id"`
	Email     string    `gorm:"uniqueIndex;size:255" json:"email"`
	Phone     string    `gorm:"uniqueIndex;size:32" json:"phone,omitempty"`
	Password  string    `gorm:"size:255" json:"-"`
	Role      string    `gorm:"size:32;default:user" json:"role"`
	KycStatus string    `gorm:"size:32;default:none" json:"kyc_status"`
	Status    string    `gorm:"size:32;default:active" json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Session is a durable record of an issued access token. Callers persist only
// a hash of the token, never the token itself.
type Session struct {
	ID          string    `gorm:"primaryKey;size:36" json:"id"`
	UserID      string    `gorm:"index;size:36" json:"user_id"`
	TokenHash   string    `gorm:"uniqueIndex;size:128" json:"-"`
	RefreshHash string    `gorm:"index;size:128" json:"-"`
	IPAddress   string    `gorm:"size:64" json:"ip_address"`
	UserAgent   string    `gorm:"size:255" json:"user_agent"`
	ExpiresAt   time.Time `json:"expires_at"`
	Revoked     bool      `gorm:"default:false" json:"revoked"`
	CreatedAt   time.Time `json:"created_at"`
}

// Order is a resting or filled order. Price and quantity are integer minor
// units; AvgPrice is the volume-weighted fill price in the same units.
type Order struct {
	ID        string    `gorm:"primaryKey;size:36" json:"id"`
	UserID    string    `gorm:"index;size:36" json:"user_id"`
	Symbol    string    `gorm:"index;size:32" json:"symbol"`
	Side      string    `gorm:"size:8" json:"side"`
	Type      string    `gorm:"size:16" json:"type"`
	Price     int64     `json:"price"`
	Quantity  int64     `json:"quantity"`
	FilledQty int64     `json:"filled_qty"`
	AvgPrice  int64     `json:"avg_price"`
	Status    string    `gorm:"index;size:16;default:new" json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Wallet is one balance row per (user, currency). A user may hold several
// currencies; each is a separate row so a movement only ever touches one asset.
type Wallet struct {
	ID        string    `gorm:"primaryKey;size:36" json:"id"`
	UserID    string    `gorm:"index:idx_wallet_user_currency,unique,priority:1;size:36" json:"user_id"`
	Currency  string    `gorm:"index:idx_wallet_user_currency,unique,priority:2;size:16" json:"currency"`
	Balance   int64     `gorm:"default:0" json:"balance"`
	Locked    int64     `gorm:"default:0" json:"locked"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Transaction is an append-only ledger entry for a deposit or withdrawal.
type Transaction struct {
	ID        string    `gorm:"primaryKey;size:36" json:"id"`
	UserID    string    `gorm:"index;size:36" json:"user_id"`
	Type      string    `gorm:"size:16" json:"type"`
	Currency  string    `gorm:"size:16" json:"currency"`
	Amount    int64     `json:"amount"`
	TxHash    string    `gorm:"index;size:128" json:"tx_hash,omitempty"`
	Address   string    `gorm:"size:128" json:"address,omitempty"`
	Status    string    `gorm:"size:16" json:"status"`
	CreatedAt time.Time `json:"created_at"`
}
