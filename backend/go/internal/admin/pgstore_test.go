package admin

import "testing"

// TestIsUUIDGuardsTypedColumns covers the check that runs before a value is
// bound to a uuid column. Every query parameter is bound, so this is not the
// only line of defence against injection; its job is to turn a malformed path
// parameter into a clean not-found instead of a Postgres type error that would
// leak the failing statement.
func TestIsUUIDGuardsTypedColumns(t *testing.T) {
	valid := []string{
		"00000000-0000-0000-0000-000000000000",
		"f47ac10b-58cc-4372-a567-0e02b2c3d479",
		"F47AC10B-58CC-4372-A567-0E02B2C3D479",
	}
	for _, id := range valid {
		if !isUUID(id) {
			t.Errorf("isUUID(%q) = false, want true", id)
		}
	}

	invalid := []string{
		"",
		"not-a-uuid",
		"f47ac10b-58cc-4372-a567-0e02b2c3d47",   // one short
		"f47ac10b-58cc-4372-a567-0e02b2c3d4790", // one long
		"f47ac10b58cc4372a5670e02b2c3d479",      // no dashes
		"f47ac10b-58cc-4372-a567-0e02b2c3d47g",  // non-hex
		"f47ac10b-58cc-4372-a567-0e02b2c3d479'", // trailing quote
		"' OR 1=1 --",
		"f47ac10b-58cc-4372-a567-0e02b2c3d479; DROP TABLE users;",
		"../../etc/passwd",
	}
	for _, id := range invalid {
		if isUUID(id) {
			t.Errorf("isUUID(%q) = true, want false", id)
		}
	}
}

// TestClampPagingBoundsOperatorInput keeps a crafted limit from asking the
// database for an unbounded result set.
func TestClampPagingBoundsOperatorInput(t *testing.T) {
	cases := []struct {
		inLimit, inOffset     int
		wantLimit, wantOffset int
	}{
		{0, 0, defaultLimit, 0},
		{-1, -1, defaultLimit, 0},
		{10, 5, 10, 5},
		{maxLimit, 0, maxLimit, 0},
		{maxLimit + 1, 0, maxLimit, 0},
		{1_000_000, 0, maxLimit, 0},
		{25, -10, 25, 0},
	}
	for _, tc := range cases {
		gotLimit, gotOffset := clampPaging(tc.inLimit, tc.inOffset)
		if gotLimit != tc.wantLimit || gotOffset != tc.wantOffset {
			t.Errorf("clampPaging(%d, %d) = (%d, %d), want (%d, %d)",
				tc.inLimit, tc.inOffset, gotLimit, gotOffset, tc.wantLimit, tc.wantOffset)
		}
	}
}
