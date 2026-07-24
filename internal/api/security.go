package api

import (
	"net/http"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// securityPostureHandler serves a read-only cluster security scan.
func securityPostureHandler(kc *k8s.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		posture, err := kc.SecurityScan(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, posture)
	}
}

// clusterHealthHandler serves the whole-cluster triage board — everything that
// is broken or stuck right now, ranked.
func clusterHealthHandler(kc *k8s.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rep, err := kc.ClusterHealth(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, rep)
	}
}

// exposureHandler serves the external attack-surface inventory (LoadBalancer /
// NodePort services + Ingress routes, plaintext ones flagged).
func exposureHandler(kc *k8s.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rep, err := kc.ExposureAudit(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, rep)
	}
}

// netpolCoverageHandler serves the ingress-isolation report — workloads no
// NetworkPolicy restricts (open to lateral movement).
func netpolCoverageHandler(kc *k8s.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rep, err := kc.NetworkPolicyCoverage(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, rep)
	}
}

// orphansHandler serves the orphaned/broken-resource review list (dead services,
// unused PVCs).
func orphansHandler(kc *k8s.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rep, err := kc.OrphanedResources(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, rep)
	}
}
