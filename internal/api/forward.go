package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ForwardHandler ships KubeUI's security signals into a SIEM / SecSphere, either
// on demand or on a server-side schedule.
type ForwardHandler struct {
	kc     *k8s.Client
	logger *zap.Logger
}

func forwardHandler(kc *k8s.Client, logger *zap.Logger) *ForwardHandler {
	return &ForwardHandler{kc: kc, logger: logger}
}

// securityEvent is one normalized finding sent to the SIEM.
type securityEvent struct {
	Source    string `json:"source"`   // always "kubeui"
	Type      string `json:"type"`     // vulnerability | certificate | misconfiguration | rbac
	Severity  string `json:"severity"` // critical | high | warning
	Namespace string `json:"namespace,omitempty"`
	Resource  string `json:"resource"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"` // RFC3339
}

// signalSet selects which finding sources are collected. vuln+cert are the CVE /
// certificate tier; config+rbac are the posture tier.
type signalSet struct {
	Vuln   bool `json:"vuln"`
	Cert   bool `json:"cert"`
	Config bool `json:"config"`
	RBAC   bool `json:"rbac"`
}

// forwardTarget is where events are shipped. Any subset may be set.
type forwardTarget struct {
	SyslogAddr string `json:"syslog_addr,omitempty"` // host:port (UDP, RFC5424)
	HTTPURL    string `json:"http_url,omitempty"`    // POST JSON array
	HECURL     string `json:"hec_url,omitempty"`     // Splunk-style HEC collector (SecSphere :8088)
	HECToken   string `json:"hec_token,omitempty"`   // optional HEC auth token
}

func (t forwardTarget) empty() bool {
	return t.SyslogAddr == "" && t.HTTPURL == "" && t.HECURL == ""
}

// forwardConfig is the persisted auto-forward configuration (stored in a Secret,
// since it carries the HEC token).
type forwardConfig struct {
	Enabled         bool          `json:"enabled"`
	IntervalMinutes int           `json:"interval_minutes"`
	Signals         signalSet     `json:"signals"`
	Target          forwardTarget `json:"target"`
	// status (written by the scheduler; not settable by clients)
	LastRun     string `json:"last_run,omitempty"`
	LastResult  string `json:"last_result,omitempty"`
	HECTokenSet bool   `json:"hec_token_set"` // GET-only: whether a token is stored
}

const (
	cfgSecretName  = "kubeui-siem-forward"
	minIntervalMin = 5
	maxIntervalMin = 1440
)

func defaultConfig() forwardConfig {
	return forwardConfig{
		Enabled:         false,
		IntervalMinutes: 60,
		Signals:         signalSet{Vuln: true, Cert: true},
	}
}

// ownNamespace is the namespace KubeUI runs in (where its config Secret lives).
func ownNamespace() string {
	if b, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace"); err == nil {
		if ns := strings.TrimSpace(string(b)); ns != "" {
			return ns
		}
	}
	if ns := os.Getenv("POD_NAMESPACE"); ns != "" {
		return ns
	}
	return "skyvirthci-kubeui"
}

// collect gathers the enabled security signals as normalized events.
func (h *ForwardHandler) collect(ctx context.Context, sig signalSet) []securityEvent {
	now := time.Now().UTC().Format(time.RFC3339)
	var events []securityEvent

	if sig.Vuln {
		if reports, err := h.kc.ListVulnReports(ctx); err == nil {
			for _, v := range reports {
				if v.Critical == 0 && v.High == 0 {
					continue
				}
				sev := "high"
				if v.Critical > 0 {
					sev = "critical"
				}
				events = append(events, securityEvent{
					Source: "kubeui", Type: "vulnerability", Severity: sev,
					Namespace: v.Namespace, Resource: v.Image,
					Message:   fmt.Sprintf("%s: %d critical, %d high CVEs (%s)", v.Image, v.Critical, v.High, v.Workload),
					Timestamp: now,
				})
			}
		}
	}
	if sig.Cert {
		if certs, err := h.kc.ScanCertExpiry(ctx); err == nil {
			for _, cert := range certs {
				if !cert.Expired && cert.DaysLeft > 30 {
					continue
				}
				sev := "warning"
				if cert.Expired || cert.DaysLeft <= 7 {
					sev = "critical"
				}
				state := fmt.Sprintf("expires in %dd", cert.DaysLeft)
				if cert.Expired {
					state = "EXPIRED"
				}
				events = append(events, securityEvent{
					Source: "kubeui", Type: "certificate", Severity: sev,
					Namespace: cert.Namespace, Resource: cert.Secret,
					Message:   fmt.Sprintf("TLS cert %s (%s) %s", cert.CommonName, cert.Secret, state),
					Timestamp: now,
				})
			}
		}
	}
	if sig.Config {
		if reports, err := h.kc.ListConfigAuditReports(ctx); err == nil {
			for _, c := range reports {
				if c.Critical == 0 && c.High == 0 {
					continue
				}
				sev := "high"
				if c.Critical > 0 {
					sev = "critical"
				}
				events = append(events, securityEvent{
					Source: "kubeui", Type: "misconfiguration", Severity: sev,
					Namespace: c.Namespace, Resource: c.Resource,
					Message:   fmt.Sprintf("%s: %d critical, %d high config-audit failures", c.Resource, c.Critical, c.High),
					Timestamp: now,
				})
			}
		}
	}
	if sig.RBAC {
		if binds, err := h.kc.RiskyClusterRoleBindings(ctx); err == nil {
			for _, b := range binds {
				events = append(events, securityEvent{
					Source: "kubeui", Type: "rbac", Severity: "warning",
					Resource:  b.Name,
					Message:   fmt.Sprintf("risky ClusterRoleBinding %s → %s (%s); subjects: %s", b.Name, b.Role, strings.Join(b.Reasons, ", "), strings.Join(b.Subjects, ", ")),
					Timestamp: now,
				})
			}
		}
	}
	return events
}

// dispatch ships events to every configured target and returns the sent count and
// any per-target errors.
func dispatch(ctx context.Context, events []securityEvent, tgt forwardTarget, host string) (int, []string) {
	sent := 0
	errs := []string{}
	if tgt.SyslogAddr != "" {
		if n, err := sendSyslog(events, tgt.SyslogAddr, host); err != nil {
			errs = append(errs, "syslog: "+err.Error())
		} else {
			sent += n
		}
	}
	if tgt.HTTPURL != "" {
		if err := sendHTTP(ctx, events, tgt.HTTPURL); err != nil {
			errs = append(errs, "http: "+err.Error())
		} else {
			sent += len(events)
		}
	}
	if tgt.HECURL != "" {
		if n, err := sendHEC(ctx, events, tgt.HECURL, tgt.HECToken, host); err != nil {
			errs = append(errs, "hec: "+err.Error())
		} else {
			sent += n
		}
	}
	return sent, errs
}

// Security forwards the collected events on demand to a target supplied in the
// request body. Point it at SecSphere's log-pipeline (HEC :8088 / syslog :514).
func (h *ForwardHandler) Security(w http.ResponseWriter, r *http.Request) {
	var tgt forwardTarget
	if err := json.NewDecoder(r.Body).Decode(&tgt); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if tgt.empty() {
		writeError(w, http.StatusBadRequest, "provide syslog_addr, http_url, and/or hec_url")
		return
	}
	// Manual forward collects every signal — the operator asked for it explicitly.
	events := h.collect(r.Context(), signalSet{Vuln: true, Cert: true, Config: true, RBAC: true})
	host, _ := os.Hostname()
	sent, errs := dispatch(r.Context(), events, tgt, host)
	writeJSON(w, http.StatusOK, map[string]any{"collected": len(events), "sent": sent, "errors": errs})
}

// GetConfig returns the persisted auto-forward config (token value blanked).
func (h *ForwardHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.loadConfig(r.Context())
	if err != nil {
		cfg = defaultConfig()
	}
	cfg.HECTokenSet = cfg.Target.HECToken != ""
	cfg.Target.HECToken = ""
	writeJSON(w, http.StatusOK, cfg)
}

// PutConfig persists the auto-forward config. An empty hec_token preserves the
// stored one (so the UI never has to round-trip the secret). Status fields are
// owned by the scheduler and cannot be set by clients.
func (h *ForwardHandler) PutConfig(w http.ResponseWriter, r *http.Request) {
	var in forwardConfig
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	cur, _ := h.loadConfig(r.Context())
	if in.Target.HECToken == "" {
		in.Target.HECToken = cur.Target.HECToken
	}
	if in.IntervalMinutes < minIntervalMin {
		in.IntervalMinutes = minIntervalMin
	}
	if in.IntervalMinutes > maxIntervalMin {
		in.IntervalMinutes = maxIntervalMin
	}
	in.LastRun, in.LastResult = cur.LastRun, cur.LastResult
	if err := h.saveConfig(r.Context(), in); err != nil {
		writeError(w, http.StatusInternalServerError, "save failed: "+err.Error())
		return
	}
	in.HECTokenSet = in.Target.HECToken != ""
	in.Target.HECToken = ""
	writeJSON(w, http.StatusOK, in)
}

func (h *ForwardHandler) loadConfig(ctx context.Context) (forwardConfig, error) {
	cfg := defaultConfig()
	s, err := h.kc.Clientset.CoreV1().Secrets(ownNamespace()).Get(ctx, cfgSecretName, metav1.GetOptions{})
	if err != nil {
		return cfg, err
	}
	if raw, ok := s.Data["config.json"]; ok {
		_ = json.Unmarshal(raw, &cfg)
	}
	if cfg.IntervalMinutes == 0 {
		cfg.IntervalMinutes = 60
	}
	return cfg, nil
}

func (h *ForwardHandler) saveConfig(ctx context.Context, cfg forwardConfig) error {
	cfg.HECTokenSet = false // derived on read, never persisted
	raw, _ := json.Marshal(cfg)
	ns := ownNamespace()
	secrets := h.kc.Clientset.CoreV1().Secrets(ns)
	existing, err := secrets.Get(ctx, cfgSecretName, metav1.GetOptions{})
	if err != nil {
		_, err = secrets.Create(ctx, &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      cfgSecretName,
				Namespace: ns,
				Labels:    map[string]string{"app.kubernetes.io/managed-by": "kubeui"},
			},
			Data: map[string][]byte{"config.json": raw},
		}, metav1.CreateOptions{})
		return err
	}
	if existing.Data == nil {
		existing.Data = map[string][]byte{}
	}
	existing.Data["config.json"] = raw
	_, err = secrets.Update(ctx, existing, metav1.UpdateOptions{})
	return err
}

// recordRun updates just the scheduler status fields without clobbering config.
func (h *ForwardHandler) recordRun(ctx context.Context, collected, sent int, errs []string) {
	cfg, err := h.loadConfig(ctx)
	if err != nil {
		return
	}
	cfg.LastRun = time.Now().UTC().Format(time.RFC3339)
	if len(errs) == 0 {
		cfg.LastResult = fmt.Sprintf("forwarded %d/%d events", sent, collected)
	} else {
		cfg.LastResult = fmt.Sprintf("%d/%d sent; errors: %s", sent, collected, strings.Join(errs, "; "))
	}
	_ = h.saveConfig(ctx, cfg)
}

// RunScheduler is the background auto-forward loop. It re-reads config each cycle
// so enable/interval/target changes take effect without a restart.
func (h *ForwardHandler) RunScheduler(ctx context.Context) {
	host, _ := os.Hostname()
	for {
		cfg, _ := h.loadConfig(ctx)
		wait := time.Minute // idle poll cadence when disabled
		if cfg.Enabled && !cfg.Target.empty() {
			events := h.collect(ctx, cfg.Signals)
			sent, errs := dispatch(ctx, events, cfg.Target, host)
			h.recordRun(ctx, len(events), sent, errs)
			if h.logger != nil {
				h.logger.Info("siem scheduled forward",
					zap.Int("collected", len(events)), zap.Int("sent", sent), zap.Strings("errors", errs))
			}
			wait = time.Duration(cfg.IntervalMinutes) * time.Minute
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

func sendSyslog(events []securityEvent, addr, host string) (int, error) {
	conn, err := net.DialTimeout("udp", addr, 5*time.Second)
	if err != nil {
		return 0, err
	}
	defer conn.Close()
	n := 0
	for _, ev := range events {
		sev := 6 // info
		switch ev.Severity {
		case "critical":
			sev = 2
		case "high":
			sev = 3
		case "warning":
			sev = 4
		}
		pri := 16*8 + sev // local0 facility
		b, _ := json.Marshal(ev)
		line := fmt.Sprintf("<%d>1 %s %s kubeui - - - %s", pri, ev.Timestamp, host, string(b))
		if _, err := conn.Write([]byte(line)); err == nil {
			n++
		}
	}
	return n, nil
}

func sendHTTP(ctx context.Context, events []securityEvent, url string) error {
	body, _ := json.Marshal(events)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("endpoint returned %d", resp.StatusCode)
	}
	return nil
}

// sendHEC ships events to a Splunk-style HTTP Event Collector — SecSphere's
// log-pipeline exposes one on :8088 (/services/collector/event). Each event is
// wrapped in the HEC envelope and the batch is sent newline-delimited.
func sendHEC(ctx context.Context, events []securityEvent, url, token, host string) (int, error) {
	if len(events) == 0 {
		return 0, nil
	}
	now := time.Now().UTC().Unix()
	var buf bytes.Buffer
	for _, ev := range events {
		rec := map[string]any{
			"time": now, "host": host, "source": "kubeui", "sourcetype": "kubeui:security",
			"event": ev,
		}
		b, _ := json.Marshal(rec)
		buf.Write(b)
		buf.WriteByte('\n')
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &buf)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Splunk "+token)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	// HEC returns 200 on accept. Some pipelines return 503 while their downstream
	// index is unavailable even though the event was accepted — surface that.
	if resp.StatusCode >= 300 {
		return 0, fmt.Errorf("collector returned %d", resp.StatusCode)
	}
	return len(events), nil
}
