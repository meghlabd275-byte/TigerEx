package kyc

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	// Register the SQLite driver used by NewSQLiteStore.
	_ "github.com/mattn/go-sqlite3"
)

// sqliteSchema is the KYC service's own schema. It is a constant so the tests
// build an identical database.
//
// Document and selfie images are stored as a path plus a SHA-256 digest, never
// as bytes in the database: an identity document is sensitive personal data and
// belongs in the encrypted object store, not in a queryable table.
const sqliteSchema = `
CREATE TABLE IF NOT EXISTS kyc_applications (
    application_id   TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL,
    document_type    TEXT NOT NULL,
    first_name       TEXT NOT NULL,
    last_name        TEXT NOT NULL,
    date_of_birth    TEXT NOT NULL,
    country          TEXT NOT NULL,
    document_number  TEXT NOT NULL,
    address          TEXT NOT NULL,
    city             TEXT NOT NULL,
    state            TEXT,
    postal_code      TEXT NOT NULL,
    level            INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    submitted_at     INTEGER NOT NULL,
    reviewed_at      INTEGER,
    reviewed_by      TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_applications_user ON kyc_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_applications_status ON kyc_applications(status);

CREATE TABLE IF NOT EXISTS kyc_documents (
    document_id    TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    document_type  TEXT NOT NULL,
    side           TEXT,
    file_path      TEXT NOT NULL,
    file_hash      TEXT NOT NULL,
    created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kyc_documents_application ON kyc_documents(application_id);

CREATE TABLE IF NOT EXISTS kyc_audit_logs (
    log_id         TEXT PRIMARY KEY,
    user_id        TEXT,
    application_id TEXT,
    action         TEXT NOT NULL,
    details        TEXT,
    actor_id       TEXT,
    created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kyc_audit_user ON kyc_audit_logs(user_id);
`

// SQLiteStore is the KYC Store backed by SQLite.
//
// It refuses to open an in-memory database because a KYC decision that is lost
// on restart is worse than no decision at all: the operator believes a user is
// verified while the exchange has no record of why.
type SQLiteStore struct {
	db *sql.DB
}

// NewSQLiteStore opens path and applies the schema. The path ":memory:" and an
// empty path are rejected; use a real file.
func NewSQLiteStore(path string) (*SQLiteStore, error) {
	if strings.TrimSpace(path) == "" || path == ":memory:" {
		return nil, errors.New("kyc store requires a persistent database path")
	}
	if strings.Contains(path, "mode=memory") {
		return nil, errors.New("kyc store requires a persistent database path")
	}

	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, fmt.Errorf("opening kyc database: %w", err)
	}
	// SQLite serialises writers; a single connection avoids "database is
	// locked" errors under concurrent requests.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("pinging kyc database: %w", err)
	}
	if _, err := db.Exec(sqliteSchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("applying kyc schema: %w", err)
	}

	return &SQLiteStore{db: db}, nil
}

// Close releases the database handle.
func (s *SQLiteStore) Close() error { return s.db.Close() }

func newID(prefix string) (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return prefix + "_" + hex.EncodeToString(buf), nil
}

func (s *SQLiteStore) GetApplication(ctx context.Context, userID string) (*Application, error) {
	const q = `
		SELECT application_id, user_id, document_type, first_name, last_name, date_of_birth,
		       country, document_number, address, city, COALESCE(state, ''), postal_code,
		       level, status, COALESCE(rejection_reason, ''), submitted_at, COALESCE(reviewed_at, 0)
		FROM kyc_applications WHERE user_id = ?
	`
	var app Application
	err := s.db.QueryRowContext(ctx, q, userID).Scan(
		&app.ID, &app.UserID, &app.DocumentType, &app.FirstName, &app.LastName, &app.DOB,
		&app.Country, &app.DocumentID, &app.Address, &app.City, &app.State, &app.ZipCode,
		&app.Level, &app.Status, &app.RejectReason, &app.SubmittedAt, &app.ReviewedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("loading kyc application: %w", err)
	}
	return &app, nil
}

func (s *SQLiteStore) CreateApplication(ctx context.Context, app *Application) error {
	if app.ID == "" {
		id, err := newID("kyc")
		if err != nil {
			return err
		}
		app.ID = id
	}
	now := time.Now().Unix()

	const q = `
		INSERT INTO kyc_applications (
			application_id, user_id, document_type, first_name, last_name, date_of_birth,
			country, document_number, address, city, state, postal_code, level, status,
			rejection_reason, submitted_at, reviewed_at, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, 0), ?, ?)
	`
	_, err := s.db.ExecContext(ctx, q,
		app.ID, app.UserID, app.DocumentType, app.FirstName, app.LastName, app.DOB,
		app.Country, app.DocumentID, app.Address, app.City, app.State, app.ZipCode,
		app.Level, app.Status, app.RejectReason, app.SubmittedAt, app.ReviewedAt, now, now,
	)
	if err != nil {
		return fmt.Errorf("creating kyc application: %w", err)
	}
	return nil
}

func (s *SQLiteStore) UpdateApplication(ctx context.Context, app *Application) error {
	const q = `
		UPDATE kyc_applications SET
			document_type = ?, first_name = ?, last_name = ?, date_of_birth = ?, country = ?,
			document_number = ?, address = ?, city = ?, state = ?, postal_code = ?,
			level = ?, status = ?, rejection_reason = ?, submitted_at = ?,
			reviewed_at = NULLIF(?, 0), updated_at = ?
		WHERE user_id = ?
	`
	res, err := s.db.ExecContext(ctx, q,
		app.DocumentType, app.FirstName, app.LastName, app.DOB, app.Country,
		app.DocumentID, app.Address, app.City, app.State, app.ZipCode,
		app.Level, app.Status, app.RejectReason, app.SubmittedAt,
		app.ReviewedAt, time.Now().Unix(), app.UserID,
	)
	if err != nil {
		return fmt.Errorf("updating kyc application: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking update result: %w", err)
	}
	if affected == 0 {
		return ErrNotSubmitted
	}
	return nil
}

// SetUserKYCLevel records the user's effective level. The users table lives in
// PostgreSQL for the API service, so this store keeps its own mirror keyed by
// user ID; the API reads the level from the application row it already loads.
func (s *SQLiteStore) SetUserKYCLevel(ctx context.Context, userID string, level int) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE kyc_applications SET level = ?, updated_at = ? WHERE user_id = ?`,
		level, time.Now().Unix(), userID)
	if err != nil {
		return fmt.Errorf("setting user kyc level: %w", err)
	}
	return nil
}

func (s *SQLiteStore) RecordAudit(ctx context.Context, entry *AuditEntry) error {
	if entry == nil {
		return errors.New("audit entry is required")
	}
	if entry.ID == "" {
		id, err := newID("log")
		if err != nil {
			return err
		}
		entry.ID = id
	}
	if entry.CreatedAt == 0 {
		entry.CreatedAt = time.Now().Unix()
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO kyc_audit_logs (log_id, user_id, application_id, action, details, actor_id, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		entry.ID, entry.UserID, nil, entry.Action, entry.Details, entry.ActorID, entry.CreatedAt)
	if err != nil {
		return fmt.Errorf("recording kyc audit entry: %w", err)
	}
	return nil
}

// AuditLog returns audit entries for a user, newest first. It exists for the
// compliance review screen.
func (s *SQLiteStore) AuditLog(ctx context.Context, userID string, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT log_id, COALESCE(user_id, ''), action, COALESCE(details, ''),
		       COALESCE(actor_id, ''), created_at
		FROM kyc_audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("loading kyc audit log: %w", err)
	}
	defer rows.Close()

	var entries []AuditEntry
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.Action, &e.Details, &e.ActorID, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scanning kyc audit entry: %w", err)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating kyc audit log: %w", err)
	}
	return entries, nil
}

// AddDocument records an uploaded document's location and digest.
func (s *SQLiteStore) AddDocument(ctx context.Context, applicationID, documentType, side, filePath, fileHash string) (string, error) {
	id, err := newID("doc")
	if err != nil {
		return "", err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO kyc_documents (document_id, application_id, document_type, side, file_path, file_hash, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, applicationID, documentType, side, filePath, fileHash, time.Now().Unix())
	if err != nil {
		return "", fmt.Errorf("recording kyc document: %w", err)
	}
	return id, nil
}

var _ Store = (*SQLiteStore)(nil)
