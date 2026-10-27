package institutional

import "context"

// AccountStore persists institutional account state. Implementations are the
// service's single source of truth for sub-accounts, master accounts,
// permission groups, OTC quotes, and custody accounts.
type AccountStore interface {
	SaveSubAccount(ctx context.Context, sub *SubAccount) error
	GetSubAccount(ctx context.Context, id string) (*SubAccount, error)
	ListSubAccounts(ctx context.Context, masterID string) ([]*SubAccount, error)

	SaveMasterAccount(ctx context.Context, account *MasterAccount) error
	GetMasterAccount(ctx context.Context, id string) (*MasterAccount, error)

	SavePermissionGroup(ctx context.Context, group *PermissionGroup) error
	GetPermissionGroup(ctx context.Context, id string) (*PermissionGroup, error)
	ListPermissionGroups(ctx context.Context) ([]*PermissionGroup, error)

	SaveOTCQuote(ctx context.Context, quote *OTCQuote) error
	GetOTCQuote(ctx context.Context, id string) (*OTCQuote, error)

	SaveCustodyAccount(ctx context.Context, account *CustodyAccount) error
	GetCustodyAccount(ctx context.Context, id string) (*CustodyAccount, error)
	ListCustodyAccounts(ctx context.Context, userID string) ([]*CustodyAccount, error)
}

// Ledger performs the balance movements behind institutional operations. A
// ledger transfer is atomic and shared across processes, unlike the in-memory
// balance arithmetic it replaces.
type Ledger interface {
	Balances(ctx context.Context, accountID string) (map[string]float64, error)
	TransferSubAccount(ctx context.Context, fromID, toID, asset string, amount float64) error
	TransferCustody(ctx context.Context, fromID, toID string, amount float64) error
	SettleOTC(ctx context.Context, userID, asset, side string, amount, total, fee float64) error
}

// MarketData provides the price an OTC quote is struck against.
type MarketData interface {
	USDPrice(ctx context.Context, asset string) (float64, error)
}

// AuditStore persists audit records.
type AuditStore interface {
	Append(ctx context.Context, entry *AuditLog) error
	List(ctx context.Context, userID string, limit int) ([]*AuditLog, error)
}

// ManagerDirectory is the CRM integration for dedicated account managers.
type ManagerDirectory interface {
	Lookup(managerID string) (*DedicatedAccountManager, error)
	Assign(userID, managerID string) error
}
