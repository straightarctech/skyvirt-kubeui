package api

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
)

// AuthProxyHandler proxies authentication requests to the engine. When
// KUBEUI_CLUSTER_ID is set, successful logins/refreshes are additionally
// exchanged for a cluster-scoped console token (signed with this cluster's
// derived secret) via the engine's kubeui-token endpoint — the engine-signed
// session token never reaches the browser, and this console's JWT_SECRET
// cannot validate (or forge) engine tokens.
type AuthProxyHandler struct {
	engine    *EngineClient
	clusterID string
}

func newAuthProxyHandler(engine *EngineClient) *AuthProxyHandler {
	return &AuthProxyHandler{
		engine:    engine,
		clusterID: os.Getenv("KUBEUI_CLUSTER_ID"),
	}
}

// Login proxies POST /api/v1/auth/login to the engine (+ token exchange).
func (h *AuthProxyHandler) Login(w http.ResponseWriter, r *http.Request) {
	h.proxyWithExchange(w, r, "/api/v1/auth/login")
}

// Refresh proxies POST /api/v1/auth/refresh to the engine (+ token exchange).
func (h *AuthProxyHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	h.proxyWithExchange(w, r, "/api/v1/auth/refresh")
}

// Me proxies GET /api/v1/auth/me to the engine. Note: with cluster-scoped
// tokens the browser no longer holds an engine token, so this only works in
// legacy (shared-secret / no-exchange) deployments; the UI decodes its user
// info from the JWT and does not depend on it.
func (h *AuthProxyHandler) Me(w http.ResponseWriter, r *http.Request) {
	h.engine.ProxyRequest(w, r, "/api/v1/auth/me")
}

func (h *AuthProxyHandler) proxyWithExchange(w http.ResponseWriter, r *http.Request, enginePath string) {
	if h.clusterID == "" {
		h.engine.ProxyRequest(w, r, enginePath)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	status, respBody, err := h.engine.Do(r.Context(), r.Method, enginePath, r.Header.Get("Content-Type"), body, r.Header.Get("Authorization"))
	if err != nil {
		writeError(w, http.StatusBadGateway, "engine unavailable")
		return
	}

	// Pass failures (bad creds, MFA challenges, lockouts) through untouched.
	var payload map[string]interface{}
	if status != http.StatusOK || json.Unmarshal(respBody, &payload) != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		w.Write(respBody)
		return
	}
	engineToken, _ := payload["token"].(string)
	if engineToken == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		w.Write(respBody)
		return
	}

	// Exchange the engine session for a cluster-scoped console token.
	xStatus, xBody, err := h.engine.Do(r.Context(), http.MethodPost,
		"/api/v1/k8s/clusters/"+h.clusterID+"/kubeui-token", "application/json", nil, "Bearer "+engineToken)
	if err != nil || xStatus != http.StatusOK {
		writeError(w, http.StatusBadGateway, "console token exchange failed")
		return
	}
	var xResp struct {
		Token string `json:"token"`
	}
	if json.Unmarshal(xBody, &xResp) != nil || xResp.Token == "" {
		writeError(w, http.StatusBadGateway, "console token exchange returned no token")
		return
	}

	payload["token"] = xResp.Token
	writeJSON(w, http.StatusOK, payload)
}
