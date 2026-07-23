package audit

import "testing"

func seed(m *MemoryStore, n int) {
	for i := 0; i < n; i++ {
		m.Record(Entry{User: "u", Action: "create", Name: string(rune('a' + i))})
	}
}

func TestMemoryStore_ListNewestFirst(t *testing.T) {
	m := NewMemoryStore(100)
	seed(m, 3) // a, b, c in insertion order
	entries, total := m.List(10, 0)
	if total != 3 {
		t.Fatalf("total = %d, want 3", total)
	}
	if len(entries) != 3 {
		t.Fatalf("len = %d, want 3", len(entries))
	}
	if entries[0].Name != "c" {
		t.Errorf("newest-first: got %q first, want c", entries[0].Name)
	}
}

func TestMemoryStore_Limit(t *testing.T) {
	m := NewMemoryStore(100)
	seed(m, 10)
	entries, total := m.List(3, 0)
	if total != 10 {
		t.Errorf("total = %d, want 10", total)
	}
	if len(entries) != 3 {
		t.Errorf("len = %d, want 3 (limit)", len(entries))
	}
}

func TestMemoryStore_Offset(t *testing.T) {
	m := NewMemoryStore(100)
	seed(m, 5) // a,b,c,d,e ; newest-first = e,d,c,b,a
	entries, _ := m.List(10, 2)
	if len(entries) != 3 || entries[0].Name != "c" {
		t.Errorf("offset 2: got %d entries starting %q, want 3 starting c", len(entries), first(entries))
	}
}

// TestMemoryStore_NegativeOffset is the regression guard for the audit-log
// panic: a negative offset must clamp, not index out of range.
func TestMemoryStore_NegativeOffset(t *testing.T) {
	m := NewMemoryStore(100)
	seed(m, 3)
	entries, total := m.List(10, -1) // must not panic
	if total != 3 || len(entries) != 3 {
		t.Errorf("negative offset: got %d entries total %d, want 3/3", len(entries), total)
	}
}

func TestMemoryStore_NegativeOffsetEmpty(t *testing.T) {
	m := NewMemoryStore(100)
	entries, total := m.List(10, -1) // must not panic on empty store
	if total != 0 || len(entries) != 0 {
		t.Errorf("empty + negative offset: got %d/%d, want 0/0", len(entries), total)
	}
}

func TestMemoryStore_CapacityEviction(t *testing.T) {
	m := NewMemoryStore(2)
	seed(m, 5) // ring holds only the last 2
	entries, total := m.List(10, 0)
	if total != 2 {
		t.Fatalf("total = %d, want 2 (capacity)", total)
	}
	if entries[0].Name != "e" {
		t.Errorf("newest retained = %q, want e", entries[0].Name)
	}
}

func first(e []Entry) string {
	if len(e) == 0 {
		return ""
	}
	return e[0].Name
}
