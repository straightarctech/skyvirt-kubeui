// Package audit records mutating actions performed through the UI (who did what,
// to which resource, when, and with what result). It is store-agnostic: an
// in-memory ring buffer by default (works out-of-the-box, air-gap friendly, no
// external dependency) and a durable Postgres backend when one is configured.
package audit

import (
	"sync"
	"time"
)

// Entry is one recorded action.
type Entry struct {
	ID        int64     `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	User      string    `json:"user"`             // user id (uid)
	Email     string    `json:"email,omitempty"`  // if present in the token
	Role      string    `json:"role,omitempty"`   // admin / operator / viewer
	Action    string    `json:"action"`           // create | update | delete | scale | restart | cordon | exec | apply …
	Kind      string    `json:"kind,omitempty"`   // Pod, Deployment, Service …
	Namespace string    `json:"namespace,omitempty"`
	Name      string    `json:"name,omitempty"`
	Resource  string    `json:"resource"`         // human summary, e.g. "Deployment default/web"
	Method    string    `json:"method"`
	Path      string    `json:"path"`
	Status    int        `json:"status"`          // HTTP status (records denied/failed attempts too)
}

// Store records and lists audit entries. Implementations must be safe for
// concurrent use.
type Store interface {
	Record(e Entry)
	// List returns entries newest-first plus the total count available.
	List(limit, offset int) ([]Entry, int)
}

// MemoryStore is a bounded, in-memory ring buffer — the default when no durable
// backend is configured. Entries are lost on restart; it keeps the most recent
// `cap` actions for at-a-glance activity.
type MemoryStore struct {
	mu      sync.RWMutex
	entries []Entry // oldest → newest
	cap     int
	nextID  int64
}

func NewMemoryStore(capacity int) *MemoryStore {
	if capacity <= 0 {
		capacity = 2000
	}
	return &MemoryStore{entries: make([]Entry, 0, capacity), cap: capacity}
}

func (m *MemoryStore) Record(e Entry) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextID++
	e.ID = m.nextID
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now()
	}
	m.entries = append(m.entries, e)
	if len(m.entries) > m.cap {
		m.entries = m.entries[len(m.entries)-m.cap:]
	}
}

func (m *MemoryStore) List(limit, offset int) ([]Entry, int) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	total := len(m.entries)
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	// Newest-first.
	out := make([]Entry, 0, limit)
	for i := total - 1 - offset; i >= 0 && len(out) < limit; i-- {
		out = append(out, m.entries[i])
	}
	return out, total
}
