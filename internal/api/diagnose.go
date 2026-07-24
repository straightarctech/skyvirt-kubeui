package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/ai"
	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// DiagnoseHandler serves the one-click pod troubleshooting report and the
// optional AI "explain" for a finding.
type DiagnoseHandler struct {
	kc *k8s.Client
	ai *ai.Client
}

func diagnoseHandler(kc *k8s.Client, aiClient *ai.Client) *DiagnoseHandler {
	return &DiagnoseHandler{kc: kc, ai: aiClient}
}

// DiagnosePod handles GET /api/v1/diagnose/pod/{namespace}/{name}.
func (h *DiagnoseHandler) DiagnosePod(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	report, err := h.kc.DiagnosePod(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, report)
}

// DiagnoseWorkload handles GET /api/v1/diagnose/workload/{kind}/{namespace}/{name}.
func (h *DiagnoseHandler) DiagnoseWorkload(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	report, err := h.kc.DiagnoseWorkload(r.Context(), kind, ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, report)
}

// explainRequest is one diagnosis finding plus its pod context.
type explainRequest struct {
	Namespace  string   `json:"namespace"`
	Name       string   `json:"name"`
	Phase      string   `json:"phase"`
	Node       string   `json:"node"`
	Title      string   `json:"title"`
	Detail     string   `json:"detail"`
	Evidence   []string `json:"evidence"`
	Suggestion string   `json:"suggestion"`
	// AllowedFixes are pre-validated, correctly-targeted safe remediations the
	// UI computed for this finding. The model may only PICK one of these (by
	// index) — it can never invent an action or target.
	AllowedFixes []ProposedFix `json:"allowed_fixes"`
}

// ProposedFix is a whitelisted remediation the UI can apply after the human
// approves it. It executes via the existing action endpoints (with the caller's
// creds), never from here.
type ProposedFix struct {
	Action string `json:"action"` // restart | delete_pod | uncordon | cordon
	Kind   string `json:"kind"`
	Ns     string `json:"namespace,omitempty"`
	Name   string `json:"name"`
	Label  string `json:"label"`
	Danger bool   `json:"danger,omitempty"`
}

const explainSystemPrompt = `You are a Kubernetes troubleshooting assistant embedded in a cluster console.
Given a diagnosed issue about a pod and a list of candidate remediation actions, respond with ONLY a JSON object, no prose around it:
{"explanation": string, "fix_index": integer}
- explanation: the most likely ROOT CAUSE (2-4 sentences), concrete NEXT STEPS (prefer specific kubectl commands), and anything to watch out for. Plain text, under ~160 words.
- fix_index: the 0-based index of the SINGLE candidate fix most likely to safely help, or -1 if none is appropriate or manual investigation should come first.
You are ADVISORY: recommending a fix does NOT execute it — a human reviews and applies it. NEVER invent a fix that is not in the candidate list. Do not invent facts not supported by the evidence.`

// ExplainFinding handles POST /api/v1/diagnose/explain — sends one finding (and
// its candidate fixes) to the on-prem LLM and returns a plain-language
// explanation plus, optionally, the single fix the model recommends. The fix is
// echoed from the caller-supplied allow-list — the model only selects an index.
func (h *DiagnoseHandler) ExplainFinding(w http.ResponseWriter, r *http.Request) {
	if h.ai == nil || !h.ai.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "AI assistance is not configured")
		return
	}
	var req explainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Pod: %s/%s (phase %s", req.Namespace, req.Name, req.Phase)
	if req.Node != "" {
		fmt.Fprintf(&b, ", node %s", req.Node)
	}
	fmt.Fprintf(&b, ")\nIssue: %s\n", req.Title)
	if req.Detail != "" {
		fmt.Fprintf(&b, "Detail: %s\n", req.Detail)
	}
	for _, e := range req.Evidence {
		fmt.Fprintf(&b, "Evidence:\n%s\n", e)
	}
	if req.Suggestion != "" {
		fmt.Fprintf(&b, "Rule-based hint: %s\n", req.Suggestion)
	}
	if len(req.AllowedFixes) > 0 {
		b.WriteString("\nCandidate fixes (pick at most one by index):\n")
		for i, f := range req.AllowedFixes {
			fmt.Fprintf(&b, "  [%d] %s\n", i, f.Label)
		}
	} else {
		b.WriteString("\nNo candidate fixes are available; use fix_index -1.\n")
	}

	answer, err := h.ai.Chat(r.Context(), explainSystemPrompt, b.String())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	// Parse the model's JSON; degrade gracefully to explanation-only.
	parsed := struct {
		Explanation string `json:"explanation"`
		FixIndex    int    `json:"fix_index"`
	}{FixIndex: -1}
	explanation := strings.TrimSpace(answer)
	var fix *ProposedFix
	if js := extractJSONObject(answer); js != "" {
		if err := json.Unmarshal([]byte(js), &parsed); err == nil {
			if strings.TrimSpace(parsed.Explanation) != "" {
				explanation = strings.TrimSpace(parsed.Explanation)
			}
			if parsed.FixIndex >= 0 && parsed.FixIndex < len(req.AllowedFixes) {
				f := req.AllowedFixes[parsed.FixIndex]
				fix = &f
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"explanation": explanation, "fix": fix})
}

// extractJSONObject returns the substring from the first '{' to the last '}',
// tolerating any prose the model wraps around the JSON.
func extractJSONObject(s string) string {
	i := strings.IndexByte(s, '{')
	j := strings.LastIndexByte(s, '}')
	if i < 0 || j < i {
		return ""
	}
	return s[i : j+1]
}
