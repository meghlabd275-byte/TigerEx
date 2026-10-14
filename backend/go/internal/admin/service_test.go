package admin

import (
	"context"
	"errors"
	"math/big"
	"testing"

	"github.com/google/uuid"
)

func TestAdminOperationsFailClosedWithoutPersistence(t *testing.T) {
	s := NewAdminService(&MasterWallet{
		ID: uuid.New(),
		Balance: big.NewInt(1000),
		IsActive: true,
	})
	ctx := context.Background()

	if err := s.AddBlockchain(ctx, &BlockchainConfig{Name: "example"}); !errors.Is(err, ErrAdminPersistenceUnavailable) {
		t.Fatalf("AddBlockchain error = %v, want ErrAdminPersistenceUnavailable", err)
	}
	if _, err := s.MasterWalletTransfer(ctx, "0xrecipient", big.NewInt(10), "ETH"); !errors.Is(err, ErrAdminPersistenceUnavailable) {
		t.Fatalf("MasterWalletTransfer error = %v, want ErrAdminPersistenceUnavailable", err)
	}
	if _, err := s.ClaimAirdrop(ctx, uuid.New(), uuid.New()); !errors.Is(err, ErrAdminPersistenceUnavailable) {
		t.Fatalf("ClaimAirdrop error = %v, want ErrAdminPersistenceUnavailable", err)
	}
	if err := s.LogAction(ctx, uuid.New(), "test", "user", "id", nil, nil); !errors.Is(err, ErrAdminPersistenceUnavailable) {
		t.Fatalf("LogAction error = %v, want ErrAdminPersistenceUnavailable", err)
	}
	if s.masterWallet.Balance.Cmp(big.NewInt(1000)) != 0 {
		t.Fatal("admin operation changed the in-memory wallet balance without a transaction signer")
	}
}
