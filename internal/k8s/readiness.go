package k8s

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Readiness verdict levels, ordered by severity (pass < warn < block).
const (
	ReadyPass  = "pass"
	ReadyWarn  = "warn"
	ReadyBlock = "block"
)

// ReadinessCheck is one dimension of the pre-upgrade go/no-go report.
type ReadinessCheck struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Status  string   `json:"status"`  // pass | warn | block
	Summary string   `json:"summary"` // one-line result
	Detail  []string `json:"detail,omitempty"`
}

// ReadinessReport rolls the checks into a single upgrade verdict.
type ReadinessReport struct {
	Verdict     string           `json:"verdict"` // pass | warn | block
	Checks      []ReadinessCheck `json:"checks"`
	GeneratedAt string           `json:"generated_at"`
}

// certExpiryWarnDays is how soon a certificate has to expire to be a warning.
const certExpiryWarnDays = 14

// worst returns the more severe of two verdict levels.
func worst(a, b string) string {
	rank := map[string]int{ReadyPass: 0, ReadyWarn: 1, ReadyBlock: 2}
	if rank[b] > rank[a] {
		return b
	}
	return a
}

// capDetail trims a detail list so a report can't balloon; the summary always
// carries the true total.
func capDetail(items []string, max int) []string {
	if len(items) <= max {
		return items
	}
	out := append([]string{}, items[:max]...)
	return append(out, fmt.Sprintf("…and %d more", len(items)-max))
}

// UpgradeReadiness runs the pre-upgrade checks and returns a single go/no-go
// verdict. It is entirely read-only. Each dimension reuses an existing scanner
// so the verdict stays consistent with the detail pages.
func (c *Client) UpgradeReadiness(ctx context.Context) (*ReadinessReport, error) {
	rep := &ReadinessReport{Verdict: ReadyPass, GeneratedAt: time.Now().UTC().Format(time.RFC3339)}

	rep.Checks = append(rep.Checks,
		c.checkDeprecatedAPIs(ctx),
		c.checkCertExpiry(ctx),
		c.checkNodeHealth(ctx),
		c.checkPDBHealth(ctx),
	)
	for _, chk := range rep.Checks {
		rep.Verdict = worst(rep.Verdict, chk.Status)
	}
	return rep, nil
}

// checkDeprecatedAPIs blocks the upgrade on any deprecated/removed API in use —
// those objects break on a version bump and must be migrated first.
func (c *Client) checkDeprecatedAPIs(ctx context.Context) ReadinessCheck {
	chk := ReadinessCheck{ID: "deprecated-apis", Title: "Deprecated / removed APIs", Status: ReadyPass}
	findings, err := c.ScanDeprecatedAPIs(ctx)
	if err != nil {
		chk.Status = ReadyWarn
		chk.Summary = "Scan could not complete: " + err.Error()
		return chk
	}
	findings = append(findings, c.ScanDeprecatedAPIsLive(ctx)...)
	seen := map[string]bool{}
	var detail []string
	for _, f := range findings {
		key := f.APIVersion + "|" + f.Kind + "|" + f.Name
		if seen[key] {
			continue
		}
		seen[key] = true
		detail = append(detail, fmt.Sprintf("%s %s (%s) → use %s [removed in %s]", f.Kind, f.Name, f.APIVersion, f.Replacement, f.RemovedIn))
	}
	if len(detail) == 0 {
		chk.Summary = "No deprecated or removed APIs in use."
		return chk
	}
	chk.Status = ReadyBlock
	chk.Summary = fmt.Sprintf("%d object(s) use a deprecated or removed API — migrate before upgrading.", len(detail))
	chk.Detail = capDetail(detail, 10)
	return chk
}

// checkCertExpiry blocks on already-expired certs and warns on ones expiring
// soon — an upgrade often restarts components that then fail on a bad cert.
func (c *Client) checkCertExpiry(ctx context.Context) ReadinessCheck {
	chk := ReadinessCheck{ID: "cert-expiry", Title: "Certificate expiry", Status: ReadyPass}
	certs, err := c.ScanCertExpiry(ctx)
	if err != nil {
		chk.Status = ReadyWarn
		chk.Summary = "Scan could not complete: " + err.Error()
		return chk
	}
	var expired, soon []string
	for _, cert := range certs {
		if cert.NoExpiry {
			continue // hygiene flag, not an upgrade blocker
		}
		switch {
		case cert.Expired:
			expired = append(expired, fmt.Sprintf("%s/%s (%s) expired %s", cert.Namespace, cert.Secret, cert.Kind, cert.NotAfter))
		case cert.DaysLeft <= certExpiryWarnDays:
			soon = append(soon, fmt.Sprintf("%s/%s (%s) expires in %dd", cert.Namespace, cert.Secret, cert.Kind, cert.DaysLeft))
		}
	}
	switch {
	case len(expired) > 0:
		chk.Status = ReadyBlock
		chk.Summary = fmt.Sprintf("%d certificate(s) already expired; %d expiring within %dd.", len(expired), len(soon), certExpiryWarnDays)
		chk.Detail = capDetail(append(expired, soon...), 10)
	case len(soon) > 0:
		chk.Status = ReadyWarn
		chk.Summary = fmt.Sprintf("%d certificate(s) expiring within %dd.", len(soon), certExpiryWarnDays)
		chk.Detail = capDetail(soon, 10)
	default:
		chk.Summary = "No certificates expired or expiring soon."
	}
	return chk
}

// checkNodeHealth blocks on NotReady nodes and warns on cordoned ones — the
// cluster should be fully healthy and schedulable before a rolling upgrade.
func (c *Client) checkNodeHealth(ctx context.Context) ReadinessCheck {
	chk := ReadinessCheck{ID: "node-health", Title: "Node health", Status: ReadyPass}
	nodes, err := c.ListNodes(ctx)
	if err != nil {
		chk.Status = ReadyWarn
		chk.Summary = "Node list unavailable: " + err.Error()
		return chk
	}
	var notReady, cordoned []string
	for _, n := range nodes {
		if n.Status != "Ready" {
			notReady = append(notReady, fmt.Sprintf("%s is %s", n.Name, n.Status))
		} else if n.Unschedulable {
			cordoned = append(cordoned, fmt.Sprintf("%s is cordoned", n.Name))
		}
	}
	switch {
	case len(notReady) > 0:
		chk.Status = ReadyBlock
		chk.Summary = fmt.Sprintf("%d node(s) NotReady; %d cordoned (of %d).", len(notReady), len(cordoned), len(nodes))
		chk.Detail = capDetail(append(notReady, cordoned...), 10)
	case len(cordoned) > 0:
		chk.Status = ReadyWarn
		chk.Summary = fmt.Sprintf("%d of %d node(s) cordoned.", len(cordoned), len(nodes))
		chk.Detail = capDetail(cordoned, 10)
	default:
		chk.Summary = fmt.Sprintf("All %d node(s) Ready and schedulable.", len(nodes))
	}
	return chk
}

// checkPDBHealth warns on PodDisruptionBudgets at zero allowed disruptions — a
// rolling upgrade (or a drain) would stall on them until the workload recovers.
func (c *Client) checkPDBHealth(ctx context.Context) ReadinessCheck {
	chk := ReadinessCheck{ID: "pdb-health", Title: "Disruption budgets", Status: ReadyPass}
	pdbs, err := c.Clientset.PolicyV1().PodDisruptionBudgets("").List(ctx, metav1.ListOptions{})
	if err != nil {
		chk.Status = ReadyWarn
		chk.Summary = "PDB list unavailable: " + err.Error()
		return chk
	}
	var stalled []string
	for i := range pdbs.Items {
		p := &pdbs.Items[i]
		if p.Status.ExpectedPods > 0 && p.Status.DisruptionsAllowed == 0 {
			stalled = append(stalled, fmt.Sprintf("%s/%s allows 0 disruptions (%d/%d healthy)",
				p.Namespace, p.Name, p.Status.CurrentHealthy, p.Status.DesiredHealthy))
		}
	}
	if len(stalled) == 0 {
		chk.Summary = fmt.Sprintf("All %d disruption budget(s) allow at least one eviction.", len(pdbs.Items))
		return chk
	}
	chk.Status = ReadyWarn
	chk.Summary = fmt.Sprintf("%d disruption budget(s) at zero — a rolling upgrade or drain would stall.", len(stalled))
	chk.Detail = capDetail(stalled, 10)
	return chk
}
