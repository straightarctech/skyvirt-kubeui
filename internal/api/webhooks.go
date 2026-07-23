package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

type WebhooksHandler struct {
	kc *k8s.Client
}

func webhooksHandler(kc *k8s.Client) *WebhooksHandler {
	return &WebhooksHandler{kc: kc}
}

func (h *WebhooksHandler) ListValidating(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListValidatingWebhooks(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *WebhooksHandler) ListMutating(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListMutatingWebhooks(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *WebhooksHandler) DeleteValidating(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "ValidatingWebhookConfiguration", "", name) {
		return
	}
	if err := h.kc.DeleteValidatingWebhook(r.Context(), name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *WebhooksHandler) DeleteMutating(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "MutatingWebhookConfiguration", "", name) {
		return
	}
	if err := h.kc.DeleteMutatingWebhook(r.Context(), name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
