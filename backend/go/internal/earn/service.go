// Package earn implements the savings, lending, and sub-account features.
//
// Every operation here moves user funds or grants delegated account access, so
// the package follows two rules:
//
//  1. Nothing is fabricated. Interest is derived from the stored position and
//     the elapsed wall-clock time, collateral is valued from a real price
//     source, and an operation that cannot be completed returns an error
//     instead of a plausible-looking zero.
//  2. Interest is truncated rather than rounded, so a deposit/withdraw loop can
//     never mint value from rounding.
package earn

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

// secondsPerYear is the denominator for pro-rata interest. A year is taken as
// 365 days, the convention exchanges publish for flexible savings.
const secondsPerYear = 365 * 24 * 60 * 60

var (
	// ErrStoreUnavailable is returned when no durable store is configured.
	ErrStoreUnavailable = errors.New("earn persistence is not configured")
	// ErrProductNotFound is returned for an unknown product.
	ErrProductNotFound = errors.New("product not found")
	// ErrPositionNotFound is returned for an unknown position.
	ErrPositionNotFound = errors.New("position not found")
	// ErrInvalidAmount is returned for a non-positive or non-finite amount.
	ErrInvalidAmount = errors.New("invalid amount")
	// ErrBelowMinimum is returned when an amount is under the product minimum.
	ErrBelowMinimum = errors.New("amount is below the product minimum")
	// ErrLocked is returned when funds are still inside a lock period.
	ErrLocked = errors.New("funds are still locked")
	// ErrInsufficientFunds is returned when a position holds too little.
	ErrInsufficientFunds = errors.New("insufficient funds in position")
	// ErrUnauthorized is returned when a position belongs to another user.
	ErrUnauthorized = errors.New("position does not belong to this user")
	// ErrPriceUnavailable is returned when collateral cannot be valued.
	ErrPriceUnavailable = errors.New("collateral price is unavailable")
	// ErrCollateralTooLow is returned when a borrow would exceed the LTV.
	ErrCollateralTooLow = errors.New("collateral is insufficient for the requested borrow")
	// ErrDuplicateSubAccount is returned for a repeated sub-account email.
	ErrDuplicateSubAccount = errors.New("a sub-account with this email already exists")
	// ErrSubAccountLimit is returned when the per-account limit is reached.
	ErrSubAccountLimit = errors.New("sub-account limit reached")
)

// MaxSubAccounts is the per-parent-account limit.
const MaxSubAccounts = 300

// PriceOracle supplies the valuation used for collateral checks. It is an
// interface so the exchange can point it at its own aggregated index price
// rather than a hard-coded number.
type PriceOracle interface {
	// Price returns the price of one unit of baseAsset in quoteAsset.
	Price(ctx context.Context, baseAsset, quoteAsset string) (float64, error)
}

// Config holds service configuration.
type Config struct {
	// Now supplies the current time. Tests inject a fixed clock; production
	// leaves it nil and the service uses time.Now.
	Now func() time.Time
	// Oracle values collateral. A nil oracle makes every borrow fail closed.
	Oracle PriceOracle
}

// SavingsProduct is a flexible or fixed-term savings product.
type SavingsProduct struct {
	ID        string  `json:"id"`
	Asset     string  `json:"asset"`
	Type      string  `json:"type"` // "flexible" or "locked"
	APY       float64 `json:"apy"`
	MinAmount float64 `json:"minAmount"`
	LockDays  int     `json:"lockDays"`
	Status    string  `json:"status"`
}

// SavingsPosition is a user's deposit into a savings product.
type SavingsPosition struct {
	ID            string  `json:"id"`
	UserID        string  `json:"userId"`
	ProductID     string  `json:"productId"`
	Asset         string  `json:"asset"`
	Principal     float64 `json:"principal"`
	APY           float64 `json:"apy"`
	Accrued       float64 `json:"accrued"`
	StartAt       int64   `json:"startAt"`
	UnlockAt      int64   `json:"unlockAt,omitempty"`
	Status        string  `json:"status"` // "active" or "closed"
	LastAccrualAt int64   `json:"lastAccrualAt"`
}

// LendPosition is a user's supply of an asset to the lending pool.
type LendPosition struct {
	ID            string  `json:"id"`
	UserID        string  `json:"userId"`
	Asset         string  `json:"asset"`
	Principal     float64 `json:"principal"`
	APY           float64 `json:"apy"`
	Accrued       float64 `json:"accrued"`
	StartAt       int64   `json:"startAt"`
	LastAccrualAt int64   `json:"lastAccrualAt"`
}

// BorrowPosition is a collateralised loan.
type BorrowPosition struct {
	ID              string  `json:"id"`
	UserID          string  `json:"userId"`
	Asset           string  `json:"asset"`
	Principal       float64 `json:"principal"`
	APY             float64 `json:"apy"`
	Accrued         float64 `json:"accrued"`
	CollateralAsset string  `json:"collateralAsset"`
	Collateral      float64 `json:"collateral"`
	LTV             float64 `json:"ltv"` // percent, e.g. 70 for BTC
	StartAt         int64   `json:"startAt"`
	LastAccrualAt   int64   `json:"lastAccrualAt"`
}

// SubAccount is a delegated trading account owned by a parent user.
type SubAccount struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Status    string `json:"status"`
	CreatedAt int64  `json:"createdAt"`
}

// Store is the persistence seam for the earn package.
type Store interface {
	ListSavingsProducts(ctx context.Context) ([]SavingsProduct, error)
	GetSavingsProduct(ctx context.Context, id string) (*SavingsProduct, error)
	UpsertSavingsProduct(ctx context.Context, product *SavingsProduct) error

	ListSavingsPositions(ctx context.Context, userID string) ([]SavingsPosition, error)
	GetSavingsPosition(ctx context.Context, id string) (*SavingsPosition, error)
	CreateSavingsPosition(ctx context.Context, position *SavingsPosition) error
	UpdateSavingsPosition(ctx context.Context, position *SavingsPosition) error

	ListLendPositions(ctx context.Context, userID string) ([]LendPosition, error)
	GetLendPosition(ctx context.Context, id string) (*LendPosition, error)
	CreateLendPosition(ctx context.Context, position *LendPosition) error
	UpdateLendPosition(ctx context.Context, position *LendPosition) error

	ListBorrowPositions(ctx context.Context, userID string) ([]BorrowPosition, error)
	GetBorrowPosition(ctx context.Context, id string) (*BorrowPosition, error)
	CreateBorrowPosition(ctx context.Context, position *BorrowPosition) error
	UpdateBorrowPosition(ctx context.Context, position *BorrowPosition) error

	ListSubAccounts(ctx context.Context, userID string) ([]SubAccount, error)
	CreateSubAccount(ctx context.Context, sub *SubAccount) error
	DeleteSubAccount(ctx context.Context, userID, id string) error
}

// Service implements savings, lending, and sub-account operations.
type Service struct {
	config Config
	store  Store
}

// NewService returns a service with no store attached. Attach one with
// WithStore; until then every method fails closed.
func NewService(config Config) *Service {
	return &Service{config: config}
}

// WithStore attaches a persistence store.
func (s *Service) WithStore(store Store) *Service {
	s.store = store
	return s
}

// Store returns the attached store, or nil.
func (s *Service) Store() Store { return s.store }

func (s *Service) now() time.Time {
	if s.config.Now != nil {
		return s.config.Now()
	}
	return time.Now()
}

func (s *Service) requireStore() error {
	if s.store == nil {
		return ErrStoreUnavailable
	}
	return nil
}

// AccruedInterest returns the interest a principal earns over an elapsed
// period, pro-rata on a 365-day year.
//
// The result is floored to eight decimal places. Truncating downwards means a
// rounding error can only ever under-pay a user by a negligible amount, never
// let a deposit/withdraw loop mint value.
func AccruedInterest(principal, apy float64, elapsedSeconds int64) float64 {
	if principal <= 0 || apy <= 0 || elapsedSeconds <= 0 {
		return 0
	}
	raw := principal * (apy / 100) * (float64(elapsedSeconds) / float64(secondsPerYear))
	return floorTo8(raw)
}

func floorTo8(v float64) float64 {
	if v <= 0 {
		return 0
	}
	return math.Floor(v*1e8) / 1e8
}

// projectAccrual advances a position's accrued interest to the current time
// and reports whether anything changed. It is the single place interest is
// computed, so savings and lending cannot drift apart.
func (s *Service) projectAccrual(accrued *float64, principal, apy float64, lastAt *int64, now time.Time) bool {
	if principal <= 0 || apy <= 0 {
		*lastAt = now.Unix()
		return false
	}
	if *lastAt == 0 {
		*lastAt = now.Unix()
		return false
	}

	elapsed := now.Unix() - *lastAt
	if elapsed <= 0 {
		return false
	}

	*accrued += AccruedInterest(principal, apy, elapsed)
	*lastAt = now.Unix()
	return true
}

// ---------------------------------------------------------------------------
// Savings
// ---------------------------------------------------------------------------

// ListSavingsProducts returns the active savings products.
func (s *Service) ListSavingsProducts(ctx context.Context) ([]SavingsProduct, error) {
	if err := s.requireStore(); err != nil {
		return nil, err
	}
	products, err := s.store.ListSavingsProducts(ctx)
	if err != nil {
		return nil, err
	}
	active := make([]SavingsProduct, 0, len(products))
	for _, p := range products {
		if p.Status == "active" {
			active = append(active, p)
		}
	}
	return active, nil
}

// UpsertSavingsProduct creates or updates a product. It is used by the admin
// surface.
func (s *Service) UpsertSavingsProduct(ctx context.Context, product *SavingsProduct) error {
	if err := s.requireStore(); err != nil {
		return err
	}
	if err := ValidateSavingsProduct(product); err != nil {
		return err
	}
	return s.store.UpsertSavingsProduct(ctx, product)
}

// ValidateSavingsProduct checks a product definition before it is stored.
func ValidateSavingsProduct(p *SavingsProduct) error {
	if p == nil {
		return errors.New("product is required")
	}
	if strings.TrimSpace(p.ID) == "" {
		return errors.New("product id is required")
	}
	if strings.TrimSpace(p.Asset) == "" {
		return errors.New("product asset is required")
	}
	switch p.Type {
	case "flexible":
		p.LockDays = 0
	case "locked":
		if p.LockDays <= 0 {
			return errors.New("a locked product needs a positive lock period")
		}
	default:
		return errors.New("product type must be flexible or locked")
	}
	if p.APY < 0 || p.APY > 1000 {
		return errors.New("apy must be between 0 and 1000")
	}
	if p.MinAmount < 0 {
		return errors.New("minAmount must not be negative")
	}
	if p.Status == "" {
		p.Status = "active"
	}
	if p.Status != "active" && p.Status != "paused" {
		return errors.New("status must be active or paused")
	}
	return nil
}

// SavingsDeposit opens a savings position.
func (s *Service) SavingsDeposit(ctx context.Context, userID, productID string, amount float64) (*SavingsPosition, error) {
	if err := s.requireStore(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("userId is required")
	}
	if err := validateAmount(amount); err != nil {
		return nil, err
	}

	product, err := s.store.GetSavingsProduct(ctx, productID)
	if err != nil {
		return nil, err
	}
	if product.Status != "active" {
		return nil, errors.New("product is not available")
	}
	if amount < product.MinAmount {
		return nil, ErrBelowMinimum
	}

	now := s.now()
	position := &SavingsPosition{
		ID:            newID(),
		UserID:        userID,
		ProductID:     product.ID,
		Asset:         product.Asset,
		Principal:     amount,
		APY:           product.APY,
		StartAt:       now.Unix(),
		LastAccrualAt: now.Unix(),
		Status:        "active",
	}
	if product.Type == "locked" {
		position.UnlockAt = now.AddDate(0, 0, product.LockDays).Unix()
	}

	if err := s.store.CreateSavingsPosition(ctx, position); err != nil {
		return nil, err
	}
	return position, nil
}

// SavingsWithdraw closes or reduces a savings position and returns the
// principal plus the interest accrued up to the withdrawal.
func (s *Service) SavingsWithdraw(ctx context.Context, userID, positionID string, amount float64) (*SavingsPosition, float64, error) {
	if err := s.requireStore(); err != nil {
		return nil, 0, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, 0, errors.New("userId is required")
	}
	if err := validateAmount(amount); err != nil {
		return nil, 0, err
	}

	position, err := s.store.GetSavingsPosition(ctx, positionID)
	if err != nil {
		return nil, 0, err
	}
	if position.UserID != userID {
		return nil, 0, ErrUnauthorized
	}
	if position.Status != "active" {
		return nil, 0, ErrPositionNotFound
	}

	now := s.now()
	if position.UnlockAt > 0 && position.UnlockAt > now.Unix() {
		return nil, 0, ErrLocked
	}
	if amount > position.Principal {
		return nil, 0, ErrInsufficientFunds
	}

	// Interest is settled in full on withdrawal, then the withdrawn principal
	// is removed. A partial withdrawal leaves the remaining principal earning
	// at the same rate.
	s.projectAccrual(&position.Accrued, position.Principal, position.APY, &position.LastAccrualAt, now)

	payout := amount + position.Accrued
	position.Principal -= amount
	if position.Principal <= 0 {
		position.Principal = 0
		position.Accrued = 0
		position.Status = "closed"
	}

	if err := s.store.UpdateSavingsPosition(ctx, position); err != nil {
		return nil, 0, err
	}
	return position, payout, nil
}

// ListSavingsPositions returns a user's savings positions with interest
// projected to the current time.
func (s *Service) ListSavingsPositions(ctx context.Context, userID string) ([]SavingsPosition, error) {
	if err := s.requireStore(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("userId is required")
	}

	positions, err := s.store.ListSavingsPositions(ctx, userID)
	if err != nil {
		return nil, err
	}

	now := s.now()
	for i := range positions {
		if s.projectAccrual(&positions[i].Accrued, positions[i].Principal, positions[i].APY, &positions[i].LastAccrualAt, now) {
			if err := s.store.UpdateSavingsPosition(ctx, &positions[i]); err != nil {
				return nil, err
			}
		}
	}
	return positions, nil
}

// ---------------------------------------------------------------------------
// Lending
// ---------------------------------------------------------------------------

// Lend supplies an asset to the lending pool.
func (s *Service) Lend(ctx context.Context, userID, asset string, amount, apy float64) (*LendPosition, error) {
	if err := s.requireStore(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("userId is required")
	}
	if strings.TrimSpace(asset) == "" {
		return nil, errors.New("asset is required")
	}
	if err := validateAmount(amount); err != nil {
		return nil, err
	}
	if apy < 0 || apy > 1000 {
		return nil, errors.New("apy must be between 0 and 1000")
	}

	now := s.now()
	position := &LendPosition{
		ID:            newID(),
		UserID:        userID,
		Asset:         strings.ToUpper(strings.TrimSpace(asset)),
		Principal:     amount,
		APY:           apy,
		StartAt:       now.Unix(),
		LastAccrualAt: now.Unix(),
	}
	if err := s.store.CreateLendPosition(ctx, position); err != nil {
		return nil, err
	}
	return position, nil
}

// ListLendPositions returns a user's lending positions.
func (s *Service) ListLendPositions(ctx context.Context, userID string) ([]LendPosition, error) {
	if err := s.requireStore(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("userId is required")
	}

	positions, err := s.store.ListLendPositions(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	for i := range positions {
		if s.projectAccrual(&positions[i].Accrued, positions[i].Principal, positions[i].APY, &positions[i].LastAccrualAt, now) {
			if err := s.store.UpdateLendPosition(ctx, &positions[i]); err != nil {
				return nil, err
			}
		}
	}
	return positions, nil
}

// Borrow opens a collateralised loan after valuing the collateral with the
// configured oracle.
func (s *Service) Borrow(ctx context.Context, userID, asset string, amount, apy float64, collateralAsset string, collateralAmount, ltv float64) (*BorrowPosition, error) {
	if err := s.requireStore(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("userId is required")
	}
	if err := validateAmount(amount); err != nil {
		return nil, err
	}
	if err := validateAmount(collateralAmount); err != nil {
		return nil, err
	}
	if apy < 0 || apy > 1000 {
		return nil, errors.New("apy must be between 0 and 1000")
	}
	if ltv <= 0 || ltv > 95 {
		return nil, errors.New("ltv must be greater than 0 and at most 95")
	}

	asset = strings.ToUpper(strings.TrimSpace(asset))
	collateralAsset = strings.ToUpper(strings.TrimSpace(collateralAsset))
	if asset == "" || collateralAsset == "" {
		return nil, errors.New("asset and collateralAsset are required")
	}

	// The loan must be covered by collateral at the published LTV. Valuing the
	// collateral from a live source is what makes this check meaningful; a
	// hard-coded price would let an attacker borrow against worthless
	// collateral.
	if s.config.Oracle == nil {
		return nil, ErrPriceUnavailable
	}
	collateralPrice, err := s.config.Oracle.Price(ctx, collateralAsset, asset)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPriceUnavailable, err)
	}
	if collateralPrice <= 0 {
		return nil, ErrPriceUnavailable
	}

	maxBorrow := collateralAmount * collateralPrice * (ltv / 100)
	if amount > maxBorrow {
		return nil, ErrCollateralTooLow
	}

	now := s.now()
	position := &BorrowPosition{
		ID:              newID(),
		UserID:          userID,
		Asset:           asset,
		Principal:       amount,
		APY:             apy,
		CollateralAsset: collateralAsset,
		Collateral:      collateralAmount,
		LTV:             ltv,
		StartAt:         now.Unix(),
		LastAccrualAt:   now.Unix(),
	}
	if err := s.store.CreateBorrowPosition(ctx, position); err != nil {
		return nil, err
	}
	return position, nil
}

// ListBorrowPositions returns a user's loans with interest projected to the
// current time.
func (s *Service) ListBorrowPositions(ctx context.Context, userID string) ([]BorrowPosition, error) {
	if err := s.requireStore(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("userId is required")
	}

	positions, err := s.store.ListBorrowPositions(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	for i := range positions {
		if s.projectAccrual(&positions[i].Accrued, positions[i].Principal, positions[i].APY, &positions[i].LastAccrualAt, now) {
			if err := s.store.UpdateBorrowPosition(ctx, &positions[i]); err != nil {
				return nil, err
			}
		}
	}
	return positions, nil
}

// ---------------------------------------------------------------------------
// Sub-accounts
// ---------------------------------------------------------------------------

// ListSubAccounts returns a user's sub-accounts.
func (s *Service) ListSubAccounts(ctx context.Context, userID string) ([]SubAccount, error) {
	if err := s.requireStore(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("userId is required")
	}
	return s.store.ListSubAccounts(ctx, userID)
}

// CreateSubAccount creates a delegated account under a parent user.
func (s *Service) CreateSubAccount(ctx context.Context, userID, name, email string) (*SubAccount, error) {
	if err := s.requireStore(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("userId is required")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("name is required")
	}
	if len(name) > 100 {
		return nil, errors.New("name must be at most 100 characters")
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if err := ValidateSubAccountEmail(email); err != nil {
		return nil, err
	}

	existing, err := s.store.ListSubAccounts(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(existing) >= MaxSubAccounts {
		return nil, ErrSubAccountLimit
	}
	for _, sub := range existing {
		if strings.EqualFold(sub.Email, email) {
			return nil, ErrDuplicateSubAccount
		}
	}

	sub := &SubAccount{
		ID:        newID(),
		UserID:    userID,
		Name:      name,
		Email:     email,
		Status:    "active",
		CreatedAt: s.now().Unix(),
	}
	if err := s.store.CreateSubAccount(ctx, sub); err != nil {
		return nil, err
	}
	return sub, nil
}

// DeleteSubAccount removes a sub-account owned by the caller.
func (s *Service) DeleteSubAccount(ctx context.Context, userID, subAccountID string) error {
	if err := s.requireStore(); err != nil {
		return err
	}
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(subAccountID) == "" {
		return errors.New("userId and subAccountId are required")
	}
	// The store scopes the delete by user id, so one user cannot delete
	// another user's sub-account.
	return s.store.DeleteSubAccount(ctx, userID, subAccountID)
}

// ValidateSubAccountEmail applies a stricter check than a plain "@" search: the
// domain must contain a dot and neither part may contain whitespace.
func ValidateSubAccountEmail(email string) error {
	email = strings.TrimSpace(email)
	if email == "" {
		return errors.New("email is required")
	}
	if len(email) > 254 {
		return errors.New("email is too long")
	}
	at := strings.LastIndex(email, "@")
	if at <= 0 || at == len(email)-1 {
		return errors.New("invalid email address")
	}
	local, domain := email[:at], email[at+1:]
	if strings.ContainsAny(local, " \t\r\n") || strings.ContainsAny(domain, " \t\r\n") {
		return errors.New("invalid email address")
	}
	if !strings.Contains(domain, ".") {
		return errors.New("invalid email address")
	}
	if strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") {
		return errors.New("invalid email address")
	}
	return nil
}

func validateAmount(amount float64) error {
	if amount <= 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return ErrInvalidAmount
	}
	if amount > 1e15 {
		return ErrInvalidAmount
	}
	return nil
}
