package db

import (
	"strings"
	"testing"

	"go.uber.org/zap"
)

// What this file can and cannot cover
//
// New() is testable because it PINGS rather than relying on sql.Open's lazy
// behaviour — a bad DSN fails here and now, at startup, which is the whole point
// of the check and worth a test.
//
// Everything else in this package — Migrate and every query — needs a real
// PostgreSQL. Those tests are deliberately NOT written as skip-if-unset: this
// project has already been bitten by a suite that skipped and reported success
// (see the skyvirtstore-engine job comment in the sibling repo's CI: "a skip is
// reported exactly like a pass … ~290 tests protecting nothing"). A test that
// silently does nothing is worse than an absent one, because it reads as
// coverage.
//
// To cover the rest properly, add a postgres service to the pipeline (GitLab
// `services:`, GitHub `services:`) and point these tests at it so they always
// run. Until that exists, the gap is stated rather than papered over.

// TestNew_FailsFastOnAnUnreachableServer: DATABASE_URL is optional, and main.go
// calls logger.Fatal when New returns an error. So New must actually detect a
// dead database rather than returning a handle that fails later on first use —
// otherwise the process starts "healthy" and every audit write fails in the dark.
func TestNew_FailsFastOnAnUnreachableServer(t *testing.T) {
	// Port 1 refuses immediately; connect_timeout bounds the worst case.
	dsn := "postgres://kubeui:secret@127.0.0.1:1/kubeui?sslmode=disable&connect_timeout=1"

	got, err := New(dsn, zap.NewNop())
	if err == nil {
		t.Fatal("New succeeded against an unreachable server; a dead database would surface only on first query")
	}
	if got != nil {
		t.Error("New returned a non-nil PostgresDB alongside an error — callers that ignore err would deref a broken handle")
	}
	if !strings.Contains(err.Error(), "pinging postgres") {
		t.Errorf("error = %q, want it to name the ping so the cause is obvious in a startup log", err)
	}
}

// TestNew_RejectsAMalformedDSN: sql.Open is lazy and accepts almost anything, so
// without the ping a typo in DATABASE_URL would be indistinguishable from a
// working configuration until the first write.
func TestNew_RejectsAMalformedDSN(t *testing.T) {
	for _, dsn := range []string{
		"",
		"not-a-dsn",
		"postgres://",
		"mysql://user@localhost/db",
	} {
		t.Run(dsn, func(t *testing.T) {
			got, err := New(dsn, zap.NewNop())
			if err == nil {
				t.Errorf("New(%q) succeeded, want an error", dsn)
			}
			if got != nil {
				t.Errorf("New(%q) returned a handle alongside an error", dsn)
			}
		})
	}
}
