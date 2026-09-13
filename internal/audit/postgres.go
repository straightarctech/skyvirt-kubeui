package audit

import (
	"encoding/json"
	"time"

	"go.uber.org/zap"

	"github.com/straightarctech/skyvirt-kubeui/internal/db"
)

// PostgresStore is a durable audit backend, used when KubeUI is configured with
// a database (DATABASE_URL). It maps an Entry onto the audit_logs table: the
// core columns (user/action/resource/ts) plus the structured fields in the
// detail JSONB.
type PostgresStore struct {
	db     *db.PostgresDB
	logger *zap.Logger
}

func NewPostgresStore(pg *db.PostgresDB, logger *zap.Logger) *PostgresStore {
	return &PostgresStore{db: pg, logger: logger}
}

type detailBlob struct {
	Email     string `json:"email,omitempty"`
	Role      string `json:"role,omitempty"`
	Kind      string `json:"kind,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Status    int    `json:"status"`
}

// Record is best-effort: an audit write must never fail the user's request.
func (p *PostgresStore) Record(e Entry) {
	d := detailBlob{
		Email: e.Email, Role: e.Role, Kind: e.Kind, Namespace: e.Namespace,
		Name: e.Name, Method: e.Method, Path: e.Path, Status: e.Status,
	}
	if err := p.db.InsertAuditLog(e.User, e.Action, e.Resource, d); err != nil && p.logger != nil {
		p.logger.Warn("audit: failed to persist entry", zap.Error(err))
	}
}

func (p *PostgresStore) List(limit, offset int) ([]Entry, int) {
	rows, total, err := p.db.ListAuditLogs(limit, offset)
	if err != nil {
		if p.logger != nil {
			p.logger.Warn("audit: failed to list entries", zap.Error(err))
		}
		return nil, 0
	}
	out := make([]Entry, 0, len(rows))
	for _, r := range rows {
		var d detailBlob
		_ = json.Unmarshal(r.Detail, &d)
		out = append(out, Entry{
			ID:        int64(r.ID),
			Timestamp: r.TS.UTC().Truncate(time.Second),
			User:      r.UserID,
			Email:     d.Email,
			Role:      d.Role,
			Action:    r.Action,
			Kind:      d.Kind,
			Namespace: d.Namespace,
			Name:      d.Name,
			Resource:  r.Resource,
			Method:    d.Method,
			Path:      d.Path,
			Status:    d.Status,
		})
	}
	return out, total
}
