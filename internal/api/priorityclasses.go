package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

type PriorityClassesHandler struct {
	kc *k8s.Client
}

func priorityClassesHandler(kc *k8s.Client) *PriorityClassesHandler {
	return &PriorityClassesHandler{kc: kc}
}

func (h *PriorityClassesHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListPriorityClasses(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *PriorityClassesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "PriorityClass", "", name) {
		return
	}
	if err := h.kc.DeletePriorityClass(r.Context(), name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
