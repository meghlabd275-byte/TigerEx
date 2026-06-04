// Admin Database Models - Complete Permission System
package models

import (
"context"
"time"

"github.com/google/uuid"
)

// Admin user roles
const (
RoleSuperAdmin  = "super_admin"
RoleAdmin       = "admin"
RoleModerator   = "moderator"
RoleSupport    = "support"
RoleCompliance = "compliance"
RoleFinance    = "finance"
RoleTrader     = "trader"
)

// Permission constants
const (
PermUserManagement       = "users"
PermAdminManagement      = "admins"
PermKYCManagement       = "kyc"
PermPairsManagement     = "pairs"
PermLiquidityManagement  = "liquidity"
PermFeesManagement      = "fees"
PermCSManagement        = "cs"
PermIOUManagement       = "iou"
PermVirtualCoins        = "virtual_coins"
PermMarketMaker        = "market_maker"
PermListingManagement   = "listing"
PermWhitelabelClients   = "whitelabel_clients"
PermWhitelabelWallets  = "whitelabel_wallets"
PermBlockchainMgmt     = "blockchain"
PermBlockExplorer      = "block_explorer"
PermCEXDEXMgmt         = "cex_dex"
PermInstitutional      = "institutional"
PermBrokerageMgmt      = "brokerage"
PermTokenCreate       = "token_create"
PermNftManagement     = "nft"
PermMultisend         = "multisend"
PermCloudMining       = "cloud_mining"
PermWithdrawals       = "withdrawals"
PermAPIManagement    = "api"
PermAnalytics        = "analytics"
PermFullAccess       = "*"
)

// Create admin tables
func initAdminTables(ctx context.Context) error {
// Administrators table
_, err := Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS admins (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		username VARCHAR(100) UNIQUE NOT NULL,
		email VARCHAR(255) UNIQUE NOT NULL,
		password_hash VARCHAR(255) NOT NULL,
		role VARCHAR(50) NOT NULL DEFAULT 'admin',
		status VARCHAR(20) DEFAULT 'active',
		permissions TEXT[] DEFAULT '{}',
		super_admin_id UUID,
		last_login_at TIMESTAMP WITH TIME ZONE,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// Admin sessions
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS admin_sessions (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
		session_token VARCHAR(255) UNIQUE NOT NULL,
		ip_address INET,
		user_agent TEXT,
		expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
		status VARCHAR(20) DEFAULT 'active'
	)
`)
if err != nil {
	return err
}

// Audit log (every admin action is recorded)
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS admin_audit_log (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE SET NULL,
		admin_username VARCHAR(100),
		action VARCHAR(100) NOT NULL,
		resource_type VARCHAR(50) NOT NULL,
		resource_id VARCHAR(255),
		details JSONB,
		ip_address INET,
		user_agent TEXT,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// Market pairs
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS market_pairs (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		symbol VARCHAR(50) UNIQUE NOT NULL,
		base_currency VARCHAR(20) NOT NULL,
		quote_currency VARCHAR(20) NOT NULL,
		price_precision INTEGER DEFAULT 8,
		quantity_precision INTEGER DEFAULT 8,
		min_quantity NUMERIC(32, 16) DEFAULT 0,
		max_quantity NUMERIC(32, 16),
		min_price NUMERIC(32, 16) DEFAULT 0,
		max_price NUMERIC(32, 16),
		maker_fee NUMERIC(10, 6) DEFAULT 0.001,
		taker_fee NUMERIC(10, 6) DEFAULT 0.001,
		status VARCHAR(20) DEFAULT 'active',
		is_default BOOLEAN DEFAULT FALSE,
		source_exchange VARCHAR(50),
		created_by UUID,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// Liquidity pools
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS liquidity_pools (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		pair_id UUID REFERENCES market_pairs(id) ON DELETE SET NULL,
		liquidity_provider VARCHAR(50),
		volume_24h NUMERIC(32, 16) DEFAULT 0,
		status VARCHAR(20) DEFAULT 'active',
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// Fee structures
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS fee_structures (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		fee_type VARCHAR(50) NOT NULL,
		currency VARCHAR(20),
		tier VARCHAR(20),
		maker_fee NUMERIC(10, 6),
		taker_fee NUMERIC(10, 6),
		withdraw_fee NUMERIC(32, 16),
		deposit_fee NUMERIC(10, 6),
		status VARCHAR(20) DEFAULT 'active',
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// API keys management
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS api_keys_management (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID REFERENCES users(id) ON DELETE CASCADE,
		key_id VARCHAR(50) UNIQUE NOT NULL,
		key_secret_hash VARCHAR(255) NOT NULL,
		name VARCHAR(100),
		permissions TEXT[],
		ip_whitelist TEXT[],
		rate_limit INTEGER DEFAULT 6000,
		status VARCHAR(20) DEFAULT 'active',
		last_used_at TIMESTAMP WITH TIME ZONE,
		expires_at TIMESTAMP WITH TIME ZONE,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// Analytics
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS analytics_events (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		event_type VARCHAR(100) NOT NULL,
		user_id UUID,
		amount NUMERIC(32, 16),
		currency VARCHAR(20),
		metadata JSONB,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// Cloud mining products
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS cloud_mining_products (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		name VARCHAR(100) NOT NULL,
		currency VARCHAR(20) NOT NULL,
		daily_output NUMERIC(32, 16) NOT NULL,
		price_per_th NUMERIC(32, 8) NOT NULL,
		min_investment NUMERIC(32, 16) DEFAULT 0,
		max_investment NUMERIC(32, 16),
		contract_duration INTEGER DEFAULT 365,
		status VARCHAR(20) DEFAULT 'active',
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// Token listings
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS token_listings (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		token_name VARCHAR(100) NOT NULL,
		token_symbol VARCHAR(20) NOT NULL,
		blockchain VARCHAR(50) NOT NULL,
		contract_address VARCHAR(255) NOT NULL,
		total_supply NUMERIC(32, 8),
		initial_price NUMERIC(32, 8),
		listing_fee NUMERIC(32, 16),
		status VARCHAR(20) DEFAULT 'pending',
		listing_type VARCHAR(50) DEFAULT 'standard',
		submitted_by UUID,
		reviewed_by UUID,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// NFT collections
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS nft_collections (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		name VARCHAR(100) NOT NULL,
		symbol VARCHAR(20) NOT NULL,
		contract_address VARCHAR(255),
		blockchain VARCHAR(50) NOT NULL,
		floor_price NUMERIC(32, 8),
		royalty_fee NUMERIC(10, 6) DEFAULT 0,
		status VARCHAR(20) DEFAULT 'active',
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// Market maker configs
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS market_maker_configs (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		name VARCHAR(100) NOT NULL,
		pair_symbol VARCHAR(50) NOT NULL,
		spread_min NUMERIC(10, 6) DEFAULT 0.001,
		spread_max NUMERIC(10, 6) DEFAULT 0.01,
		order_size_min NUMERIC(32, 16) DEFAULT 0,
		order_size_max NUMERIC(32, 16),
		status VARCHAR(20) DEFAULT 'active',
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// Support tickets
_, err = Pool.Exec(ctx, `
	CREATE TABLE IF NOT EXISTS support_tickets (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID REFERENCES users(id) ON DELETE SET NULL,
		subject VARCHAR(255) NOT NULL,
		description TEXT,
		priority VARCHAR(20) DEFAULT 'medium',
		status VARCHAR(20) DEFAULT 'open',
		assigned_to UUID,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)
`)
if err != nil {
	return err
}

// Create indexes
_, _ = Pool.Exec(ctx, `CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_id)`)
_, _ = Pool.Exec(ctx, `CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action)`)
_, _ = Pool.Exec(ctx, `CREATE INDEX IF NOT EXISTS idx_pairs_symbol ON market_pairs(symbol)`)
_, _ = Pool.Exec(ctx, `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`)
_, _ = Pool.Exec(ctx, `CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_documents(user_id)`)

return nil
}

// Log admin action
func LogAdminAction(adminID uuid.UUID, adminUsername, action, resourceType, resourceID string, details map[string]interface{}) error {
ctx := context.Background()
_, err := Pool.Exec(ctx, `
	INSERT INTO admin_audit_log 
	(admin_id, admin_username, action, resource_type, resource_id, details)
	VALUES ($1, $2, $3, $4, $5, $6)
`, adminID, adminUsername, action, resourceType, resourceID, details)
return err
}

// Check admin permission
func (a *Admin) HasPermission(permission string) bool {
for _, p := range a.Permissions {
	if p == PermFullAccess || p == permission {
		return true
	}
}
return false
}

type Admin struct {
ID           uuid.UUID   `json:"id"`
Username    string     `json:"username"`
Email       string     `json:"email"`
PasswordHash string   `json:"-"`
Role        string     `json:"role"`
Status     string     `json:"status"`
Permissions []string `json:"permissions"`
SuperAdminID *uuid.UUID `json:"superAdminId,omitempty"`
LastLogin   *time.Time `json:"lastLogin,omitempty"`
CreatedAt  time.Time `json:"createdAt"`
UpdatedAt  time.Time `json:"updatedAt"`
}

// Create default super admin
func CreateDefaultAdmin() error {
ctx := context.Background()

// Check if admin exists
var count int
err := Pool.QueryRow(ctx, "SELECT COUNT(*) FROM admins").Scan(&count)
if err != nil {
	return err
}

if count == 0 {
	// Create default super admin
	salt := GenerateSalt()
PWHash := HashPassword("admin123", salt)
	
	_, err = Pool.Exec(ctx, `
		INSERT INTO admins (id, username, email, password_hash, password_salt, role, status, permissions, super_admin_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, uuid.New(), "superadmin", "admin@tigerex.com", PWHash, salt, RoleSuperAdmin, "active", []string{PermFullAccess}, nil)
	if err != nil {
		return err
	}
}

return nil
}