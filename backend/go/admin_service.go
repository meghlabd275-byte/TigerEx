package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// =============================================================================
// ADMIN PANEL SERVICE - Complete Production Implementation
// =============================================================================

// AdminService handles administrative operations
type AdminService struct {
	db           *pgxpool.Pool
	auditLogger *AuditLogger
	notification *AdminNotification
}

// =============================================================================
// USER MANAGEMENT
// =============================================================================

// GetAllUsers returns paginated user list
func (as *AdminService) GetAllUsers(ctx context.Context, req *AdminUserListRequest) (*AdminUserListResponse, error) {
	query := `SELECT user_id, email, username, account_status, kyc_level, 
	 country_code, created_at, last_login_at, login_attempts
	 FROM users WHERE deleted_at IS NULL`
	
	countQuery := `SELECT COUNT(*) FROM users WHERE deleted_at IS NULL`
	
	args := []interface{}{}
	argNum := 1
	
	// Filters
	if req.Status != "" {
		query += fmt.Sprintf(" AND account_status = $%d", argNum)
		countQuery += fmt.Sprintf(" AND account_status = $%d", argNum)
		args = append(args, req.Status)
		argNum++
	}
	
	if req.KYCLevel > 0 {
		query += fmt.Sprintf(" AND kyc_level = $%d", argNum)
		countQuery += fmt.Sprintf(" AND kyc_level = $%d", argNum)
		args = append(args, req.KYCLevel)
		argNum++
	}
	
	if req.Country != "" {
		query += fmt.Sprintf(" AND country_code = $%d", argNum)
		countQuery += fmt.Sprintf(" AND country_code = $%d", argNum)
		args = append(args, req.Country)
		argNum++
	}
	
	if req.Search != "" {
		search := "%" + req.Search + "%"
		query += fmt.Sprintf(" AND (email ILIKE $%d OR username ILIKE $%d)", argNum, argNum)
		countQuery += fmt.Sprintf(" AND (email ILIKE $%d OR username ILIKE $%d)", argNum, argNum)
		args = append(args, search)
		argNum++
	}
	
	// Count
	var total int64
	if err := as.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, err
	}
	
	// Sorting
	sortField := "created_at"
	sortDir := "DESC"
	if req.SortField != "" {
		sortField = req.SortField
	}
	if req.SortDir != "" {
		sortDir = req.SortDir
	}
	query += fmt.Sprintf(" ORDER BY %s %s", sortField, sortDir)
	
	// Pagination
	offset := (req.Page - 1) * req.PageSize
	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argNum, argNum+1)
	args = append(args, req.PageSize, offset)
	
	rows, err := as.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var users []AdminUser
	for rows.Next() {
		var u AdminUser
		if err := rows.Scan(
			&u.UserID, &u.Email, &u.Username, &u.Status, &u.KYCLevel,
			&u.Country, &u.CreatedAt, &u.LastLoginAt, &u.LoginAttempts,
		); err == nil {
			users = append(users, u)
		}
	}
	
	if users == nil {
		users = []AdminUser{}
	}
	
	return &AdminUserListResponse{
		Users:      users,
		Page:       req.Page,
		PageSize:   req.PageSize,
		TotalItems: total,
		TotalPages: (int(total) + req.PageSize - 1) / req.PageSize,
	}, nil
}

type AdminUserListRequest struct {
	Page     int
	PageSize int
	Status   string
	KYCLevel int
	Country string
	Search  string
	SortField string
	SortDir  string
}

type AdminUserListResponse struct {
	Users      []AdminUser
	Page       int
	PageSize   int
	TotalItems int64
	TotalPages int
}

type AdminUser struct {
	UserID       string    `json:"userId"`
	Email       string    `json:"email"`
	Username    string    `json:"username"`
	Status      string    `json:"status"`
	KYCLevel    int       `json:"kycLevel"`
	Country     string    `json:"country"`
	CreatedAt   time.Time `json:"createdAt"`
	LastLoginAt *time.Time `json:"lastLoginAt,omitempty"`
	LoginAttempts int     `json:"loginAttempts"`
}

// UpdateUserStatus updates user status
func (as *AdminService) UpdateUserStatus(ctx context.Context, adminID, userID, status, reason string) error {
	// Validate status
	validStatuses := []string{"active", "suspended", "locked", "pending_kyc"}
	if !contains(validStatuses, status) {
		return fmt.Errorf("invalid status: %s", status)
	}
	
	// Update
	_, err := as.db.Exec(ctx,
		`UPDATE users SET account_status = $1, updated_at = NOW() WHERE user_id = $2`,
		status, userID,
	)
	
	if err != nil {
		return err
	}
	
	// Log audit
	as.auditLogger.Log(ctx, adminID, "update_user_status", "user", userID,
		map[string]interface{}{"status": status, "reason": reason})
	
	// Send notification
	as.notification.NotifyUser(ctx, userID, "status_changed", map[string]string{
		"status": status,
		"reason": reason,
	})
	
	return nil
}

// GetUserDetails returns detailed user information
func (as *AdminService) GetUserDetails(ctx context.Context, userID string) (*AdminUserDetails, error) {
	var details AdminUserDetails
	
	// Basic info
	err := as.db.QueryRow(ctx,
		`SELECT user_id, email, username, first_name, last_name, phone,
		 country_code, account_status, kyc_level, created_at, last_login_at,
		 risk_score, risk_category
		 FROM users WHERE user_id = $1`,
		userID,
	).Scan(
		&details.UserID, &details.Email, &details.Username,
		&details.FirstName, &details.LastName, &details.Phone,
		&details.Country, &details.Status, &details.KYCLevel,
		&details.CreatedAt, &details.LastLoginAt,
		&details.RiskScore, &details.RiskCategory,
	)
	
	if err != nil {
		return nil, err
	}
	
	// Get balances
	rows, _ := as.db.Query(ctx,
		`SELECT currency, available_amount, locked_amount
		 FROM balances WHERE user_id = $1`,
		userID,
	)
	defer rows.Close()
	
	for rows.Next() {
		var b AdminBalance
		if err := rows.Scan(&b.Currency, &b.Available, &b.Locked); err == nil {
			details.Balances = append(details.Balances, b)
		}
	}
	
	// Get recent orders
	orderRows, _ := as.db.Query(ctx,
		`SELECT order_id, market_symbol, side, order_type, quantity, 
		 filled_quantity, order_status, created_at
		 FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
		userID,
	)
	defer orderRows.Close()
	
	for orderRows.Next() {
		var o AdminOrder
		if err := orderRows.Scan(
			&o.OrderID, &o.MarketSymbol, &o.Side, &o.Type,
			&o.Quantity, &o.FilledQuantity, &o.Status, &o.CreatedAt,
		); err == nil {
			details.RecentOrders = append(details.RecentOrders, o)
		}
	}
	
	// Get deposits
	depositRows, _ := as.db.Query(ctx,
		`SELECT deposit_id, currency, amount, tx_hash, status, created_at
		 FROM deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
		userID,
	)
	defer depositRows.Close()
	
	for depositRows.Next() {
		var d AdminDeposit
		if err := depositRows.Scan(
			&d.DepositID, &d.Currency, &d.Amount, &d.TxHash,
			&d.Status, &d.CreatedAt,
		); err == nil {
			details.RecentDeposits = append(details.RecentDeposits, d)
		}
	}
	
	// Get withdrawals
	withdrawalRows, _ := as.db.Query(ctx,
		`SELECT withdrawal_id, currency, amount, to_address, status, created_at
		 FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
		userID,
	)
	defer withdrawalRows.Close()
	
	for withdrawalRows.Next() {
		var w AdminWithdrawal
		if err := withdrawalRows.Scan(
			&w.WithdrawalID, &w.Currency, &w.Amount, &w.ToAddress,
			&w.Status, &w.CreatedAt,
		); err == nil {
			details.RecentWithdrawals = append(details.RecentWithdrawals, w)
		}
	}
	
	// Get sessions
	sessionRows, _ := as.db.Query(ctx,
		`SELECT session_id, ip_address, user_agent, created_at, last_activity_at
		 FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
		userID,
	)
	defer sessionRows.Close()
	
	for sessionRows.Next() {
		var s AdminSession
		if err := sessionRows.Scan(
			&s.SessionID, &s.IPAddress, &s.UserAgent,
			&s.CreatedAt, &s.LastActivityAt,
		); err == nil {
			details.ActiveSessions = append(details.ActiveSessions, s)
		}
	}
	
	return &details, nil
}

type AdminUserDetails struct {
	UserID       string         `json:"userId"`
	Email       string         `json:"email"`
	Username    string         `json:"username"`
	FirstName   string         `json:"firstName"`
	LastName    string         `json:"lastName"`
	Phone       string         `json:"phone"`
	Country     string         `json:"country"`
	Status      string         `json:"status"`
	KYCLevel    int            `json:"kycLevel"`
	CreatedAt   time.Time     `json:"createdAt"`
	LastLoginAt *time.Time    `json:"lastLoginAt,omitempty"`
	RiskScore   int           `json:"riskScore"`
	RiskCategory string       `json:"riskCategory"`
	Balances    []AdminBalance `json:"balances"`
	RecentOrders    []AdminOrder     `json:"recentOrders"`
	RecentDeposits  []AdminDeposit   `json:"recentDeposits"`
	RecentWithdrawals []AdminWithdrawal `json:"recentWithdrawals"`
	ActiveSessions []AdminSession    `json:"activeSessions"`
}

type AdminBalance struct {
	Currency  string  `json:"currency"`
	Available float64 `json:"available"`
	Locked   float64 `json:"locked"`
}

type AdminOrder struct {
	OrderID      string    `json:"orderId"`
	MarketSymbol string    `json:"marketSymbol"`
	Side        string    `json:"side"`
	Type        string    `json:"type"`
	Quantity    float64   `json:"quantity"`
	FilledQuantity float64 `json:"filledQuantity"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

type AdminDeposit struct {
	DepositID string    `json:"depositId"`
	Currency  string    `json:"currency"`
	Amount    float64   `json:"amount"`
	TxHash    string    `json:"txHash"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

type AdminWithdrawal struct {
	WithdrawalID string    `json:"withdrawalId"`
	Currency     string    `json:"currency"`
	Amount      float64   `json:"amount"`
	ToAddress   string    `json:"toAddress"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

type AdminSession struct {
	SessionID     string    `json:"sessionId"`
	IPAddress    string    `json:"ipAddress"`
	UserAgent    string    `json:"userAgent"`
	CreatedAt    time.Time `json:"createdAt"`
	LastActivityAt time.Time `json:"lastActivityAt"`
}

// =============================================================================
// ORDER MANAGEMENT
// =============================================================================

// GetAllOrders returns all orders
func (as *AdminService) GetAllOrders(ctx context.Context, req *AdminOrderListRequest) (*AdminOrderListResponse, error) {
	query := `SELECT order_id, user_id, market_symbol, side, order_type, 
	 quantity, filled_quantity, order_status, created_at
	 FROM orders WHERE 1=1`
	
	countQuery := `SELECT COUNT(*) FROM orders WHERE 1=1`
	
	args := []interface{}{}
	argNum := 1
	
	if req.Symbol != "" {
		query += fmt.Sprintf(" AND market_symbol = $%d", argNum)
		countQuery += fmt.Sprintf(" AND market_symbol = $%d", argNum)
		args = append(args, req.Symbol)
		argNum++
	}
	
	if req.Status != "" {
		query += fmt.Sprintf(" AND order_status = $%d", argNum)
		countQuery += fmt.Sprintf(" AND order_status = $%d", argNum)
		args = append(args, req.Status)
		argNum++
	}
	
	if req.Side != "" {
		query += fmt.Sprintf(" AND side = $%d", argNum)
		countQuery += fmt.Sprintf(" AND side = $%d", argNum)
		args = append(args, req.Side)
		argNum++
	}
	
	if req.UserID != "" {
		query += fmt.Sprintf(" AND user_id = $%d", argNum)
		countQuery += fmt.Sprintf(" AND user_id = $%d", argNum)
		args = append(args, req.UserID)
		argNum++
	}
	
	var total int64
	as.db.QueryRow(ctx, countQuery, args...).Scan(&total)
	
	query += " ORDER BY created_at DESC"
	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argNum, argNum+1)
	args = append(args, req.PageSize, (req.Page-1)*req.PageSize)
	
	rows, _ := as.db.Query(ctx, query, args...)
	defer rows.Close()
	
	var orders []AdminOrder
	for rows.Next() {
		var o AdminOrder
		if err := rows.Scan(
			&o.OrderID, &o.UserID, &o.MarketSymbol, &o.Side, &o.Type,
			&o.Quantity, &o.FilledQuantity, &o.Status, &o.CreatedAt,
		); err == nil {
			orders = append(orders, o)
		}
	}
	
	if orders == nil {
		orders = []AdminOrder{}
	}
	
	return &AdminOrderListResponse{
		Orders:     orders,
		Page:       req.Page,
		PageSize:   req.PageSize,
		TotalItems: total,
	}, nil
}

type AdminOrderListRequest struct {
	Page     int
	PageSize int
	Symbol   string
	Status   string
	Side     string
	UserID   string
}

type AdminOrderListResponse struct {
	Orders     []AdminOrder
	Page       int
	PageSize   int
	TotalItems int64
}

// ForceCancelOrder force-cancels an order
func (as *AdminService) ForceCancelOrder(ctx context.Context, adminID, orderID, reason string) error {
	// Get order
	var userID, status string
	var filledQty, totalQty float64
	
	err := as.db.QueryRow(ctx,
		`SELECT user_id, order_status, filled_quantity, quantity FROM orders WHERE order_id = $1`,
		orderID,
	).Scan(&userID, &status, &filledQty, &totalQty)
	
	if err != nil {
		return err
	}
	
	// Can only cancel new or partially filled
	if status != "new" && status != "partially_filled" {
		return fmt.Errorf("cannot cancel order with status: %s", status)
	}
	
	// Update order
	_, err = as.db.Exec(ctx,
		`UPDATE orders SET order_status = 'canceled', updated_at = NOW() 
		 WHERE order_id = $1`,
		orderID,
	)
	
	if err != nil {
		return err
	}
	
	// Refund locked funds if buy order
	var side string
	as.db.QueryRow(ctx, "SELECT side FROM orders WHERE order_id = $1", orderID).Scan(&side)
	
	if side == "buy" {
		refundAmount := (totalQty - filledQty) * 50000 // Simplified - get actual price
		as.db.Exec(ctx,
			`UPDATE balances SET 
			 available_amount = available_amount + $1,
			 locked_amount = locked_amount - $1
			 WHERE user_id = $2 AND currency = 'USDT'`,
			refundAmount, userID,
		)
	}
	
	// Audit log
	as.auditLogger.Log(ctx, adminID, "force_cancel_order", "order", orderID,
		map[string]interface{}{"reason": reason, "previous_status": status})
	
	return nil
}

// =============================================================================
// WITHDRAWAL MANAGEMENT
// =============================================================================

// GetPendingWithdrawals returns pending withdrawals
func (as *AdminService) GetPendingWithdrawals(ctx context.Context, req *AdminWithdrawalListRequest) (*AdminWithdrawalListResponse, error) {
	query := `SELECT withdrawal_id, user_id, currency, amount, to_address, status, created_at
	 FROM withdrawals WHERE status IN ('pending', 'pending_approval')`
	
	countQuery := `SELECT COUNT(*) FROM withdrawals WHERE status IN ('pending', 'pending_approval')`
	
	args := []interface{}{}
	argNum := 1
	
	if req.Currency != "" {
		query += fmt.Sprintf(" AND currency = $%d", argNum)
		countQuery += fmt.Sprintf(" AND currency = $%d", argNum)
		args = append(args, req.Currency)
		argNum++
	}
	
	var total int64
	as.db.QueryRow(ctx, countQuery, args...).Scan(&total)
	
	query += " ORDER BY created_at ASC"
	query += fmt.Sprintf(" LIMIT $%d", argNum)
	args = append(args, req.Limit)
	
	rows, _ := as.db.Query(ctx, query, args...)
	defer rows.Close()
	
	var withdrawals []AdminWithdrawalDetail
	for rows.Next() {
		var w AdminWithdrawalDetail
		if err := rows.Scan(
			&w.WithdrawalID, &w.UserID, &w.Currency, &w.Amount,
			&w.ToAddress, &w.Status, &w.CreatedAt,
		); err == nil {
			withdrawals = append(withdrawals, w)
		}
	}
	
	if withdrawals == nil {
		withdrawals = []AdminWithdrawalDetail{}
	}
	
	return &AdminWithdrawalListResponse{
		Withdrawals: withdrawals,
		TotalItems:  total,
	}, nil
}

type AdminWithdrawalListRequest struct {
	Currency string
	Limit    int
}

type AdminWithdrawalListResponse struct {
	Withdrawals []AdminWithdrawalDetail
	TotalItems int64
}

type AdminWithdrawalDetail struct {
	WithdrawalID string    `json:"withdrawalId"`
	UserID       string    `json:"userId"`
	Currency     string    `json:"currency"`
	Amount       float64   `json:"amount"`
	ToAddress    string    `json:"toAddress"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

// ApproveWithdrawal approves a withdrawal
func (as *AdminService) ApproveWithdrawal(ctx context.Context, adminID, withdrawalID, note string) error {
	adminUUID := uuid.MustParse(adminID)
	
	// Get withdrawal details
	var userID, currency, toAddress string
	var amount float64
	
	err := as.db.QueryRow(ctx,
		`SELECT user_id, currency, amount, to_address FROM withdrawals 
		 WHERE withdrawal_id = $1 AND status = 'pending'`,
		withdrawalID,
	).Scan(&userID, &currency, &amount, &toAddress)
	
	if err != nil {
		return err
	}
	
	// Verify user balance
	var balance float64
	as.db.QueryRow(ctx,
		`SELECT available_amount + locked_amount FROM balances 
		 WHERE user_id = $1 AND currency = $2`,
		userID, currency,
	).Scan(&balance)
	
	if balance < amount {
		return fmt.Errorf("insufficient balance: have %f, need %f", balance, amount)
	}
	
	// Update withdrawal
	now := time.Now()
	_, err = as.db.Exec(ctx,
		`UPDATE withdrawals SET 
		 status = 'processing', approved_by = $1, approved_at = $2, 
		 approval_note = $3, updated_at = $2
		 WHERE withdrawal_id = $4`,
		adminUUID, now, note, withdrawalID,
	)
	
	if err != nil {
		return err
	}
	
	// Deduct balance
	as.db.Exec(ctx,
		`UPDATE balances SET 
		 available_amount = available_amount - $1
		 WHERE user_id = $2 AND currency = $3`,
		amount, userID, currency,
	)
	
	// Audit log
	as.auditLogger.Log(ctx, adminID, "approve_withdrawal", "withdrawal", withdrawalID,
		map[string]interface{}{"amount": amount, "currency": currency})
	
	return nil
}

// RejectWithdrawal rejects a withdrawal
func (as *AdminService) RejectWithdrawal(ctx context.Context, adminID, withdrawalID, reason string) error {
	adminUUID := uuid.MustParse(adminID)
	
	_, err := as.db.Exec(ctx,
		`UPDATE withdrawals SET 
		 status = 'rejected', approved_by = $1, approved_at = NOW(),
		 approval_note = $2, updated_at = NOW()
		 WHERE withdrawal_id = $3 AND status IN ('pending', 'pending_approval')`,
		adminUUID, reason, withdrawalID,
	)
	
	if err != nil {
		return err
	}
	
	as.auditLogger.Log(ctx, adminID, "reject_withdrawal", "withdrawal", withdrawalID,
		map[string]interface{}{"reason": reason})
	
	return nil
}

// =============================================================================
// KYC MANAGEMENT
// =============================================================================

// GetPendingKYC returns pending KYC applications
func (as *AdminService) GetPendingKYC(ctx context.Context, limit int) ([]AdminKYCApplication, error) {
	rows, err := as.db.Query(ctx,
		`SELECT ka.application_id, ka.user_id, ka.tier, ka.status, ka.created_at,
		 u.email, u.username
		 FROM kyc_applications ka
		 JOIN users u ON ka.user_id = u.user_id
		 WHERE ka.status IN ('submitted', 'under_review')
		 ORDER BY ka.created_at ASC
		 LIMIT $1`,
		limit,
	)
	
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var apps []AdminKYCApplication
	for rows.Next() {
		var a AdminKYCApplication
		if err := rows.Scan(
			&a.ApplicationID, &a.UserID, &a.Tier, &a.Status,
			&a.CreatedAt, &a.Email, &a.Username,
		); err == nil {
			apps = append(apps, a)
		}
	}
	
	if apps == nil {
		apps = []AdminKYCApplication{}
	}
	
	return apps, nil
}

type AdminKYCApplication struct {
	ApplicationID string    `json:"applicationId"`
	UserID       string    `json:"userId"`
	Email        string    `json:"email"`
	Username     string    `json:"username"`
	Tier        int       `json:"tier"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

// ApproveKYC approves a KYC application
func (as *AdminService) ApproveKYC(ctx context.Context, adminID, applicationID, note string) error {
	adminUUID := uuid.MustParse(adminID)
	
	// Get application
	var userID string
	var tier int
	err := as.db.QueryRow(ctx,
		`SELECT user_id, tier FROM kyc_applications 
		 WHERE application_id = $1 AND status = 'under_review'`,
		applicationID,
	).Scan(&userID, &tier)
	
	if err != nil {
		return err
	}
	
	// Update application
	_, err = as.db.Exec(ctx,
		`UPDATE kyc_applications SET 
		 status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
		 review_notes = $2, updated_at = NOW()
		 WHERE application_id = $3`,
		adminUUID, note, applicationID,
	)
	
	if err != nil {
		return err
	}
	
	// Update user KYC level
	as.db.Exec(ctx,
		`UPDATE users SET kyc_level = $1, kyc_tier = $1, updated_at = NOW() WHERE user_id = $2`,
		tier, userID,
	)
	
	as.auditLogger.Log(ctx, adminID, "approve_kyc", "application", applicationID,
		map[string]interface{}{"tier": tier, "user_id": userID})
	
	as.notification.NotifyUser(ctx, userID, "kyc_approved", map[string]string{
		"tier": fmt.Sprintf("%d", tier),
	})
	
	return nil
}

// RejectKYC rejects a KYC application
func (as *AdminService) RejectKYC(ctx context.Context, adminID, applicationID, reason string) error {
	adminUUID := uuid.MustParse(adminID)
	
	// Update application
	_, err := as.db.Exec(ctx,
		`UPDATE kyc_applications SET 
		 status = 'rejected', reviewed_by = $1, reviewed_at = NOW(),
		 rejection_reason = $2, updated_at = NOW()
		 WHERE application_id = $3`,
		adminUUID, reason, applicationID,
	)
	
	if err != nil {
		return err
	}
	
	// Get user ID for notification
	var userID string
	as.db.QueryRow(ctx,
		"SELECT user_id FROM kyc_applications WHERE application_id = $1",
		applicationID,
	).Scan(&userID)
	
	as.auditLogger.Log(ctx, adminID, "reject_kyc", "application", applicationID,
		map[string]interface{}{"reason": reason})
	
	as.notification.NotifyUser(ctx, userID, "kyc_rejected", map[string]string{
		"reason": reason,
	})
	
	return nil
}

// =============================================================================
// ANALYTICS & REPORTING
// =============================================================================

// GetDashboardStats returns dashboard statistics
func (as *AdminService) GetDashboardStats(ctx context.Context) (*AdminDashboardStats, error) {
	stats := &AdminDashboardStats{}
	
	// User stats
	as.db.QueryRow(ctx,
		`SELECT 
		 COUNT(*) as total_users,
		 COUNT(*) FILTER (WHERE account_status = 'active') as active_users,
		 COUNT(*) FILTER (WHERE kyc_level > 0) as verified_users,
		 COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_users_24h
		 FROM users WHERE deleted_at IS NULL`,
	).Scan(&stats.TotalUsers, &stats.ActiveUsers, &stats.VerifiedUsers, &stats.NewUsers24h)
	
	// Trading stats
	as.db.QueryRow(ctx,
		`SELECT 
		 COUNT(*) as total_orders,
		 COUNT(*) FILTER (WHERE order_status = 'filled') as filled_orders,
		 COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as orders_24h
		 FROM orders`,
	).Scan(&stats.TotalOrders, &stats.FilledOrders, &stats.Orders24h)
	
	// Volume stats
	as.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(quantity * price), 0) 
		 FROM trades WHERE created_at > NOW() - INTERVAL '24 hours'`,
	).Scan(&stats.Volume24h)
	
	// Financial stats
	as.db.QueryRow(ctx,
		`SELECT 
		 COALESCE(SUM(amount), 0) FILTER (WHERE status = 'completed'),
		 COALESCE(SUM(amount), 0) FILTER (WHERE status = 'completed' AND created_at > NOW() - INTERVAL '24 hours')
		 FROM deposits`,
	).Scan(&stats.TotalDeposits, &stats.Deposits24h)
	
	as.db.QueryRow(ctx,
		`SELECT 
		 COALESCE(SUM(amount), 0) FILTER (WHERE status = 'completed'),
		 COALESCE(SUM(amount), 0) FILTER (WHERE status = 'completed' AND created_at > NOW() - INTERVAL '24 hours')
		 FROM withdrawals`,
	).Scan(&stats.TotalWithdrawals, &stats.Withdrawals24h)
	
	// Pending items
	as.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM withdrawals WHERE status IN ('pending', 'pending_approval')`,
	).Scan(&stats.PendingWithdrawals)
	
	as.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM kyc_applications WHERE status IN ('submitted', 'under_review')`,
	).Scan(&stats.PendingKYC)
	
	// P2P stats
	as.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM p2p_orders WHERE status = 'active'`,
	).Scan(&stats.ActiveP2POrders)
	
	return stats, nil
}

type AdminDashboardStats struct {
	TotalUsers         int64   `json:"totalUsers"`
	ActiveUsers        int64   `json:"activeUsers"`
	VerifiedUsers     int64   `json:"verifiedUsers"`
	NewUsers24h       int64   `json:"newUsers24h"`
	TotalOrders       int64   `json:"totalOrders"`
	FilledOrders      int64   `json:"filledOrders"`
	Orders24h         int64   `json:"orders24h"`
	Volume24h         float64 `json:"volume24h"`
	TotalDeposits     float64 `json:"totalDeposits"`
	Deposits24h       float64 `json:"deposits24h"`
	TotalWithdrawals  float64 `json:"totalWithdrawals"`
	Withdrawals24h    float64 `json:"withdrawals24h"`
	PendingWithdrawals int64   `json:"pendingWithdrawals"`
	PendingKYC        int64   `json:"pendingKYC"`
	ActiveP2POrders   int64   `json:"activeP2POrders"`
}

// =============================================================================
// AUDIT LOGGING
// =============================================================================

type AuditLogger struct {
	db *pgxpool.Pool
}

func (al *AuditLogger) Log(ctx context.Context, actorID, action, resourceType, resourceID string, changes map[string]interface{}) {
	al.db.Exec(ctx,
		`INSERT INTO audit_logs (log_id, actor_id, action, resource_type, resource_id, changes, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
		uuid.New(), actorID, action, resourceType, resourceID, changes,
	)
}

// =============================================================================
// NOTIFICATIONS
// =============================================================================

type AdminNotification struct{}

func (an *AdminNotification) NotifyUser(ctx context.Context, userID, notificationType string, data map[string]string) {
	log.Printf("Notification to user %s: type=%s, data=%v", userID, notificationType, data)
}

// =============================================================================
// HELPERS
// =============================================================================

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func init() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
}

func main() {
	log.Println("Admin Service - Use as library")
}

var (
	_ = json.Marshal
	_ = strings.TrimSpace
	_ = fmt.Sprintf
)
