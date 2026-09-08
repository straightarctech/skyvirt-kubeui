package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

type PDBsHandler struct {
	kc *k8s.Client
}

func pdbsHandler(kc *k8s.Client) *PDBsHandler {
	return &PDBsHandler{kc: kc}
}

func (h *PDBsHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListPDBs(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *PDBsHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListPDBs(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *PDBsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "PodDisruptionBudget", ns, name) {
		return
	}
	if err := h.kc.DeletePDB(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
