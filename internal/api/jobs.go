package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// JobsHandler serves Job and CronJob REST endpoints.
type JobsHandler struct {
	kc *k8s.Client
}

func jobsHandler(kc *k8s.Client) *JobsHandler {
	return &JobsHandler{kc: kc}
}

// ListJobs returns Jobs across all namespaces.
func (h *JobsHandler) ListJobs(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListJobs(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListJobsNamespaced returns Jobs in a specific namespace.
func (h *JobsHandler) ListJobsNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListJobs(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// DeleteJob removes a Job.
func (h *JobsHandler) DeleteJob(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "Job", ns, name) {
		return
	}
	if err := h.kc.DeleteJob(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ListCronJobs returns CronJobs across all namespaces.
func (h *JobsHandler) ListCronJobs(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListCronJobs(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListCronJobsNamespaced returns CronJobs in a specific namespace.
func (h *JobsHandler) ListCronJobsNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListCronJobs(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// SuspendCronJob toggles the suspend flag on a CronJob.
func (h *JobsHandler) SuspendCronJob(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	var body struct {
		Suspend bool `json:"suspend"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.kc.SuspendCronJob(r.Context(), ns, name, body.Suspend); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	action := "resumed"
	if body.Suspend {
		action = "suspended"
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": action})
}

// DeleteCronJob removes a CronJob.
func (h *JobsHandler) DeleteCronJob(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "CronJob", ns, name) {
		return
	}
	if err := h.kc.DeleteCronJob(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
