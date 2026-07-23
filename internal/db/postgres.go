package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
	"go.uber.org/zap"
)

// PostgresDB wraps a PostgreSQL connection pool.
type PostgresDB struct {
	DB     *sql.DB
	Logger *zap.Logger
}

// New connects to PostgreSQL and returns a PostgresDB.
func New(dsn string, logger *zap.Logger) (*PostgresDB, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening postgres: %w", err)
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("pinging postgres: %w", err)
	}
	return &PostgresDB{DB: db, Logger: logger.Named("postgres")}, nil
}

// Close closes the database connection.
func (p *PostgresDB) Close() error {
	return p.DB.Close()
}

// Migrate runs all database migrations.
func (p *PostgresDB) Migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS audit_logs (
			id SERIAL PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT '',
			action TEXT NOT NULL,
			resource TEXT NOT NULL,
			detail JSONB DEFAULT '{}',
			ts TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs(ts DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id)`,
		`CREATE TABLE IF NOT EXISTS user_preferences (
			user_id TEXT PRIMARY KEY,
			theme TEXT NOT NULL DEFAULT 'dark',
			sidebar_collapsed BOOLEAN NOT NULL DEFAULT false,
			default_namespace TEXT NOT NULL DEFAULT 'default',
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS saved_queries (
			id SERIAL PRIMARY KEY,
			user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			query_type TEXT NOT NULL,
			query JSONB NOT NULL DEFAULT '{}',
			ts TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_saved_queries_user ON saved_queries(user_id)`,
	}
	for _, m := range migrations {
		if _, err := p.DB.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w\nSQL: %s", err, m)
		}
	}
	p.Logger.Info("migrations complete")
	return nil
}

// AuditLog represents an audit log entry.
type AuditLog struct {
	ID       int             `json:"id"`
	UserID   string          `json:"user_id"`
	Action   string          `json:"action"`
	Resource string          `json:"resource"`
	Detail   json.RawMessage `json:"detail"`
	TS       time.Time       `json:"ts"`
}

// InsertAuditLog adds an audit log entry.
func (p *PostgresDB) InsertAuditLog(userID, action, resource string, detail interface{}) error {
	detailJSON, err := json.Marshal(detail)
	if err != nil {
		detailJSON = []byte("{}")
	}
	_, err = p.DB.Exec(
		`INSERT INTO audit_logs (user_id, action, resource, detail) VALUES ($1, $2, $3, $4)`,
		userID, action, resource, detailJSON,
	)
	return err
}

// ListAuditLogs returns recent audit logs.
func (p *PostgresDB) ListAuditLogs(limit, offset int) ([]AuditLog, int, error) {
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	var total int
	if err := p.DB.QueryRow(`SELECT COUNT(*) FROM audit_logs`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := p.DB.Query(
		`SELECT id, user_id, action, resource, detail, ts FROM audit_logs ORDER BY ts DESC LIMIT $1 OFFSET $2`,
		limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var logs []AuditLog
	for rows.Next() {
		var l AuditLog
		if err := rows.Scan(&l.ID, &l.UserID, &l.Action, &l.Resource, &l.Detail, &l.TS); err != nil {
			return nil, 0, err
		}
		logs = append(logs, l)
	}
	return logs, total, rows.Err()
}

// UserPreferences represents user settings.
type UserPreferences struct {
	UserID           string `json:"user_id"`
	Theme            string `json:"theme"`
	SidebarCollapsed bool   `json:"sidebar_collapsed"`
	DefaultNamespace string `json:"default_namespace"`
}

// GetUserPreferences returns preferences for a user, creating defaults if not found.
func (p *PostgresDB) GetUserPreferences(userID string) (*UserPreferences, error) {
	prefs := &UserPreferences{UserID: userID}
	err := p.DB.QueryRow(
		`SELECT theme, sidebar_collapsed, default_namespace FROM user_preferences WHERE user_id = $1`,
		userID,
	).Scan(&prefs.Theme, &prefs.SidebarCollapsed, &prefs.DefaultNamespace)
	if err == sql.ErrNoRows {
		// Return defaults.
		prefs.Theme = "dark"
		prefs.DefaultNamespace = "default"
		return prefs, nil
	}
	return prefs, err
}

// SetUserPreferences upserts user preferences.
func (p *PostgresDB) SetUserPreferences(prefs *UserPreferences) error {
	_, err := p.DB.Exec(
		`INSERT INTO user_preferences (user_id, theme, sidebar_collapsed, default_namespace, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (user_id) DO UPDATE SET theme = $2, sidebar_collapsed = $3, default_namespace = $4, updated_at = now()`,
		prefs.UserID, prefs.Theme, prefs.SidebarCollapsed, prefs.DefaultNamespace,
	)
	return err
}

// SavedQuery represents a saved query.
type SavedQuery struct {
	ID        int             `json:"id"`
	UserID    string          `json:"user_id"`
	Name      string          `json:"name"`
	QueryType string          `json:"query_type"`
	Query     json.RawMessage `json:"query"`
	TS        time.Time       `json:"ts"`
}

// InsertSavedQuery adds a saved query.
func (p *PostgresDB) InsertSavedQuery(userID, name, queryType string, query interface{}) error {
	queryJSON, err := json.Marshal(query)
	if err != nil {
		return err
	}
	_, err = p.DB.Exec(
		`INSERT INTO saved_queries (user_id, name, query_type, query) VALUES ($1, $2, $3, $4)`,
		userID, name, queryType, queryJSON,
	)
	return err
}

// ListSavedQueries returns saved queries for a user.
func (p *PostgresDB) ListSavedQueries(userID string) ([]SavedQuery, error) {
	rows, err := p.DB.Query(
		`SELECT id, user_id, name, query_type, query, ts FROM saved_queries WHERE user_id = $1 ORDER BY ts DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var queries []SavedQuery
	for rows.Next() {
		var q SavedQuery
		if err := rows.Scan(&q.ID, &q.UserID, &q.Name, &q.QueryType, &q.Query, &q.TS); err != nil {
			return nil, err
		}
		queries = append(queries, q)
	}
	return queries, rows.Err()
}

// DeleteSavedQuery removes a saved query by ID.
func (p *PostgresDB) DeleteSavedQuery(id int, userID string) error {
	_, err := p.DB.Exec(`DELETE FROM saved_queries WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}
