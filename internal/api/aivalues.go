package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/straightarctech/skyvirt-kubeui/internal/ai"
)

// AIValuesHandler answers questions about a chart's values via the on-prem AI.
type AIValuesHandler struct{ ai *ai.Client }

func aiValuesHandler(a *ai.Client) *AIValuesHandler { return &AIValuesHandler{ai: a} }

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "\n# … (truncated)"
	}
	return s
}

// HelmValues explains / recommends chart values using the local model — advisory,
// air-gapped, never leaves the cluster.
func (h *AIValuesHandler) HelmValues(w http.ResponseWriter, r *http.Request) {
	if !h.ai.Enabled() {
		writeError(w, http.StatusBadRequest, "on-prem AI is not configured")
		return
	}
	var req struct {
		Chart  string `json:"chart"`
		Values string `json:"values"`
		Ask    string `json:"ask"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	ask := req.Ask
	if ask == "" {
		ask = "Explain the most important values, and recommend safe production-ready settings."
	}
	system := "You are a Kubernetes and Helm expert. Answer concisely and practically in Markdown. " +
		"Only reference values that appear in the provided values.yaml — never invent fields. " +
		"Call out anything unsafe for production."
	user := fmt.Sprintf("Helm chart: %s\n\nvalues.yaml:\n```yaml\n%s\n```\n\nQuestion: %s", req.Chart, truncate(req.Values, 6000), ask)

	out, err := h.ai.Chat(r.Context(), system, user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"answer": out})
}
