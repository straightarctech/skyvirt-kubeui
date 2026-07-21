package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

type ServiceAccountsHandler struct {
	kc *k8s.Client
}

func serviceAccountsHandler(kc *k8s.Client) *ServiceAccountsHandler {
	return &ServiceAccountsHandler{kc: kc}
}

func (h *ServiceAccountsHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListServiceAccounts(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *ServiceAccountsHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListServiceAccounts(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *ServiceAccountsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "ServiceAccount", ns, name) {
		return
	}
	if err := h.kc.DeleteServiceAccount(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
