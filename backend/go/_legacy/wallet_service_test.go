package legacy

import (
	"context"
	"errors"
	"testing"
)

func TestBlockchainAdaptersFailClosedWithoutRPC(t *testing.T) {
	ctx := context.Background()
	adapters := []BlockchainService{
		NewBTCService("main"),
		NewETHService("main"),
	}
	for _, adapter := range adapters {
		if _, err := adapter.GetDepositConfirmations(ctx, "tx-hash", "main"); !errors.Is(err, ErrBlockchainUnavailable) {
			t.Errorf("%T GetDepositConfirmations error = %v, want ErrBlockchainUnavailable", adapter, err)
		}
		if _, err := adapter.BroadcastWithdrawal(ctx, &WithdrawalRequest{ToAddress: "address", Amount: "1", Network: "main"}); !errors.Is(err, ErrBlockchainUnavailable) {
			t.Errorf("%T BroadcastWithdrawal error = %v, want ErrBlockchainUnavailable", adapter, err)
		}
		if _, err := adapter.GetBalance(ctx, "address", "main"); !errors.Is(err, ErrBlockchainUnavailable) {
			t.Errorf("%T GetBalance error = %v, want ErrBlockchainUnavailable", adapter, err)
		}
		if _, err := adapter.GetGasPrice(ctx, "main"); !errors.Is(err, ErrBlockchainUnavailable) {
			t.Errorf("%T GetGasPrice error = %v, want ErrBlockchainUnavailable", adapter, err)
		}
	}
}
