package antifraud

import "testing"

func TestAnalyzeTransactionRejectsNonPositiveAmounts(t *testing.T) {
	afm := NewAntiFraudManager()
	for _, amount := range []float64{0, -1} {
		if _, _, err := afm.AnalyzeTransaction("u1", "deposit", amount, nil); err == nil {
			t.Fatalf("amount %v was accepted", amount)
		}
	}
	nan := 0.0
	nan = nan / nan
	if _, _, err := afm.AnalyzeTransaction("u1", "deposit", nan, nil); err == nil {
		t.Fatal("NaN amount was accepted")
	}
}

func TestAnalyzeTransactionFlagsLargeAmounts(t *testing.T) {
	afm := NewAntiFraudManager()
	score, level, err := afm.AnalyzeTransaction("u1", "withdrawal", 60000, nil)
	if err != nil {
		t.Fatal(err)
	}
	if score < 50 || level != RiskLevelHigh {
		t.Fatalf("large withdrawal scored %d (%s), want at least high", score, level)
	}
}

func TestAnalyzeTransactionDetectsStructuring(t *testing.T) {
	afm := NewAntiFraudManager()
	// Four sub-threshold deposits that together cross the reporting threshold.
	for i := 0; i < 3; i++ {
		if _, _, err := afm.AnalyzeTransaction("u1", "deposit", 3000, nil); err != nil {
			t.Fatal(err)
		}
	}
	score, _, err := afm.AnalyzeTransaction("u1", "deposit", 3000, nil)
	if err != nil {
		t.Fatal(err)
	}
	if score < 35 {
		t.Fatalf("structuring scored %d, want the structuring signal to fire", score)
	}
}

func TestAnalyzeLoginFlagsUnknownDeviceAndFailures(t *testing.T) {
	afm := NewAntiFraudManager()
	afm.RecordLogin("u1", "1.2.3.4", "known-device", true)
	for i := 0; i < 5; i++ {
		afm.RecordLogin("u1", "9.9.9.9", "attacker", false)
	}
	score, level, err := afm.AnalyzeLogin("u1", "9.9.9.9", "brand-new-device")
	if err != nil {
		t.Fatal(err)
	}
	if score < 50 || level != RiskLevelHigh {
		t.Fatalf("suspicious login scored %d (%s), want at least high", score, level)
	}
}

func TestAnalyzeLoginKnownDeviceIsLowRisk(t *testing.T) {
	afm := NewAntiFraudManager()
	afm.RecordLogin("u1", "1.2.3.4", "known-device", true)
	score, level, err := afm.AnalyzeLogin("u1", "1.2.3.4", "known-device")
	if err != nil {
		t.Fatal(err)
	}
	if score != 0 || level != RiskLevelLow {
		t.Fatalf("known device login scored %d (%s), want low", score, level)
	}
}
