package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// RBACHandler serves RBAC-related REST endpoints.
type RBACHandler struct {
	kc *k8s.Client
}

func rbacHandler(kc *k8s.Client) *RBACHandler {
	return &RBACHandler{kc: kc}
}

// ListClusterRoles returns all ClusterRoles.
func (h *RBACHandler) ListClusterRoles(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListClusterRoles(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListRoles returns Roles in a specific namespace.
func (h *RBACHandler) ListRoles(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListRoles(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListClusterRoleBindings returns all ClusterRoleBindings.
func (h *RBACHandler) ListClusterRoleBindings(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListClusterRoleBindings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListRoleBindings returns RoleBindings in a specific namespace.
func (h *RBACHandler) ListRoleBindings(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListRoleBindings(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}
